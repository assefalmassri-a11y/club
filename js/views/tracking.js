// Staff read-only view of a member's measurements and workout log (RLS limits trainers to assigned members).
import { sb } from '../supa.js';
import { h, button, fmtDate, openForm, toast } from '../dom.js';
import { t } from '../i18n.js';

export async function editPlan(member) {
  const { data: cur } = await sb.from('workout_plans').select('title, body').eq('member_id', member.id).eq('active', true).maybeSingle();
  const ok = await openForm({
    title: `${t('plan.title')}: ${member.full_name}`,
    fields: [
      { name: 'title', label: t('plan.name'), required: true, maxlength: 100, value: cur ? cur.title : '' },
      { name: 'body', label: t('plan.body'), type: 'textarea', required: true, maxlength: 4000, value: cur ? cur.body : '' },
    ],
    onSubmit: async (v) => { const { error } = await sb.rpc('save_workout_plan', { p_member: member.id, p_title: v.title, p_body: v.body }); if (error) throw error; },
  });
  if (ok === true) toast(t('plan.saved'), 'ok');
  return ok === true;
}

export async function openTracking(member) {
  const { data: plan } = await sb.from('workout_plans').select('title, body, created_at').eq('member_id', member.id).eq('active', true).maybeSingle();
  const [{ data: ms, error: e1 }, { data: ws, error: e2 }] = await Promise.all([
    sb.from('member_measurements').select('id, measured_on, weight_kg, body_fat_pct, waist_cm, chest_cm, note').eq('member_id', member.id).order('measured_on', { ascending: false }).limit(30),
    sb.from('workout_logs').select('id, done_on, exercise, sets, reps, weight_kg').eq('member_id', member.id).order('done_on', { ascending: false }).limit(40),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const v = (x) => (x == null ? '—' : String(x));
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, `${t('trk.title')}: ${member.full_name}`),
    h('h3', null, t('plan.title')),
    plan ? h('div', { class: 'card-box' }, h('strong', null, plan.title), h('div', { class: 'plan-body' }, plan.body)) : h('p', { class: 'muted' }, t('plan.none')),
    h('h3', null, t('trk.measure')),
    (ms || []).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('common.date'), t('trk.weight'), t('trk.fat'), t('trk.waist'), t('trk.chest')].map((c) => h('th', null, c)))),
      h('tbody', null, ms.map((r) => h('tr', null, h('td', { 'data-label': t('common.date') }, fmtDate(r.measured_on)), h('td', { 'data-label': t('trk.weight') }, v(r.weight_kg)), h('td', { 'data-label': t('trk.fat') }, v(r.body_fat_pct)), h('td', { 'data-label': t('trk.waist') }, v(r.waist_cm)), h('td', { 'data-label': t('trk.chest') }, v(r.chest_cm))))))) : h('p', { class: 'muted' }, t('trk.none')),
    h('h3', null, t('trk.workouts')),
    (ws || []).length ? h('div', { class: 'list-simple' }, ws.map((r) => h('div', { class: 'item' }, h('span', null, r.exercise), h('span', { class: 'muted small ltr' }, `${fmtDate(r.done_on)} · ${v(r.sets)}×${v(r.reps)} @ ${v(r.weight_kg)}kg`)))) : h('p', { class: 'muted' }, t('trk.none')),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}
