// Operational analytics: peak hours/days, top classes, churn (computed client-side, RLS-scoped).
import { sb } from '../supa.js';
import { scoped } from '../state.js';
import { h, today, addDays } from '../dom.js';
import { t, locale } from '../i18n.js';

function bars(title, items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('div', { class: 'card-box' }, h('h3', null, title), h('div', { class: 'bars' }, items.map((i) => {
    const fill = h('span', { class: 'bar-fill' }); fill.style.width = `${Math.round((i.value / max) * 100)}%`;
    return h('div', { class: 'bar-row' }, h('span', { class: 'bar-label' }, i.label), h('span', { class: 'bar-track' }, fill), h('bdi', { class: 'bar-val' }, String(i.value)));
  })));
}

export async function render(box) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const td = today();
  const [chk, evs, ended, cover] = await Promise.all([
    scoped(sb.from('checkins').select('checked_in_at').gte('checked_in_at', since).limit(5000)),
    scoped(sb.from('events').select('id, title').neq('status', 'cancelled').gte('starts_at', since).lt('ends_at', new Date().toISOString()).limit(500)),
    scoped(sb.from('memberships').select('member_id, ends_on').gte('ends_on', addDays(td, -60)).lt('ends_on', td).limit(5000)),
    scoped(sb.from('memberships').select('member_id').eq('status', 'active').lte('starts_on', td).gte('ends_on', td).limit(5000)),
  ]);
  for (const r of [chk, evs, ended, cover]) if (r.error) throw r.error;

  const hours = new Array(24).fill(0); const days = new Array(7).fill(0);
  for (const r of chk.data || []) { const d = new Date(r.checked_in_at); hours[d.getHours()]++; days[d.getDay()]++; }
  const dayName = (i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale(), { weekday: 'short' });
  const peak = hours.map((v, i) => ({ label: `${String(i).padStart(2, '0')}:00`, value: v })).filter((x, i) => i >= 5 && i <= 23);

  const evIds = (evs.data || []).map((e) => e.id); const title = new Map((evs.data || []).map((e) => [e.id, e.title]));
  const perTitle = new Map();
  if (evIds.length) {
    const { data: regs } = await sb.from('event_registrations').select('event_id').in('event_id', evIds).not('attended_at', 'is', null).limit(5000);
    for (const r of regs || []) { const k = title.get(r.event_id); perTitle.set(k, (perTitle.get(k) || 0) + 1); }
  }
  const top = [...perTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));

  const covered = new Set((cover.data || []).map((r) => r.member_id));
  const lapsed = new Set((ended.data || []).map((r) => r.member_id).filter((id) => !covered.has(id)));
  const rate = covered.size + lapsed.size ? Math.round((lapsed.size / (covered.size + lapsed.size)) * 100) : 0;

  box.append(h('h2', null, t('an.title')),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, `${rate}%`), h('div', { class: 'tile-label' }, t('an.churn'))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, String(lapsed.size)), h('div', { class: 'tile-label' }, t('an.lapsed60'))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, String(covered.size)), h('div', { class: 'tile-label' }, t('an.activeNow')))),
    h('div', { class: 'grid-2' }, bars(t('an.peakHours'), peak), bars(t('an.peakDays'), days.map((v, i) => ({ label: dayName(i), value: v }))),
      top.length ? bars(t('an.topClasses'), top) : h('div', { class: 'card-box' }, h('h3', null, t('an.topClasses')), h('p', { class: 'muted' }, t('common.empty')))),
    h('p', { class: 'muted small' }, t('an.note')));
  return null;
}
