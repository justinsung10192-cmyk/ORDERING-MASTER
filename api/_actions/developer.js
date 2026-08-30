// 動作：開發者工作台（班級管理者代碼、跨班級帳號管理、系統設定）
import { appError, sid, num, sha256Hex } from '../_lib/util.js';
import { supabase, findOne, listRows, listRowsIn, insertRow, updateRows, deleteRows, getAppSetting, setAppSetting } from '../_lib/db.js';
import {
  verifyPassword, createPassword, createDeveloperSession, destroySession, bumpAuthVersion, createClassAdminCodeValue,
} from '../_lib/auth.js';

function publicDeveloper(developer) {
  return { username: developer.username, name: developer.username, email: developer.email };
}

export const actions = {
  async developerRegister(data) {
    const masterKey = process.env.DEVELOPER_MASTER_KEY || '';
    if (!masterKey) throw appError('NOT_CONFIGURED', '開發者金鑰尚未設定（DEVELOPER_MASTER_KEY）。');
    if (String(data.activationKey || '') !== masterKey) throw appError('INVALID_KEY', '開發者金鑰不正確。');
    const username = String(data.username || '').trim();
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw appError('INVALID_INPUT', '開發者帳號格式不正確。');
    const email = String(data.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError('INVALID_INPUT', '電子郵件格式不正確。');
    const existing = await findOne('developers', { username });
    if (existing) throw appError('DUPLICATE', '此開發者帳號已存在。');
    const { salt, hash } = createPassword(String(data.password || ''));
    await insertRow('developers', { username, email, password_hash: hash, salt });
    return { message: '開發者帳號已建立，請登入。' };
  },

  async developerLogin(data) {
    const developer = await findOne('developers', { username: String(data.username || '').trim() });
    if (!developer || developer.is_disabled) throw appError('INVALID_CREDENTIALS', '開發者帳號或密碼不正確。');
    if (!verifyPassword(developer, String(data.password || ''))) throw appError('INVALID_CREDENTIALS', '開發者帳號或密碼不正確。');
    const token = await createDeveloperSession(developer);
    return { token, developer: publicDeveloper(developer) };
  },

  async developerLogout(_data, ctx) {
    await destroySession(ctx.token, 'DevSession');
    return { ok: true };
  },

  async developerListUsers() {
    const users = await listRows('users', { order: 'created_at' });
    const classIds = [...new Set(users.map(user => user.class_id))];
    const classes = classIds.length ? await listRowsIn('classes', 'class_id', classIds) : [];
    const classByName = new Map(classes.map(classRow => [String(classRow.class_id), classRow.name]));
    return users.map(user => ({
      id: sid(user.id),
      name: user.student_name,
      studentNo: user.student_no,
      email: user.email,
      role: user.role,
      walletBalance: num(user.wallet_balance),
      isDisabled: user.is_disabled,
      emailVerified: user.email_verified,
      className: classByName.get(String(user.class_id)) || '未指定班級',
    }));
  },

  async developerListClassAdminCodes() {
    const codes = await listRows('class_admin_codes', { order: 'created_at' });
    return codes.map(code => ({
      codeId: sid(code.id),
      className: code.label,
      createdAt: code.created_at,
      isUsed: code.is_used,
      usedBy: code.is_used ? code.used_by : '',
    }));
  },

  async developerIssueClassAdminCode(data) {
    const className = String(data.className || '').trim().slice(0, 80);
    if (!className) throw appError('INVALID_INPUT', '請輸入班級名稱。');
    const code = createClassAdminCodeValue();
    await insertRow('class_admin_codes', { code_hash: sha256Hex(code), label: className });
    return { code };
  },

  async developerRevokeClassAdminCode(data) {
    const code = await findOne('class_admin_codes', { id: Number(data.codeId) });
    if (!code) throw appError('NOT_FOUND', '找不到管理者代碼。');
    if (code.is_used) throw appError('PROTECTED', '已使用的代碼不可撤銷。');
    await updateRows('class_admin_codes', { id: code.id }, { is_used: true, used_by: 'developer-revoked' });
    return { ok: true };
  },

  async developerGetUserDetails(data) {
    const user = await findOne('users', { id: Number(data.userId) });
    if (!user) throw appError('NOT_FOUND', '找不到使用者。');
    const classRow = await findOne('classes', { class_id: user.class_id });

    const orders = await listRows('orders', { classId: user.class_id, filters: { user_id: user.id }, order: 'created_at', orderAscending: false, limit: 50 });
    const sessionIds = [...new Set(orders.map(order => order.session_id))];
    const sessions = sessionIds.length ? await listRowsIn('sessions', 'id', sessionIds, { classId: user.class_id }) : [];
    const sessionById = new Map(sessions.map(session => [String(session.id), session]));

    const transactions = await listRows('transactions', { classId: user.class_id, filters: { user_id: user.id }, order: 'created_at', orderAscending: false, limit: 50 });

    return {
      name: user.student_name,
      studentNo: user.student_no,
      className: classRow ? classRow.name : '未指定',
      email: user.email,
      emailVerified: user.email_verified,
      seatNo: user.seat_no,
      role: user.role,
      walletBalance: num(user.wallet_balance),
      isDisabled: user.is_disabled,
      orders: orders.map(order => ({
        itemName: (order.items || []).map(item => `${Number(item.quantity) > 1 ? `${Number(item.quantity)}×` : ''}${item.itemName}`).join('、'),
        totalPrice: num(order.total_price),
        orderDate: sessionById.get(String(order.session_id))?.order_date || '',
        paymentStatus: order.payment_status,
      })),
      transactions: transactions.map(transaction => ({ type: transaction.kind, amount: num(transaction.amount) })),
    };
  },

  async developerSetUserDisabled(data) {
    const user = await findOne('users', { id: Number(data.userId) });
    if (!user) throw appError('NOT_FOUND', '找不到使用者。');
    await updateRows('users', { id: user.id }, { is_disabled: Boolean(data.isDisabled) });
    await bumpAuthVersion(user.id);
    return { ok: true };
  },

  async developerDeleteUser(data) {
    const user = await findOne('users', { id: Number(data.userId) });
    if (!user) throw appError('NOT_FOUND', '找不到使用者。');
    const retainedOrderCount = await countWhere('orders', { user_id: user.id });
    const retainedTransactionCount = await countWhere('transactions', { user_id: user.id });
    await deleteRows('users', { id: user.id });
    return { ok: true, retainedOrderCount, retainedTransactionCount };
  },

  async developerGetSettings() {
    return { hasAuthorizationCode: Boolean(await getAppSetting('', 'admin_auth_code', '')) };
  },

  async developerSaveSettings(data) {
    const code = String(data.newAuthorizationCode || '').trim();
    if (code) {
      if (code.length < 8) throw appError('INVALID_INPUT', '管理員升級授權碼至少須為 8 個字元。');
      await setAppSetting('', 'admin_auth_code', sha256Hex(code));
    }
    return { ok: true };
  },
};

async function countWhere(table, filters) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  Object.entries(filters).forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  const result = await query;
  return result.count || 0;
}
