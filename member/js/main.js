import { sb } from '../../js/supa.js';
import { state } from '../../js/state.js';
import { h, clear, spinner, toast, errText } from '../../js/dom.js';
import { t, initLang } from '../../js/i18n.js';
import { initTheme } from '../../js/theme.js';
import { icon } from '../../js/icons.js';
import { showLogin, handleRecovery } from '../../js/auth.js';
import { installErrorLog } from '../../js/errlog.js';
import { me } from './ctx.js';
import * as home from './home.js';
import * as scan from './scan.js';
import * as events from './events.js';
import * as invoices from './invoices.js';
import * as chat from './chat.js';
import * as activity from './activity.js';
import * as body from './body.js';
import * as pt from './pt.js';
import * as board from './board.js';

initLang();
initTheme();
installErrorLog('member');
const root = document.getElementById('app');
const TABS = [
  { id: 'home', ic: 'overview', view: home },
  { id: 'scan', ic: 'qr', view: scan },
  { id: 'events', ic: 'events', view: events },
  { id: 'chat', ic: 'chat', view: chat },
  { id: 'invoices', ic: 'invoices', view: invoices },
  { id: 'activity', ic: 'clock', view: activity },
  { id: 'body', ic: 'members', view: body },
  { id: 'pt', ic: 'clients', view: pt },
  { id: 'board', ic: 'reports', view: board },
];
let nav; let content; let cleanup = null;

async function show(id) {
  if (typeof cleanup === 'function') { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
  for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === id);
  const cur = nav.querySelector(`[data-tab="${id}"]`); const mb = nav.querySelector('[data-more]');
  if (mb) mb.classList.toggle('active', !!cur && cur.classList.contains('more-item'));
  clear(content); content.append(spinner());
  const box = h('div', { class: 'view' });
  try { cleanup = await TABS.find((x) => x.id === id).view.render(box, { goto: show }); } catch (e) { box.append(h('div', { class: 'form-error' }, errText(e))); }
  clear(content); content.append(box);
}

function shell() {
  clear(root);
  const MAIN = 4;
  const openMore = () => {
    const overlay = h('div', { class: 'overlay' });
    overlay.append(h('div', { class: 'modal small' }, h('div', { class: 'menu-list' }, TABS.slice(MAIN).map((tb) => h('button', { type: 'button', class: 'btn block', onClick: () => { overlay.remove(); show(tb.id); } }, t(`m.tab.${tb.id}`)))),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onClick: () => overlay.remove() }, t('common.close')))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  };
  nav = h('nav', { class: 'nav', 'aria-label': 'main' }, ...TABS.map((tb, i) => h('button', { type: 'button', 'data-tab': tb.id, class: i >= MAIN ? 'more-item' : '', onClick: () => show(tb.id) }, icon(tb.ic, 20), h('span', null, t(`m.tab.${tb.id}`)))),
    h('button', { type: 'button', class: 'more-btn', 'data-more': '1', onClick: openMore }, icon('more', 20), h('span', null, t('tab.more'))));
  content = h('main', { class: 'content' });
  const out = h('button', { type: 'button', class: 'btn ghost', 'aria-label': t('auth.signout') }, icon('logout', 18), h('span', { class: 'lbl' }, t('auth.signout')));
  out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  root.append(h('div', { class: 'shell' },
    h('aside', { class: 'side' }, h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, (me.club.name || '?').charAt(0).toUpperCase()), h('strong', null, me.club.name)), nav, h('div', { class: 'side-foot' }, out)),
    h('div', { class: 'main-col' }, content)));
}

function showLink() {
  return new Promise((resolve) => {
    const code = h('input', { type: 'text', maxlength: 20, required: true, dir: 'ltr', class: 'code-input', autocomplete: 'off', 'aria-label': t('m.linkCode') });
    const msg = h('div', { class: 'form-error', role: 'alert' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, t('m.linkBtn'));
    const form = h('form', { class: 'form' }, h('p', { class: 'muted' }, t('m.linkHelp')), h('label', { class: 'field' }, h('span', null, t('m.linkCode')), code), msg, go);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); msg.textContent = ''; go.disabled = true;
      const { data, error } = await sb.rpc('claim_member_invite', { p_code: code.value });
      if (error) { msg.textContent = errText(error); go.disabled = false; return; }
      if (!data) { msg.textContent = t('m.linkBad'); go.disabled = false; return; }
      resolve();
    });
    const out = h('button', { type: 'button', class: 'btn ghost block' }, t('auth.signout'));
    out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    clear(root);
    root.append(h('main', { class: 'auth-card' }, h('h1', { class: 'brand' }, t('app.name')), h('h2', null, t('m.linkTitle')), form, out));
    code.focus();
  });
}

async function loadMe() {
  const { data: ms, error } = await sb.from('members').select('id, member_no, club_id, branch_id, full_name, status, photo_path').order('created_at');
  if (error) throw error;
  if (!ms || !ms.length) return false;
  me.member = ms[0];
  const { data: club, error: ce } = await sb.from('clubs').select('id, name, default_currency').eq('id', me.member.club_id).single();
  if (ce) throw ce;
  me.club = club;
  state.club = club; state.role = 'member'; state.branches = []; state.branchId = null;
  return true;
}

async function start() {
  clear(root); root.append(spinner());
  try {
    await handleRecovery(root);
    let { data: { session } } = await sb.auth.getSession();
    if (!session) { await showLogin(root); ({ data: { session } } = await sb.auth.getSession()); }
    state.session = session;
    clear(root); root.append(spinner());
    if (!(await loadMe())) { await showLink(); clear(root); root.append(spinner()); if (!(await loadMe())) throw new Error(t('m.linkBad')); }
    shell();
    show('home');
  } catch (e) {
    clear(root);
    root.append(h('main', { class: 'auth-card' }, h('div', { class: 'form-error' }, errText(e))));
    toast(errText(e), 'error');
  }
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
start();
