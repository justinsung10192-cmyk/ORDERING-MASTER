// 動作：管理員（儀表板、菜單、帳號、設定、邀請碼）
import { appError, sid, num, round2, sha256Hex, todayString } from '../_lib/util.js';
import { supabase, findOne, listRows, listRowsIn, insertRow, updateRows, deleteRows, getAppSetting, setAppSetting } from '../_lib/db.js';
import { bumpAuthVersion, createInviteCodeValue } from '../_lib/auth.js';
import { outstandingOf, dashboardOrderRow } from '../_lib/serialize.js';
import { mailConfigured } from '../_lib/mail.js';

export const actions = {
  async getAdminDashboard(data, ctx) {
    const classId = ctx.classId;
    const date = String(data.orderDate || todayString());
    const sessions = await listRows('sessions', { classId, filters: { order_date: date }, order: 'cutoff_time' });
    const orders = sessions.length ? await listRowsIn('orders', 'session_id', sessions.map(session => session.id), { classId }) : [];
    const userIds = [...new Set(orders.map(order => String(order.user_id)).filter(Boolean))];
    const users = userIds.length ? await listRowsIn('users', 'id', userIds.map(Number), { classId }) : [];
    const userById = new Map(users.map(user => [String(user.id), user]));
    const storeById = new Map((await listRows('stores', { classId })).map(store => [String(store.id), store]));
    const sessionById = new Map(sessions.map(session => [String(session.id), session]));

    let totalMeals = 0;
    let totalReceivable = 0;
    let pickedUp = 0;
    const unpaidByUser = new Map();
    orders.forEach(order => {
      const quantity = (order.items || []).reduce((sum, item) => sum + num(item.quantity), 0);
      totalMeals += quantity;
      totalReceivable += num(order.total_price);
      if (order.pickup_status === 'PickedUp') pickedUp += quantity;
      const outstanding = outstandingOf(order);
      if (outstanding > 0) unpaidByUser.set(String(order.user_id), (unpaidByUser.get(String(order.user_id)) || 0) + outstanding);
    });

    const rows = orders.map(order => {
      const session = sessionById.get(String(order.session_id));
      return dashboardOrderRow(order, session, storeById.get(String(session.store_id))?.name || '未命名店家', userById.get(String(order.user_id)));
    });
    rows.sort((a, b) => String(a.seatNo).localeCompare(String(b.seatNo), 'zh-Hant-TW', { numeric: true }));

    const summaries = sessions.map(session => {
      const sessionOrders = orders.filter(order => String(order.session_id) === String(session.id));
      const itemsMap = new Map();
      let orderCount = 0;
      let meals = 0;
      let unpaid = 0;
      let picked = 0;
      let receivable = 0;
      sessionOrders.forEach(order => {
        orderCount += 1;
        const quantity = (order.items || []).reduce((sum, item) => sum + num(item.quantity), 0);
        meals += quantity;
        receivable += num(order.total_price);
        if (order.pickup_status === 'PickedUp') picked += quantity;
        if (outstandingOf(order) > 0) unpaid += 1;
        (order.items || []).forEach(item => {
          const optionsText = (item.selectedOptions || []).map(option => option.name).join('、');
          const key = `${String(item.itemId)}|${optionsText}`;
          const entry = itemsMap.get(key) || {
            itemName: item.itemName,
            selectedOptions: optionsText,
            orderCount: 0,
            totalQuantity: 0,
          };
          entry.orderCount += 1;
          entry.totalQuantity += num(item.quantity);
          itemsMap.set(key, entry);
        });
      });
      return {
        sessionId: sid(session.id),
        storeName: storeById.get(String(session.store_id))?.name || '未命名店家',
        orderDate: session.order_date,
        cutoffTime: session.cutoff_time,
        paymentMode: session.payment_mode,
        stats: {
          orderCount,
          totalMeals: meals,
          unpaidStudents: unpaid,
          pickedUp: picked,
          totalReceivable: round2(receivable),
        },
        items: [...itemsMap.values()],
      };
    });

    const { data: allSessions } = await supabase.from('sessions').select('order_date').eq('class_id', classId);
    const availableDates = [...new Set((allSessions || []).map(session => session.order_date))].sort();

    return {
      stats: { totalMeals, totalReceivable: round2(totalReceivable), unpaidStudents: unpaidByUser.size, pickedUp },
      orders: rows,
      sessionSummaries: summaries,
      availableDates,
      date,
    };
  },

  async adminCatalog(_data, ctx) {
    const stores = await listRows('stores', { classId: ctx.classId, order: 'sort_order' });
    const items = await listRows('menu_items', { classId: ctx.classId, order: 'sort_order' });
    const options = await listRows('item_options', { classId: ctx.classId, order: 'sort_order' });
    const sessions = await listRows('sessions', { classId: ctx.classId, order: 'order_date' });
    return {
      stores: stores.map(store => ({ storeId: sid(store.id), name: store.name, isActive: store.is_active })),
      items: items.map(item => ({ storeId: sid(item.store_id), itemId: sid(item.id), name: item.name, basePrice: num(item.price) })),
      options: options.map(option => ({
        itemId: sid(option.menu_item_id),
        optionId: sid(option.id),
        name: option.name,
        priceAdjustment: num(option.price),
        maxSelect: num(option.max_select),
      })),
      sessions: sessions.map(session => ({
        sessionId: sid(session.id),
        storeId: sid(session.store_id),
        orderDate: session.order_date,
        cutoffTime: session.cutoff_time,
        paymentMode: session.payment_mode,
      })),
    };
  },

  async adminSaveStore(data, ctx) {
    const name = String(data.name || '').trim();
    if (!name) throw appError('INVALID_INPUT', '請輸入店家名稱。');
    await insertRow('stores', { class_id: ctx.classId, name });
    return { ok: true };
  },

  async adminSaveMenuItem(data, ctx) {
    const store = await findOne('stores', { id: Number(data.storeId) }, ctx.classId);
    if (!store) throw appError('NOT_FOUND', '店家不存在。');
    const name = String(data.name || '').trim();
    const basePrice = Number(data.basePrice);
    if (!name) throw appError('INVALID_INPUT', '請輸入餐點名稱。');
    if (!Number.isFinite(basePrice) || basePrice < 0) throw appError('INVALID_INPUT', '請輸入正確的價格。');
    await insertRow('menu_items', { class_id: ctx.classId, store_id: store.id, name, price: basePrice });
    return { ok: true };
  },

  async adminSaveItemOption(data, ctx) {
    const item = await findOne('menu_items', { id: Number(data.itemId) }, ctx.classId);
    if (!item) throw appError('NOT_FOUND', '餐點不存在。');
    const name = String(data.name || '').trim();
    const priceAdjustment = Number(data.priceAdjustment);
    if (!name) throw appError('INVALID_INPUT', '請輸入選項名稱。');
    if (!Number.isFinite(priceAdjustment)) throw appError('INVALID_INPUT', '請輸入正確的差額。');
    await insertRow('item_options', { class_id: ctx.classId, store_id: item.store_id, menu_item_id: item.id, name, price: priceAdjustment });
    return { ok: true };
  },

  async adminDeleteStore(data, ctx) {
    const store = await findOne('stores', { id: Number(data.storeId) }, ctx.classId);
    if (!store) throw appError('NOT_FOUND', '店家不存在。');
    const sessions = await listRows('sessions', { classId: ctx.classId, filters: { store_id: store.id } });
    const orderCount = await countOrdersOfSessions(sessions, ctx.classId);
    if (orderCount > 0) throw appError('PROTECTED', '此店家已有訂單紀錄，基於帳務保護無法刪除。');
    for (const session of sessions) await deleteRows('sessions', { id: session.id });
    await deleteRows('stores', { id: store.id });
    return { ok: true };
  },

  async adminDeleteMenuItem(data, ctx) {
    const item = await findOne('menu_items', { id: Number(data.itemId) }, ctx.classId);
    if (!item) throw appError('NOT_FOUND', '餐點不存在。');
    if (await orderContainsItem(ctx.classId, String(item.id))) {
      throw appError('PROTECTED', '此餐點已有訂單使用，基於帳務保護無法刪除。');
    }
    await deleteRows('menu_items', { id: item.id });
    return { ok: true };
  },

  async adminDeleteItemOption(data, ctx) {
    const option = await findOne('item_options', { id: Number(data.optionId) }, ctx.classId);
    if (!option) throw appError('NOT_FOUND', '客製選項不存在。');
    if (await orderContainsOption(ctx.classId, String(option.id))) {
      throw appError('PROTECTED', '此選項已有訂單使用，基於帳務保護無法刪除。');
    }
    await deleteRows('item_options', { id: option.id });
    return { ok: true };
  },

  async adminListUsers(_data, ctx) {
    const users = await listRows('users', { classId: ctx.classId, order: 'seat_no' });
    return users.map(user => ({
      id: sid(user.id),
      seatNo: user.seat_no,
      name: user.student_name,
      studentNo: user.student_no,
      walletBalance: num(user.wallet_balance),
      role: user.role,
      isDisabled: user.is_disabled,
    }));
  },

  async adminSetUserDisabled(data, ctx) {
    const user = await findOne('users', { id: Number(data.userId) }, ctx.classId);
    if (!user) throw appError('NOT_FOUND', '找不到使用者。');
    await updateRows('users', { id: user.id }, { is_disabled: Boolean(data.isDisabled) });
    await bumpAuthVersion(user.id);
    return { ok: true };
  },

  async adminDeleteUser(data, ctx) {
    const user = await findOne('users', { id: Number(data.userId) }, ctx.classId);
    if (!user) throw appError('NOT_FOUND', '找不到使用者。');
    if (user.role === 'Admin') throw appError('PROTECTED', '不可刪除管理員帳號。');
    if (String(user.id) === String(ctx.user.id)) throw appError('PROTECTED', '不可刪除自己的帳號。');
    const retainedOrderCount = await countRowsWhere('orders', { user_id: user.id });
    const retainedTransactionCount = await countRowsWhere('transactions', { user_id: user.id });
    await deleteRows('users', { id: user.id });
    return { ok: true, retainedOrderCount, retainedTransactionCount };
  },

  async adminGetSettings(_data, ctx) {
    const classRow = await findOne('classes', { class_id: ctx.classId });
    return {
      className: classRow ? classRow.name : '本班',
      emailDomain: await getAppSetting(ctx.classId, 'email_domain', ''),
    };
  },

  async adminSaveSettings(data, ctx) {
    const emailDomain = String(data.emailDomain || '').trim();
    if (emailDomain && !/^@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(emailDomain)) {
      throw appError('INVALID_INPUT', 'Email 後綴格式不正確（例如 @class.edu.tw）。');
    }
    await setAppSetting(ctx.classId, 'email_domain', emailDomain);
    return { ok: true };
  },

  async adminListInviteCodes(_data, ctx) {
    const codes = await listRows('invite_codes', { classId: ctx.classId, order: 'created_at' });
    return codes.map(code => ({ inviteCodeId: sid(code.id), label: code.label, isDisabled: code.is_disabled }));
  },

  async adminCreateInviteCode(data, ctx) {
    const label = String(data.label || '').trim().slice(0, 80) || '班級邀請碼';
    const code = createInviteCodeValue();
    await insertRow('invite_codes', { class_id: ctx.classId, code_hash: sha256Hex(code), label });
    return { code };
  },

  async adminDisableInviteCode(data, ctx) {
    const code = await findOne('invite_codes', { id: Number(data.inviteCodeId) }, ctx.classId);
    if (!code) throw appError('NOT_FOUND', '找不到邀請碼。');
    await updateRows('invite_codes', { id: code.id }, { is_disabled: true });
    return { ok: true };
  },

  async adminGetEmailDiagnostics() {
    const configured = mailConfigured();
    return {
      message: configured
        ? `郵件服務正常（Gmail SMTP：${process.env.SMTP_USER}，僅用於驗證信與重設信）。`
        : '郵件服務尚未設定（請設定 SMTP_USER / SMTP_PASS，並在 Gmail 產生應用程式密碼）。',
      gmailAuthorized: configured,
      remainingDailyQuota: configured ? 500 : 0,
    };
  },
};

async function countOrdersOfSessions(sessions, classId) {
  if (!sessions.length) return 0;
  const orders = await listRowsIn('orders', 'session_id', sessions.map(session => session.id), { classId });
  return orders.length;
}

async function orderContainsItem(classId, itemId) {
  const orders = await listRows('orders', { classId });
  return orders.some(order => (order.items || []).some(item => String(item.itemId) === itemId));
}

async function orderContainsOption(classId, optionId) {
  const orders = await listRows('orders', { classId });
  return orders.some(order =>
    (order.items || []).some(item => (item.selectedOptions || []).some(option => String(option.optionId) === optionId)),
  );
}

async function countRowsWhere(table, filters) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  Object.entries(filters).forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  const result = await query;
  return result.count || 0;
}
