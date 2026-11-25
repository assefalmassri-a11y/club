// Platform owner console: clubs (subscription, details, delete), plans, platform admins and the platform log.
import { sb } from '../supa.js';
import { h, openForm, toast, fmtDate, fmtDateTime, fmtMoney, button, badge, guard, confirmBox } from '../dom.js';
import { t } from '../i18n.js';
import { resetBrandingOptions } from '../brand.js';

const STATUSES = ['trial', 'active', 'past_due', 'suspended'];
const TONE = { trial: 'warn', active: 'ok', past_due: 'warn', suspended: 'bad' };
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };

function table(heads, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, t('common.empty'));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, heads.map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c, i) => h('td', { 'data-label': heads[i] }, c)))))));
}

export async function render(box, ctx) {
  const [clubs, plans, admins, log, branding] = await Promise.all([
    rpc('platform_list_clubs'), rpc('platform_list_plans'), rpc('platform_list_admins'), rpc('platform_list_log', { p_limit: 50 }), rpc('branding_options')]);
  const again = () => ctx.rerender();
  const planCodes = (plans || []).map((p) => p.code);

  box.append(h('h2', null, t('plat.title')), h('p', { class: 'muted small' }, t('plat.help')),
    table([t('plat.club'), t('plat.plan'), t('plat.status'), t('plat.trialEnds'), t('plat.periodEnd'), t('plat.usage'), ''],
      (clubs || []).map((r) => [
        h('span', null, h('strong', null, r.name), h('div', { class: 'muted small ltr' }, r.slug)),
        r.plan_code, badge(t(`plat.st.${r.status}`), TONE[r.status] || ''),
        r.trial_ends_on ? fmtDate(r.trial_ends_on) : '—', r.current_period_end ? fmtDate(r.current_period_end) : '—', `${r.branches} / ${r.members}`,
        h('div', { class: 'row gap wrap' },
          button(t('plat.edit'), () => guard(() => editSubscription(r, planCodes, again)), 'btn small'),
          button(t('plat.details'), () => guard(() => showDetail(r)), 'btn small'),
          button(t('plat.delete'), () => guard(() => deleteClub(r, again)), 'btn small ghost'))])),
    h('div', { class: 'row between wrap' }, h('h3', { class: 'section' }, t('plat.plans')), button(t('plat.addPlan'), () => guard(() => editPlan(null, again)), 'btn small')),
    table([t('plat.planCode'), t('mem.planName'), t('plat.maxBranches'), t('plat.maxMembers'), t('inv.amount'), t('common.status'), ''],
      (plans || []).map((p) => [h('span', { class: 'ltr' }, p.code), p.name, p.max_branches ?? t('sub.unlimited'), p.max_members ?? t('sub.unlimited'),
        p.price_cents == null ? '—' : h('bdi', null, fmtMoney(p.price_cents, String(p.currency || 'USD').trim())), badge(p.active ? t('door.active') : t('door.inactive'), p.active ? 'ok' : ''),
        button(t('mem.edit'), () => guard(() => editPlan(p, again)), 'btn small')])),
    h('div', { class: 'row between wrap' }, h('h3', { class: 'section' }, t('plat.branding')), button(t('plat.brandingEdit'), () => guard(() => editBranding(branding, again)), 'btn small')),
    h('p', { class: 'muted small' }, t('plat.brandingHelp')),
    h('div', { class: 'row gap wrap' },
      (branding.palette || []).map((c) => { const sw = h('span', { class: 'swatch', title: c }); sw.style.background = c; return sw; }),
      badge(`${t('plat.allowCustom')}: ${branding.allow_custom ? t('plat.on') : t('plat.off')}`, branding.allow_custom ? 'ok' : ''),
      badge(`${t('plat.allowLogo')}: ${branding.allow_logo ? t('plat.on') : t('plat.off')}`, branding.allow_logo ? 'ok' : ''),
      badge(`${t('plat.allowTheme')}: ${branding.allow_theme ? t('plat.on') : t('plat.off')}`, branding.allow_theme ? 'ok' : '')),
    h('div', { class: 'row between wrap' }, h('h3', { class: 'section' }, t('plat.admins')), button(t('plat.addAdmin'), () => guard(() => addAdmin(again)), 'btn small')),
    table([t('mem.email'), t('common.date'), ''],
      (admins || []).map((a) => [h('span', { class: 'ltr' }, a.email), fmtDate(a.created_at),
        button(t('staff.remove'), () => guard(() => removeAdmin(a, again)), 'btn small ghost')])),
    h('h3', { class: 'section' }, t('plat.log')),
    table([t('common.date'), t('plat.actor'), t('plat.action'), t('aud.details')],
      (log || []).map((l) => [fmtDateTime(l.at), h('span', { class: 'ltr' }, l.actor_email || '—'), l.action, h('span', { class: 'ltr small' }, JSON.stringify(l.detail || {}))])));
  return null;
}

async function editSubscription(r, planCodes, again) {
  const ok = await openForm({
    title: `${t('plat.edit')}: ${r.name}`,
    fields: [
      { name: 'plan', label: t('plat.plan'), type: 'select', required: true, value: r.plan_code, options: planCodes.map((p) => ({ value: p, label: p })) },
      { name: 'status', label: t('plat.status'), type: 'select', required: true, value: r.status, options: STATUSES.map((s) => ({ value: s, label: t(`plat.st.${s}`) })) },
      { name: 'trial', label: t('plat.trialEnds'), type: 'date', value: r.trial_ends_on || '', dir: 'ltr' },
      { name: 'period', label: t('plat.periodEnd'), type: 'date', value: r.current_period_end || '', dir: 'ltr' },
      { name: 'notes', label: t('plat.notes'), type: 'textarea', maxlength: 500, value: r.notes || '' },
    ],
    onSubmit: (v) => rpc('platform_set_subscription', { p_club: r.club_id, p_plan: v.plan, p_status: v.status, p_trial_ends: v.trial || null, p_period_end: v.period || null, p_notes: v.notes || '' }),
  });
  if (ok) { toast(t('plat.saved'), 'ok'); again(); }
}

