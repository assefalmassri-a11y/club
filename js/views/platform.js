import { sb } from '../supa.js';
import { h, clear, openForm, toast, fmtDate, button, badge } from '../dom.js';
import { t } from '../i18n.js';

const PLANS = ['starter', 'pro', 'unlimited'];
const STATUSES = ['trial', 'active', 'past_due', 'suspended'];
const TONE = { trial: 'warn', active: 'ok', past_due: 'warn', suspended: 'bad' };

export async function render(box, ctx) {
  const { data, error } = await sb.rpc('platform_list_clubs');
  if (error) throw error;
  const rows = data || [];
  box.append(h('h2', null, t('plat.title')), h('p', { class: 'muted small' }, t('plat.help')));
  const wrap = h('div', { class: 'table-wrap' });
  box.append(wrap);
  if (!rows.length) { wrap.append(h('p', { class: 'muted' }, t('common.empty'))); return null; }
  wrap.append(h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, [t('plat.club'), t('plat.plan'), t('plat.status'), t('plat.trialEnds'), t('plat.periodEnd'), t('plat.usage'), ''].map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r) => h('tr', null,
      h('td', { 'data-label': t('plat.club') }, h('strong', null, r.name), h('div', { class: 'muted small ltr' }, r.slug)),
      h('td', { 'data-label': t('plat.plan') }, r.plan_code),
      h('td', { 'data-label': t('plat.status') }, badge(t(`plat.st.${r.status}`), TONE[r.status] || '')),
      h('td', { 'data-label': t('plat.trialEnds') }, r.trial_ends_on ? fmtDate(r.trial_ends_on) : '—'),
      h('td', { 'data-label': t('plat.periodEnd') }, r.current_period_end ? fmtDate(r.current_period_end) : '—'),
      h('td', { 'data-label': t('plat.usage') }, `${r.branches} / ${r.members}`),
      h('td', null, button(t('plat.edit'), () => edit(r, ctx), 'btn small')))))));
  return null;
}

async function edit(r, ctx) {
  const ok = await openForm({
    title: `${t('plat.edit')}: ${r.name}`,
    fields: [
      { name: 'plan', label: t('plat.plan'), type: 'select', required: true, value: r.plan_code, options: PLANS.map((p) => ({ value: p, label: p })) },
      { name: 'status', label: t('plat.status'), type: 'select', required: true, value: r.status, options: STATUSES.map((s) => ({ value: s, label: t(`plat.st.${s}`) })) },
      { name: 'trial', label: t('plat.trialEnds'), type: 'date', value: r.trial_ends_on || '', dir: 'ltr' },
      { name: 'period', label: t('plat.periodEnd'), type: 'date', value: r.current_period_end || '', dir: 'ltr' },
      { name: 'notes', label: t('plat.notes'), type: 'textarea', maxlength: 500, value: r.notes || '' },
    ],
    onSubmit: async (v) => {
      const { error } = await sb.rpc('platform_set_subscription', { p_club: r.club_id, p_plan: v.plan, p_status: v.status, p_trial_ends: v.trial || null, p_period_end: v.period || null, p_notes: v.notes || '' });
      if (error) throw error;
    },
  });
  if (ok) { toast(t('plat.saved'), 'ok'); ctx.rerender(); }
}
