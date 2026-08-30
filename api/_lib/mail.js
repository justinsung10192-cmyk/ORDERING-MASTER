// 郵件層：Resend（免費層 3000 封/月、100 封/日）——只用於驗證信與密碼重設信
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY || '';
const from = process.env.EMAIL_FROM || '班級訂午餐 <no-reply@example.com>';
const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');

const resend = apiKey ? new Resend(apiKey) : null;

export async function sendMail({ to, subject, html }) {
  if (!resend) return { sent: false, message: '郵件服務尚未設定（缺少 RESEND_API_KEY）。' };
  if (!to || !String(to).includes('@')) return { sent: false, message: '電子郵件地址不正確。' };
  try {
    await resend.emails.send({ from, to, subject, html });
    return { sent: true, message: '已寄出。' };
  } catch (error) {
    return { sent: false, message: `郵件寄送失敗：${error.message || '請稍後再試。'}` };
  }
}

export function verificationEmailHtml(code) {
  return `
  <div style="font-family:'Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#173B62">
    <h2 style="margin:0 0 16px;color:#173B62">班級訂午餐系統 — 信箱驗證</h2>
    <p style="line-height:1.8">你的驗證碼是：</p>
    <div style="margin:16px 0;padding:16px;background:#EEF3F5;border-radius:12px;text-align:center;font-size:28px;font-weight:900;letter-spacing:8px;color:#173B62">${code}</div>
    <p style="line-height:1.8;color:#5b6b7a;font-size:14px">驗證碼 15 分鐘內有效。若這不是你本人操作，請忽略此信。</p>
    <p style="margin-top:24px;font-size:12px;color:#9aa8b5">班級訂午餐系統</p>
  </div>`;
}

export function resetEmailHtml(code) {
  return `
  <div style="font-family:'Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#173B62">
    <h2 style="margin:0 0 16px;color:#173B62">班級訂午餐系統 — 密碼重設</h2>
    <p style="line-height:1.8">你的密碼重設碼是：</p>
    <div style="margin:16px 0;padding:16px;background:#EEF3F5;border-radius:12px;text-align:center;font-size:28px;font-weight:900;letter-spacing:8px;color:#173B62">${code}</div>
    <p style="line-height:1.8;color:#5b6b7a;font-size:14px">重設碼 15 分鐘內有效，請回到「登入 → 忘記密碼」頁面輸入重設碼並設定新密碼。若這不是你本人操作，請忽略此信。</p>
    <p style="margin-top:24px;font-size:12px;color:#9aa8b5">班級訂午餐系統</p>
  </div>`;
}
