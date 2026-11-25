import { sb } from './supa.js';
import { gate, handleRecovery } from './auth.js';
import { installErrorLog } from './errlog.js';
import { state } from './state.js';
import { h, clear, spinner, toast, errText, openForm } from './dom.js';
import { t, initLang } from './i18n.js';
import { initTheme } from './theme.js';
import { icon } from './icons.js';

import * as overview from './views/overview.js';
import * as members from './views/members.js';
import * as review from './views/review.js';
import * as invoices from './views/invoices.js';
import * as events from './views/events.js';
import * as chat from './views/chat.js';
import * as ledger from './views/ledger.js';
import * as doors from './views/doors.js';
import * as staff from './views/staff.js';
import * as settings from './views/settings.js';
import * as reports from './views/reports.js';
import * as clients from './views/clients.js';
import * as coach from './views/coach.js';
import * as analytics from './views/analytics.js';
import * as shop from './views/shop.js';
import * as equipment from './views/equipment.js';
import * as reception from './views/reception.js';
import * as audit from './views/audit.js';
import * as platform from './views/platform.js';

const root = document.getElementById('app');
initLang();
initTheme();
installErrorLog('staff');

const TABS = [
  { id: 'overview', g: 'main', view: overview, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'coach', g: 'main', view: coach, roles: ['trainer'] },
  { id: 'reception', g: 'main', view: reception, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'members', g: 'people', view: members, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'review', g: 'people', view: review, roles: ['owner', 'branch_manager'] },
  { id: 'invoices', g: 'people', view: invoices, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'clients', g: 'people', view: clients, roles: ['owner', 'branch_manager'] },
  { id: 'events', g: 'people', view: events, roles: ['owner', 'branch_manager', 'trainer', 'staff'] },
  { id: 'chat', g: 'people', view: chat, roles: ['owner', 'branch_manager', 'trainer', 'staff'] },
  { id: 'shop', g: 'biz', view: shop, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'equipment', g: 'biz', view: equipment, roles: ['owner', 'branch_manager', 'staff'] },
  { id: 'ledger', g: 'biz', view: ledger, roles: ['owner', 'branch_manager'] },
  { id: 'reports', g: 'biz', view: reports, roles: ['owner', 'branch_manager'] },
  { id: 'analytics', g: 'biz', view: analytics, roles: ['owner', 'branch_manager'] },
  { id: 'doors', g: 'sys', view: doors, roles: ['owner', 'branch_manager'] },
  { id: 'staff', g: 'sys', view: staff, roles: ['owner', 'branch_manager'] },
  { id: 'audit', g: 'sys', view: audit, roles: ['owner'] },
  { id: 'platform', g: 'sys', view: platform, roles: ['owner', 'branch_manager', 'staff', 'trainer'], platformOnly: true },
  { id: 'settings', g: 'sys', view: settings, roles: ['owner', 'branch_manager', 'trainer', 'staff'] },
];

let currentTab = null;
let cleanup = null;
let content = null;
let nav = null;

async function loadContext() {
  const uid = state.session.user.id;
  const { data: rows, error } = await sb.from('staff').select('id, club_id, role, branch_id').eq('user_id', uid);
  if (error) throw error;
  state.staffRows = rows || [];
  const ids = [...new Set(state.staffRows.map((r) => r.club_id))];
  state.clubs = {};
  if (ids.length) {
    const { data: clubs, error: e2 } = await sb.from('clubs').select('id, name, slug, default_currency, timezone').in('id', ids);
    if (e2) throw e2;
    for (const c of clubs || []) state.clubs[c.id] = c;
  }
}

async function selectClub(clubId) {
  const row = state.staffRows.find((r) => r.club_id === clubId);
  state.club = state.clubs[clubId];
  state.role = row.role;
  const { data, error } = await sb.from('branches').select('id, name').eq('club_id', clubId).order('created_at');
  if (error) throw error;
  state.branches = data || [];
  state.branchId = state.role === 'owner' ? null : (row.branch_id || (state.branches[0] && state.branches[0].id) || null);
  try { localStorage.setItem('club.last', clubId); } catch (_) { /* storage may be unavailable */ }
}

function showNoClub() {
  clear(root);
  const create = h('button', { class: 'btn primary block', type: 'button' }, t('ctx.createClub'));
  const out = h('button', { class: 'link', type: 'button' }, t('auth.signout'));
  create.addEventListener('click', async () => {
    const ok = await openForm({
      title: t('ctx.createClub'),
      fields: [
        { name: 'name', label: t('ctx.clubName'), required: true, maxlength: 80 },
        { name: 'slug', label: t('ctx.slug'), required: true, maxlength: 40, dir: 'ltr', placeholder: 'my-gym' },
        { name: 'currency', label: t('ctx.currency'), required: true, maxlength: 3, dir: 'ltr', value: 'SYP' },
        { name: 'branch', label: t('ctx.firstBranch'), required: true, maxlength: 80 },
        { name: 'tz', label: t('ctx.timezone'), required: true, dir: 'ltr', value: 'Asia/Damascus' },
      ],
      onSubmit: async (v) => {
        if (!/^[a-z0-9-]{3,40}$/.test(v.slug)) throw new Error(t('err.invalid'));
        if (!/^[A-Za-z]{3}$/.test(v.currency)) throw new Error(t('err.invalid'));
        const { error } = await sb.rpc('create_club', { p_name: v.name, p_slug: v.slug, p_currency: v.currency.toUpperCase(), p_first_branch: v.branch, p_timezone: v.tz });
        if (error) throw error;
      },
    });
    if (ok) start();
  });
  out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  root.append(h('main', { class: 'auth-card' }, h('h1', { class: 'brand' }, t('app.name')), h('h2', null, t('ctx.noClubTitle')), h('p', { class: 'muted' }, t('ctx.noClubHelp')), create, out));
}

