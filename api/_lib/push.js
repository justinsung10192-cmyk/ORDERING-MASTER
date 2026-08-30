// 推播層：Web Push（VAPID），取代所有非驗證類 Email 通知
import webpush from 'web-push';
import { supabase, deleteRows } from './db.js';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const appUrl = (process.env.APP_URL || 'https://your-app.vercel.app').replace(/\/+$/, '');

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(`mailto:admin@${(appUrl || '').replace(/^https?:\/\//, '') || 'example.com'}`, vapidPublicKey, vapidPrivateKey);
}

export function pushConfigured() {
  return Boolean(vapidPublicKey && vapidPrivateKey);
}

export async function sendPushToUser(userId, { title, body, url = '/' }) {
  if (!pushConfigured()) return { sent: 0, attempted: 0 };
  const { data: subscriptions, error } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
  if (error || !subscriptions?.length) return { sent: 0, attempted: 0 };

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
      );
      sent += 1;
    } catch (error) {
      // 訂閱已失效（404/410）→ 清除
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await deleteRows('push_subscriptions', { endpoint: subscription.endpoint }).catch(() => {});
      }
    }
  }
  return { sent, attempted: subscriptions.length };
}

export async function sendPushToClass(classId, { title, body, url = '/' }) {
  if (!pushConfigured()) return { sent: 0, attempted: 0 };
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('class_id', classId);
  if (error || !subscriptions?.length) return { sent: 0, attempted: 0 };

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
      );
      sent += 1;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await deleteRows('push_subscriptions', { endpoint: subscription.endpoint }).catch(() => {});
      }
    }
  }
  return { sent, attempted: subscriptions.length };
}

// 前端訂閱時需要的 VAPID 公鑰
export function getVapidPublicKey() {
  return vapidPublicKey;
}
