// 動作：開發者工作台（班級管理者代碼、跨班級帳號管理、系統設定）
import { randomBytes } from 'node:crypto';
import { appError, sid, num, sha256Hex, randomDigits } from '../_lib/util.js';
import { supabase, findOne, listRows, listRowsIn, insertRow, updateRows, deleteRows, getAppSetting, setAppSetting } from '../_lib/db.js';
import { verifyPassword, createPassword, createDeveloperSession, destroySession, bumpAuthVersion, createClassAdminCodeValue } from '../_lib/auth.js';
import { mailConfigured, sendMail, verificationEmailHtml, developerLoginAlertHtml } from '../_lib/mail.js';
import { sendPushToAll } from '../_lib/push.js';

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
    const existingEmail = await findOne('developers', { email });
    if (existingEmail) throw appError('DUPLICATE', '此信箱已被使用。');
    const { salt, hash } = createPassword(String(data.password || ''));
    const developer = await insertRow('developers', { username, email, password_hash: hash, salt });
    const code = randomDigits(6);
    await insertRow('auth_tokens', {
      type: 'DevVerify',
      developer_id: developer.id,
      token_hash: sha256Hex(code),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const delivery = await sendMail({ to: email, subject: '【訂餐通】開發者信箱驗證碼', html: verificationEmailHtml(code) });
    return { message: '開發者帳號已建立。請先完成信箱驗證（驗證碼已寄出），再登入。', delivery };
  },

  async developerVerifyEmail(data) {
    const developer = await findOne('developers', { username: String(data.username || '').trim() });
    if (!developer) throw appError('NOT_FOUND', '找不到此開發者帳號。');
    if (developer.email_verified) return { message: '此帳號已完成信箱驗證。' };
    const code = String(data.code || '').trim();
    const record = await findOne('auth_tokens', { type: 'DevVerify', developer_id: developer.id, token_hash: sha256Hex(code) });
    if (!record || new Date(record.expires_at).getTime() < Date.now()) throw appError('INVALID_CODE', '驗證碼不正確或已過期。');
    await updateRows('developers', { id: developer.id }, { email_verified: true });
    await deleteRows('auth_tokens', { id: record.id });
    return { message: '信箱驗證完成，請登入開發者工作台。' };
  },

  async developerLogin(data) {
    const developer = await findOne('developers', { username: String(data.username || '').trim() });
    if (!developer || developer.is_disabled) throw appError('INVALID_CREDENTIALS', '開發者帳號或密碼不正確。');
    if (!verifyPassword(developer, String(data.password || ''))) throw appError('INVALID_CREDENTIALS', '開發者帳號或密碼不正確。');
    if (!developer.email_verified) throw appError('NOT_VERIFIED', '請先完成信箱驗證後再登入。');
    if (developer.blocked_until && new Date(developer.blocked_until).getTime() > Date.now()) {
      throw appError('BLOCKED', '此開發者帳號暫時被封鎖，請約 1 分鐘後再試。');
    }
    const token = await createDeveloperSession(developer);
    let loginAlert = { sent: false };
    try {
      const alertEmail = process.env.ADMIN_ALERT_EMAIL || 'justinsung1019.2@gmail.com';
      const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
      const blockToken = randomBytes(24).toString('hex');
      await insertRow('auth_tokens', {
        type: 'DevBlock',
        developer_id: developer.id,
        token_hash: sha256Hex(blockToken),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });
      const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      loginAlert = await sendMail({
        to: alertEmail,
        subject: `【訂餐通】開發者登入通知：${developer.username}`,
        html: developerLoginAlertHtml({ name: developer.username, email: developer.email, time, blockUrl: `${appUrl}/api/block?code=${blockToken}` }),
      });
    } catch (_) { /* 通知失敗不阻擋登入 */ }
    return { token, developer: publicDeveloper(developer), loginAlert };
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
      classId: sid(user.class_id),
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
    let maintenance = false;
    try { maintenance = (await getAppSetting('', 'maintenance', '')) === '1'; } catch (_) { /* 忽略 */ }
    return { maintenance };
  },

  async developerSaveSettings() {
    return { ok: true };
  },

  async developerGetEmailDiagnostics() {
    const configured = mailConfigured();
    return {
      message: configured
        ? `郵件服務正常（Gmail SMTP：${process.env.SMTP_USER}，僅用於驗證信與重設信）。`
        : '郵件服務尚未設定（請設定 SMTP_USER / SMTP_PASS，並在 Gmail 產生應用程式密碼）。',
      gmailAuthorized: configured,
      remainingDailyQuota: configured ? 500 : 0,
    };
  },

  async developerBroadcast(data) {
    const message = String(data.message || '').trim().slice(0, 200);
    if (!message) throw appError('INVALID_INPUT', '請輸入廣播內容。');
    const result = await sendPushToAll({ title: '系統廣播', body: message, url: '/' });
    return { ok: true, sent: result.sent, attempted: result.attempted };
  },

  async developerSetMaintenance(data) {
    await setAppSetting('', 'maintenance', Boolean(data.enabled) ? '1' : '0');
    return { ok: true, maintenance: Boolean(data.enabled) };
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
