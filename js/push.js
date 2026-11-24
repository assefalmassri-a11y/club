// Web Push: subscribe/unsubscribe this browser. Only the PUBLIC VAPID key lives here.
import { sb } from './supa.js';
import { h, toast, errText } from './dom.js';
import { t } from './i18n.js';
import { VAPID_PUBLIC } from './config.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function b64url(buf) {
  let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function current() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(t('push.denied'));
  const { reg, sub: old } = await current();
  const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  const { error } = await sb.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: b64url(sub.getKey('p256dh')), p_auth: b64url(sub.getKey('auth')) });
  if (error) throw error;
}
async function disable() {
  const { sub } = await current();
  if (!sub) return;
  await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// Returns a small control element with a status line and an enable/disable button.
export function pushControl() {
  const box = h('div', { class: 'item' });
  if (!supported()) { box.append(h('span', { class: 'muted' }, t('push.unsupported'))); return box; }
  const label = h('span', { class: 'muted' }, t('push.title'));
  const btn = h('button', { type: 'button', class: 'btn small' }, '…');
  async function paint() {
    let on = false;
    try { on = !!(await current()).sub && Notification.permission === 'granted'; } catch (_) { /* ignore */ }
    btn.textContent = on ? t('push.disable') : t('push.enable');
    btn.dataset.on = on ? '1' : '';
    btn.disabled = false;
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.on) { await disable(); toast(t('push.off'), 'ok'); } else { await enable(); toast(t('push.on'), 'ok'); }
    } catch (e) { toast(errText(e), 'error'); }
    await paint();
  });
  box.append(label, btn);
  paint();
  return box;
}
