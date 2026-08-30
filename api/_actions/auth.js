// 動作：公開設定、註冊、驗證、登入、密碼重設、升級管理員、Bootstrap
import { appError, sid, num, sha256Hex } from '../_lib/util.js';
import { findOne, insertRow, updateRows, deleteRows, getAppSetting } from '../_lib/db.js';
import {
  verifyPassword, createPassword, createSession, destroySession, bumpAuthVersion,
  issueEmailCode, consumeEmailCode, findOrCreateClass,
} from '../_lib/auth.js';
import { sendMail, verificationEmailHtml, resetEmailHtml } from '../_lib/mail.js';
import { getVapidPublicKey } from '../_lib/push.js';
import { publicUser, loadOpenSessions } from '../_lib/serialize.js';

function cleanStudentNo(value) {
  return String(value || '').trim();
}

export const actions = {
  async getPublicConfig() {
    return {
      appName: '班級訂午餐系統',
      emailDomain: '',
      registrationMode: 'open',
      hasDeveloper: true,
      vapidPublicKey: getVapidPublicKey(),
    };
  },

  async register(data) {
    const studentNo = cleanStudentNo(data.studentNo);
    const seatNo = String(data.seatNo || '').trim();
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!/^\d{3,30}$/.test(studentNo)) throw appError('INVALID_INPUT', '學號格式不正確。');
    if (!seatNo) throw appError('INVALID_INPUT', '請填寫座號。');
    if (!name) throw appError('INVALID_INPUT', '請填寫真實姓名。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError('INVALID_INPUT', '電子郵件格式不正確。');

    const inviteCode = String(data.inviteCode || '').trim();
    const classAdminCode = String(data.classAdminCode || '').trim();
    let classId = '';
    let role = 'Student';

    if (classAdminCode) {
      const record = await findOne('class_admin_codes', { code_hash: sha256Hex(classAdminCode) });
      if (!record || record.is_used) throw appError('INVALID_CODE', '班級管理者代碼不正確或已使用。');
      classId = await findOrCreateClass(record.label || '未命名班級');
      role = 'Admin';
      await updateRows('class_admin_codes', { id: record.id }, { is_used: true, used_by: studentNo });
    } else if (inviteCode) {
      const record = await findOne('invite_codes', { code_hash: sha256Hex(inviteCode) });
      if (!record || record.is_disabled) throw appError('INVALID_CODE', '邀請碼不正確或已停用。');
      classId = record.class_id;
    } else {
      throw appError('MISSING_CODE', '請提供邀請碼，或使用班級管理者代碼建立新班級。');
    }

    const duplicate = await findOne('users', { class_id: classId, student_no: studentNo });
    if (duplicate) throw appError('DUPLICATE', '此學號已註冊。');
    const duplicateEmail = await findOne('users', { class_id: classId, email });
    if (duplicateEmail) throw appError('DUPLICATE', '此信箱已被使用。');

    const { salt, hash } = createPassword(password);
    const user = await insertRow('users', {
      class_id: classId, student_no: studentNo, student_name: name, seat_no: seatNo,
      email, password_hash: hash, salt, role,
    });
    const code = await issueEmailCode(user, 'Verify');
    const delivery = await sendMail({ to: email, subject: '【班級訂午餐】信箱驗證碼', html: verificationEmailHtml(code) });
    return { studentNo, email, delivery };
  },

  async verifyRegistration(data) {
    const user = await findOne('users', { student_no: cleanStudentNo(data.studentNo) });
    if (!user) throw appError('NOT_FOUND', '找不到此學號的帳號。');
    await consumeEmailCode(user.id, 'Verify', data.code);
    await updateRows('users', { id: user.id }, { email_verified: true });
    return { message: '信箱驗證完成，請登入。' };
  },

  async resendRegistrationVerification(data) {
    const user = await findOne('users', { student_no: cleanStudentNo(data.studentNo) });
    if (!user) throw appError('NOT_FOUND', '找不到此學號的帳號。');
    if (user.email_verified) return { message: '此帳號已完成信箱驗證，請直接登入。', delivery: { sent: true, message: '' } };
    await deleteRows('auth_tokens', { user_id: user.id, type: 'Verify' });
    const code = await issueEmailCode(user, 'Verify');
    const delivery = await sendMail({ to: user.email, subject: '【班級訂午餐】信箱驗證碼', html: verificationEmailHtml(code) });
    return { message: delivery.sent ? '驗證碼已重新寄出。' : '驗證碼寄送失敗，請稍後再試。', delivery };
  },

  async login(data) {
    const user = await findOne('users', { student_no: cleanStudentNo(data.studentNo) });
    if (!user) throw appError('INVALID_CREDENTIALS', '學號或密碼不正確。');
    if (user.is_disabled) throw appError('DISABLED', '此帳號已停用。');
    if (!user.email_verified) throw appError('NOT_VERIFIED', '請先完成信箱驗證後再登入。');
    if (!verifyPassword(user, String(data.password || ''))) throw appError('INVALID_CREDENTIALS', '學號或密碼不正確。');
    const token = await createSession(user);
    return { token, user: publicUser(user) };
  },

  async requestPasswordReset(data) {
    const user = await findOne('users', { student_no: cleanStudentNo(data.studentNo) });
    if (user && !user.is_disabled && user.email) {
      await deleteRows('auth_tokens', { user_id: user.id, type: 'Reset' });
      const code = await issueEmailCode(user, 'Reset');
      await sendMail({ to: user.email, subject: '【班級訂午餐】密碼重設碼', html: resetEmailHtml(code) });
    }
    return { message: '若此學號存在，重設碼已寄至登記信箱。' };
  },

  async resetPassword(data) {
    const token = String(data.token || '').trim();
    if (!token) throw appError('INVALID_CODE', '缺少重設碼。');
    const record = await findOne('auth_tokens', { token_hash: sha256Hex(token), type: 'Reset' });
    if (!record || new Date(record.expires_at).getTime() < Date.now()) {
      throw appError('INVALID_CODE', '重設碼不正確或已過期。');
    }
    const user = await findOne('users', { id: record.user_id });
    if (!user) throw appError('NOT_FOUND', '帳號不存在。');
    const { salt, hash } = createPassword(String(data.password || ''));
    await updateRows('users', { id: user.id }, { password_hash: hash, salt });
    await bumpAuthVersion(user.id);
    return { message: '密碼已重設，請重新登入。' };
  },

  async logout(_data, ctx) {
    await destroySession(ctx.token, 'Session');
    return { ok: true };
  },

  async getBootstrap(_data, ctx) {
    const { sessions, orders } = await loadOpenSessions(ctx.user);
    return { user: publicUser(ctx.user), sessions, orders };
  },

  async getOpenSessions(_data, ctx) {
    const { sessions, orders } = await loadOpenSessions(ctx.user);
    return { sessions, orders };
  },
};
