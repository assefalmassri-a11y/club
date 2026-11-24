import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, fmtDateTime } from '../dom.js';
import { t } from '../i18n.js';

const DOMAINS = ['finance', 'access', 'events', 'attendance'];
const short = (v) => (v ? String(v).slice(0, 8) : '—');

export async function render(box) {
  const sel = h('select', { 'aria-label': t('aud.domain') }, h('option', { value: '' }, t('common.all')), DOMAINS.map((d) => h('option', { value: d }, d)));
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('aud.title')), sel), h('p', { class: 'muted small' }, t('aud.help')), list);
  async function load() {
    let q = sb.from('audit_log').select('id, chain_no, domain, operation, actor, target_id, details, created_at').eq('club_id', state.club.id).order('created_at', { ascending: false }).limit(100);
    if (sel.value) q = q.eq('domain', sel.value);
    const { data, error } = await q;
    if (error) throw error;
    clear(list);
    if (!(data || []).length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    list.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, [t('common.date'), t('aud.domain'), t('aud.op'), t('aud.actor'), t('aud.target'), t('aud.details')].map((x) => h('th', null, x)))),
      h('tbody', null, data.map((r) => h('tr', null,
        h('td', { 'data-label': t('common.date') }, fmtDateTime(r.created_at)),
        h('td', { 'data-label': t('aud.domain') }, r.domain),
        h('td', { 'data-label': t('aud.op') }, r.operation),
        h('td', { 'data-label': t('aud.actor'), class: 'ltr' }, short(r.actor)),
        h('td', { 'data-label': t('aud.target'), class: 'ltr' }, short(r.target_id)),
        h('td', { 'data-label': t('aud.details'), class: 'muted small ltr' }, r.details ? JSON.stringify(r.details).slice(0, 140) : ''))))));
  }
  sel.addEventListener('change', () => load().catch(() => {}));
  await load();
  return null;
}
