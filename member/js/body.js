// Member: body measurements and workout log (own data only; enforced by RLS).
import { sb } from '../../js/supa.js';
import { h, clear, button, openForm, toast, guard, fmtDate, today, confirmBox } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

const num = (s) => { if (s === '' || s == null) return null; const n = Number(String(s).replace(',', '.')); if (!Number.isFinite(n)) throw new Error(t('err.invalid')); return n; };

// Simple inline SVG line chart of weight over time (no inline styles; CSS class sets colours).
function chart(rows) {
  const pts = rows.filter((r) => r.weight_kg != null).slice().reverse();
  if (pts.length < 2) return null;
  const W = 300; const H = 90; const vals = pts.map((p) => Number(p.weight_kg));
  const lo = Math.min(...vals); const hi = Math.max(...vals); const span = hi - lo || 1;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'wchart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t('trk.weight'));
  const xy = pts.map((p, i) => [8 + (i * (W - 16)) / (pts.length - 1), 8 + (H - 16) * (1 - (Number(p.weight_kg) - lo) / span)]);
  const line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', xy.map((q) => q.join(',')).join(' ')); line.setAttribute('class', 'wline'); svg.append(line);
  for (const q of xy) { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', q[0]); c.setAttribute('cy', q[1]); c.setAttribute('r', 3); c.setAttribute('class', 'wdot'); svg.append(c); }
  return h('div', { class: 'card-box' }, h('h3', null, t('trk.weight')), svg, h('div', { class: 'row between muted small ltr' }, h('span', null, `${vals[0]} kg`), h('span', null, `${vals[vals.length - 1]} kg`)));
}

export async function render(box) {
  const wrap = h('div');
  box.append(h('h2', null, t('trk.myTitle')), wrap);

  async function addMeasure() {
    const ok = await openForm({
      title: t('trk.addMeasure'),
      fields: [
        { name: 'd', label: t('common.date'), type: 'date', required: true, value: today() },
        { name: 'w', label: t('trk.weight'), inputmode: 'decimal', dir: 'ltr' },
        { name: 'f', label: t('trk.fat'), inputmode: 'decimal', dir: 'ltr' },
        { name: 'wa', label: t('trk.waist'), inputmode: 'decimal', dir: 'ltr' },
        { name: 'c', label: t('trk.chest'), inputmode: 'decimal', dir: 'ltr' },
      ],
      onSubmit: async (v) => {
        const row = { club_id: me.member.club_id, member_id: me.member.id, measured_on: v.d, weight_kg: num(v.w), body_fat_pct: num(v.f), waist_cm: num(v.wa), chest_cm: num(v.c) };
        if (row.weight_kg == null && row.body_fat_pct == null && row.waist_cm == null && row.chest_cm == null) throw new Error(t('err.invalid'));
        const { error } = await sb.from('member_measurements').insert(row);
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('trk.saved'), 'ok');
    return ok === true;
  }
  async function addWorkout() {
    const ok = await openForm({
      title: t('trk.addWorkout'),
      fields: [
        { name: 'd', label: t('common.date'), type: 'date', required: true, value: today() },
        { name: 'e', label: t('trk.exercise'), required: true, maxlength: 80 },
        { name: 's', label: t('trk.sets'), inputmode: 'numeric', dir: 'ltr' },
        { name: 'r', label: t('trk.reps'), inputmode: 'numeric', dir: 'ltr' },
        { name: 'w', label: t('trk.weight'), inputmode: 'decimal', dir: 'ltr' },
      ],
      onSubmit: async (v) => {
        const { error } = await sb.from('workout_logs').insert({ club_id: me.member.club_id, member_id: me.member.id, done_on: v.d, exercise: v.e, sets: num(v.s), reps: num(v.r), weight_kg: num(v.w) });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('trk.saved'), 'ok');
    return ok === true;
  }

  async function load() {
    clear(wrap);
    const [{ data: ms, error: e1 }, { data: ws, error: e2 }] = await Promise.all([
      sb.from('member_measurements').select('id, measured_on, weight_kg, body_fat_pct, waist_cm, chest_cm').eq('member_id', me.member.id).order('measured_on', { ascending: false }).limit(30),
      sb.from('workout_logs').select('id, done_on, exercise, sets, reps, weight_kg').eq('member_id', me.member.id).order('done_on', { ascending: false }).limit(40),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const v = (x) => (x == null ? '—' : String(x));
    const { data: plan } = await sb.from('workout_plans').select('title, body').eq('member_id', me.member.id).eq('active', true).maybeSingle();
    if (plan) wrap.append(h('div', { class: 'card-box section' }, h('h3', null, `${t('plan.mine')}: ${plan.title}`), h('div', { class: 'plan-body' }, plan.body)));
    wrap.append(h('div', { class: 'row gap section' }, button(t('trk.addMeasure'), async () => { if (await guard(addMeasure)) guard(load); }, 'btn primary'), button(t('trk.addWorkout'), async () => { if (await guard(addWorkout)) guard(load); }, 'btn primary')));
    const ch = chart(ms || []); if (ch) wrap.append(ch);
    wrap.append(h('h3', { class: 'section' }, t('trk.measure')));
    wrap.append((ms || []).length ? h('div', { class: 'list' }, ms.map((r) => h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('span', null, fmtDate(r.measured_on)),
        button('×', async () => { if (!(await confirmBox(t('trk.del')))) return; await guard(async () => { const { error } = await sb.from('member_measurements').delete().eq('id', r.id); if (error) throw error; await load(); }); }, 'btn small ghost')),
      h('div', { class: 'muted small ltr' }, `${t('trk.weight')} ${v(r.weight_kg)} · ${t('trk.fat')} ${v(r.body_fat_pct)} · ${t('trk.waist')} ${v(r.waist_cm)} · ${t('trk.chest')} ${v(r.chest_cm)}`)))) : h('p', { class: 'muted' }, t('trk.none')));
    wrap.append(h('h3', { class: 'section' }, t('trk.workouts')));
    wrap.append((ws || []).length ? h('div', { class: 'list' }, ws.map((r) => h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', null, r.exercise),
        button('×', async () => { if (!(await confirmBox(t('trk.del')))) return; await guard(async () => { const { error } = await sb.from('workout_logs').delete().eq('id', r.id); if (error) throw error; await load(); }); }, 'btn small ghost')),
      h('div', { class: 'muted small ltr' }, `${fmtDate(r.done_on)} · ${v(r.sets)}×${v(r.reps)} @ ${v(r.weight_kg)} kg`)))) : h('p', { class: 'muted' }, t('trk.none')));
  }
  await load();
  return null;
}