function visibleTabs() { return TABS.filter((tb) => tb.roles.includes(state.role) && (!tb.platformOnly || state.isPlatformAdmin)); }

async function show(tabId) {
  if (typeof cleanup === 'function') { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
  currentTab = tabId;
  for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tabId);
  const cur = nav.querySelector(`[data-tab="${tabId}"]`);
  const mb = nav.querySelector('[data-more]');
  if (mb) mb.classList.toggle('active', !!cur && cur.classList.contains('more-item'));
  clear(content);
  content.append(spinner());
  const tab = TABS.find((x) => x.id === tabId);
  const box = h('div', { class: 'view' });
  try {
    cleanup = await tab.view.render(box, { rerender: () => show(tabId), goto: show });
  } catch (e) {
    box.append(h('div', { class: 'form-error' }, errText(e)));
  }
  clear(content);
  content.append(box);
}

function renderShell() {
  clear(root);
  const clubSel = h('select', { 'aria-label': t('ctx.club') }, Object.values(state.clubs).map((c) => h('option', { value: c.id, selected: c.id === state.club.id }, c.name)));
  clubSel.addEventListener('change', async () => { await selectClub(clubSel.value); renderShell(); show(visibleTabs()[0].id); });

  const branchOptions = [];
  if (state.role === 'owner' || state.branches.length > 1) branchOptions.push(h('option', { value: '' }, t('ctx.allBranches')));
  for (const b of state.branches) branchOptions.push(h('option', { value: b.id, selected: b.id === state.branchId }, b.name));
  const branchSel = h('select', { 'aria-label': t('common.branch') }, branchOptions);
  branchSel.addEventListener('change', () => { state.branchId = branchSel.value || null; show(currentTab); });

  const out = h('button', { type: 'button', class: 'btn ghost', 'aria-label': t('auth.signout') }, icon('logout', 18), h('span', { class: 'lbl' }, t('auth.signout')));
  out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

  const vis = visibleTabs();
  const MAIN = 4; // on phones: 4 primary tabs + a "More" sheet
  const navButtons = vis.flatMap((tb, i) => [i === 0 || vis[i - 1].g !== tb.g ? h('div', { class: 'nav-group' }, t(`grp.${tb.g}`)) : null, h('button', { type: 'button', 'data-tab': tb.id, class: i >= MAIN && vis.length > MAIN + 1 ? 'more-item' : '', onClick: () => show(tb.id) }, icon(tb.id, 20), h('span', null, t(`tab.${tb.id}`)))]);
  const moreBtn = h('button', { type: 'button', class: 'more-btn', 'data-more': '1', onClick: () => openMore() }, icon('more', 20), h('span', null, t('tab.more')));
  function openMore() {
    const overlay = h('div', { class: 'overlay' });
    const items = vis.slice(MAIN).map((tb) => h('button', { type: 'button', class: 'btn block', onClick: () => { overlay.remove(); show(tb.id); } }, t(`tab.${tb.id}`)));
    overlay.append(h('div', { class: 'modal small' }, h('div', { class: 'menu-list' }, items), h('div', { class: 'menu-list' }, h('button', { type: 'button', class: 'btn block ghost', onClick: async () => { await sb.auth.signOut(); location.reload(); } }, t('auth.signout'))),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onClick: () => overlay.remove() }, t('common.close')))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  }
  nav = h('nav', { class: 'nav', 'aria-label': 'main' }, ...navButtons, vis.length > MAIN + 1 ? moreBtn : null);
  content = h('main', { class: 'content' });
  const initial = (state.club.name || '?').trim().charAt(0).toUpperCase();

  root.append(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, initial), h('div', null, h('strong', null, state.club.name), h('div', { class: 'muted small' }, t(`role.${state.role}`)))),
      nav, h('div', { class: 'side-foot' }, out)),
    h('div', { class: 'main-col' },
      h('header', { class: 'topbar' },
        h('div', { class: 'ctx' }, Object.keys(state.clubs).length > 1 ? clubSel : null, state.branches.length ? branchSel : null),
        h('div', { class: 'top-actions' }, out.cloneNode(true))),
      content)));
  root.querySelector('.top-actions button').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
}

async function start() {
  clear(root);
  root.append(spinner());
  try {
    await handleRecovery(root);
    state.session = await gate(root);
    clear(root);
    root.append(spinner());
    await loadContext();
    try { const { data: pa } = await sb.rpc('is_platform_admin'); state.isPlatformAdmin = pa === true; } catch (_) { state.isPlatformAdmin = false; }
    if (!state.staffRows.length) { showNoClub(); return; }
    let last = null;
    try { last = localStorage.getItem('club.last'); } catch (_) { /* ignore */ }
    const clubId = state.clubs[last] ? last : state.staffRows[0].club_id;
    await selectClub(clubId);
    renderShell();
    const requested = state.openConversation ? 'chat' : visibleTabs()[0].id;
    show(requested);
  } catch (e) {
    clear(root);
    root.append(h('main', { class: 'auth-card' }, h('div', { class: 'form-error' }, errText(e))));
    toast(errText(e), 'error');
  }
}

sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
}

start();
