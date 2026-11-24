// Reports unexpected client errors to the club owner (no user data: message + page only).
import { sb } from './supa.js';

export function installErrorLog(app) {
  let sent = 0; const seen = new Set();
  const report = (msg) => {
    const m = String(msg || '').slice(0, 300);
    if (!m || sent >= 5 || seen.has(m)) return;
    seen.add(m); sent += 1;
    sb.auth.getSession().then(({ data }) => {
      if (!data || !data.session) return;
      return sb.rpc('log_client_error', { p_app: app, p_message: m, p_page: location.pathname.slice(0, 100) });
    }).catch(() => {});
  };
  window.addEventListener('error', (e) => report(e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason && e.reason.message ? e.reason.message : e.reason));
}
