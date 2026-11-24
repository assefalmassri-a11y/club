// Per-trainer report (owner only): classes, attendance, rating, PT sessions, clients and salary on one page.
import { sb } from '../supa.js';
import { state, currency } from '../state.js';
import { h, clear, button, guard, fmtMoney, fmtDateTime, decimals } from '../dom.js';
import { t } from '../i18n.js';
import { downloadCsv } from '../csv.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tile = (label, value, tone) => h('div', { class: `tile ${tone || ''}` }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value));

export async function openTrainerReport(row) {
  const month = h('input', { type: 'month', value: iso(new Date()).slice(0, 7), 'aria-label': t('pay.month') });
  const out = h('div');
  let rep = null;
  async function load() {
    clear(out);
    const [y, m] = month.value.split('-').map(Number);
    if (!y || !m) return;
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = iso(new Date(y, m, 0));
    const { data, error } = await sb.rpc('trainer_report', { p_club: state.club.id, p_staff: row.id, p_from: from, p_to: to });
    if (error) throw error;
    rep = data || {};
    const cls = rep.classes || [];
    const reg = cls.reduce((a, c) => a + Number(c.registered || 0), 0);
    const att = cls.reduce((a, c) => a + Number(c.attended || 0), 0);
    const cap = cls.reduce((a, c) => a + Number(c.capacity || 0), 0);
    const votes = cls.reduce((a, c) => a + Number(c.votes || 0), 0);
    const stars = votes ? cls.reduce((a, c) => a + Number(c.avg_stars || 0) * Number(c.votes || 0), 0) / votes : null;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    const pay = rep.pay || {};
    const cur = String(pay.currency || currency()).trim();
    const pt = rep.pt || {};
    out.append(
      h('div', { class: 'tiles' },
        tile(t('tr.classes'), String(cls.length), 'indigo'),
        tile(t('tr.attendance'), pct(att, reg), 'ok'),
        tile(t('tr.fill'), pct(reg, cap), 'sky'),
        tile(t('tr.rating'), stars == null ? '—' : stars.toFixed(1), 'warn'),
        tile(t('tr.pt'), String(pt.done || 0), 'violet'),
        tile(t('tr.clients'), String(rep.clients || 0), 'rose'),
        tile(t('tr.pay'), cur ? h('bdi', null, fmtMoney(pay.amount || 0, cur)) : '—', 'ok')),
      cls.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, [t('tab.events'), t('common.date'), t('pay.attendees'), t('tr.rating')].map((c) => h('th', null, c)))),
        h('tbody', null, cls.map((c) => h('tr', null,
          h('td', { 'data-label': t('tab.events') }, c.title),
          h('td', { 'data-label': t('common.date') }, fmtDateTime(c.starts_at)),
          h('td', { 'data-label': t('pay.attendees') }, `${c.attended}/${c.registered} (${c.capacity})`),
          h('td', { 'data-label': t('tr.rating') }, c.votes ? `${Number(c.avg_stars).toFixed(1)} ★ (${c.votes})` : '—')))))) : h('p', { class: 'muted' }, t('tr.noClasses')));
  }
  month.addEventListener('change', () => guard(load));
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal wide' }, h('h2', null, `${t('tr.title')}: `, h('span', { class: 'ltr' }, row.email || '')),
    h('label', { class: 'field' }, h('span', null, t('pay.month')), month), out,
    h('div', { class: 'row end' },
      button(t('rep.export'), () => rep && downloadCsv(`trainer-${month.value}.csv`, ['title', 'starts_at', 'capacity', 'registered', 'attended', 'avg_stars', 'votes'],
        (rep.classes || []).map((c) => [c.title, c.starts_at, c.capacity, c.registered, c.attended, c.avg_stars, c.votes]))),
      button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  await guard(load);
}