async function showDetail(r) {
  const d = await rpc('platform_club_detail', { p_club: r.club_id });
  const overlay = h('div', { class: 'overlay' });
  const row = (k, v) => h('tr', null, h('th', null, k), h('td', null, v));
  overlay.append(h('div', { class: 'modal' }, h('h2', null, r.name),
    h('table', { class: 'tbl' }, h('tbody', null,
      row(t('plat.owners'), h('span', { class: 'ltr' }, (d.owners || []).join(', ') || '—')),
      row(t('plat.staff'), String(d.staff)), row(t('ctx.allBranches'), String(d.branches)),
      row(t('ov.members'), `${d.active_members} / ${d.members}`), row(t('tab.doors'), String(d.doors)),
      row(t('tab.invoices'), String(d.invoices)), row(t('plat.lastCheckin'), d.last_checkin ? fmtDateTime(d.last_checkin) : '—'))),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

async function deleteClub(r, again) {
  const ok = await openForm({
    title: `${t('plat.delete')}: ${r.name}`,
    submitLabel: t('plat.delete'),
    fields: [{ name: 'confirm', label: t('plat.deleteConfirm', { slug: r.slug }), required: true, dir: 'ltr', maxlength: 60 }],
    onSubmit: async (v) => {
      if (v.confirm.trim() !== r.slug) throw new Error(t('plat.deleteMismatch'));
      await rpc('platform_delete_club', { p_club: r.club_id, p_confirm: v.confirm.trim() });
    },
  });
  if (ok) { toast(t('plat.deleted'), 'ok'); again(); }
}

async function editPlan(p, again) {
  const ok = await openForm({
    title: p ? `${t('mem.edit')}: ${p.name}` : t('plat.addPlan'),
    fields: [
      { name: 'code', label: t('plat.planCode'), required: true, value: p ? p.code : '', dir: 'ltr', maxlength: 20, pattern: '[a-z0-9_]{2,20}' },
      { name: 'name', label: t('mem.planName'), required: true, value: p ? p.name : '', maxlength: 60 },
      { name: 'branches', label: t('plat.maxBranches'), type: 'number', min: 1, step: 1, value: p && p.max_branches != null ? p.max_branches : '' },
      { name: 'members', label: t('plat.maxMembers'), type: 'number', min: 1, step: 1, value: p && p.max_members != null ? p.max_members : '' },
      { name: 'price', label: t('inv.amount'), type: 'number', min: 0, step: 1, value: p && p.price_cents != null ? p.price_cents / 100 : '' },
      { name: 'currency', label: t('inv.currency'), value: p && p.currency ? String(p.currency).trim() : 'USD', dir: 'ltr', maxlength: 3 },
      { name: 'active', label: t('common.status'), type: 'select', required: true, value: p && !p.active ? 'no' : 'yes', options: [{ value: 'yes', label: t('door.active') }, { value: 'no', label: t('door.inactive') }] },
    ],
    onSubmit: (v) => rpc('platform_save_plan', {
      p_code: v.code.trim(), p_name: v.name.trim(), p_max_branches: v.branches === '' ? null : Number(v.branches), p_max_members: v.members === '' ? null : Number(v.members),
      p_price_cents: v.price === '' ? null : Math.round(Number(v.price) * 100), p_currency: v.currency.trim(), p_active: v.active === 'yes' }),
  });
  if (ok) { toast(t('plat.saved'), 'ok'); again(); }
}

async function addAdmin(again) {
  const ok = await openForm({
    title: t('plat.addAdmin'),
    fields: [{ name: 'email', label: t('mem.email'), type: 'email', required: true, dir: 'ltr', maxlength: 120 }],
    onSubmit: (v) => rpc('platform_add_admin', { p_email: v.email }),
  });
  if (ok) { toast(t('plat.saved'), 'ok'); again(); }
}

async function removeAdmin(a, again) {
  if (!(await confirmBox(t('plat.removeAdminConfirm', { email: a.email })))) return;
  await rpc('platform_remove_admin', { p_user: a.user_id });
  toast(t('plat.saved'), 'ok'); again();
}

async function editBranding(b, again) {
  const yesNo = [{ value: 'yes', label: t('plat.on') }, { value: 'no', label: t('plat.off') }];
  const ok = await openForm({
    title: t('plat.branding'),
    fields: [
      { name: 'palette', label: t('plat.palette'), type: 'textarea', required: true, value: (b.palette || []).join(' '), dir: 'ltr', maxlength: 200 },
      { name: 'custom', label: t('plat.allowCustom'), type: 'select', required: true, value: b.allow_custom ? 'yes' : 'no', options: yesNo },
      { name: 'logo', label: t('plat.allowLogo'), type: 'select', required: true, value: b.allow_logo ? 'yes' : 'no', options: yesNo },
      { name: 'theme', label: t('plat.allowTheme'), type: 'select', required: true, value: b.allow_theme ? 'yes' : 'no', options: yesNo },
    ],
    onSubmit: (v) => rpc('platform_set_branding', { p_palette: v.palette.toLowerCase().split(/[\s,]+/).filter(Boolean), p_allow_custom: v.custom === 'yes', p_allow_logo: v.logo === 'yes', p_allow_theme: v.theme === 'yes' }),
  });
  if (ok) { resetBrandingOptions(); toast(t('plat.saved'), 'ok'); again(); }
}
