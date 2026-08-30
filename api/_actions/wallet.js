// 動作：錢包歷史、管理員儲值、現金結清
import { appError, sid, num, round2 } from '../_lib/util.js';
import { findOne, listRows, callRpc } from '../_lib/db.js';
import { publicUser, outstandingOf } from '../_lib/serialize.js';

export const actions = {
  async getWalletHistory(_data, ctx) {
    const transactions = await listRows('transactions', {
      classId: ctx.classId,
      filters: { user_id: ctx.user.id },
      order: 'created_at',
      orderAscending: false,
      limit: 200,
    });
    const orders = await listRows('orders', { classId: ctx.classId, filters: { user_id: ctx.user.id } });
    const cashUnpaid = round2(orders.reduce((sum, order) => sum + outstandingOf(order), 0));
    const freshUser = await findOne('users', { id: ctx.user.id });
    return {
      user: publicUser(freshUser),
      cashUnpaid,
      transactions: transactions.map(transaction => ({
        type: transaction.kind,
        amount: num(transaction.amount),
        timestamp: transaction.created_at,
      })),
    };
  },

  async adminTopUp(data, ctx) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw appError('INVALID_INPUT', '請輸入正確的儲值金額。');
    const target = await findOne('users', { id: Number(data.userId) }, ctx.classId);
    if (!target) throw appError('NOT_FOUND', '找不到使用者。');
    const result = await callRpc('fn_topup', {
      p_class_id: ctx.classId,
      p_user_id: target.id,
      p_amount: amount,
    });
    return {
      ok: true,
      walletBalance: num(result.wallet_balance),
      appliedToDebt: num(result.applied_to_debt),
      remainingDebt: num(result.remaining_debt),
      message: '儲值完成。',
    };
  },

  async adminSettleCash(data, ctx) {
    const target = await findOne('users', { id: Number(data.userId) }, ctx.classId);
    if (!target) throw appError('NOT_FOUND', '找不到使用者。');
    const orderIds = (data.orderIds || []).map(Number).filter(Boolean);
    if (!orderIds.length) throw appError('INVALID_INPUT', '沒有可結清的訂單。');
    const result = await callRpc('fn_settle_cash', {
      p_class_id: ctx.classId,
      p_user_id: target.id,
      p_order_ids: orderIds,
    });
    return { ok: true, settled: num(result.settled) };
  },
};
