import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDateTime } from '../dom.js';
import { t } from '../i18n.js';

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }

export async function render(box) {
  const upcoming = h('input', { type: 'checkbox', checked: true, id: 'ev-upcoming' });
  const list = h('div', { class: 'table-wrap' });
  const canCreate = state.role !== 'staff' || true; // the database decides who may create events
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('ev.title')),
    h('div', { class: 'row gap' },
      h('label', { class: 'check', for: 'ev-upcoming' }, upcoming, h('span', null, t('ev.upcomingOnly'))),
      canCreate ? button(t('ev.new'), async () => { if (await guard(createEvent)) load(); }, 'btn primary') : null)), list);

  async function createEvent() {
    const ok = await openForm({
      title: t('ev.new'),
      fields: [
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: state.branchId || (state.branches[0] && state.branches[0].id) },
        { name: 'title', label: t('ev.name'), required: true, maxlength: 120 },
        { name: 'desc', label: t('ev.desc'), type: 'textarea', maxlength: 1000 },
        { name: 'starts', label: t('ev.starts'), type: 'datetime-local', required: true },
        { name: 'ends', label: t('ev.ends'), type: 'datetime-local', required: true },
        { name: 'capacity', label: t('ev.capacity'), type: 'number', required: true, min: '1', step: '1', value: '20' },
      ],
      onSubmit: async (v) => {
        const starts = new Date(v.starts);
        const ends = new Date(v.ends);
        const cap = Number(v.capacity);
        if (!(starts < ends) || !Number.isInteger(cap) || cap < 1) throw new Error(t('err.invalid'));
        const { error } = await sb.rpc('create_event', {
          p_branch_id: v.branch, p_title: v.title, p_description: v.desc || null, p_trainer_staff_id: null,
          p_starts_at: starts.toISOString(), p_ends_at: ends.toISOString(), p_capacity: cap,
        });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('ev.created'), 'ok');
    return ok === true;
  }

  async function load() {
    clear(list);
    let q = scoped(sb.from('events').select('id, branch_id, title, description, starts_at, ends_at, capacity, status').order('starts_at', { ascending: true }).limit(100));
    if (upcoming.checked) q = q.gte('ends_at', new Date().toISOString());
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const body = rows.map((ev) => h('tr', null,
      h('td', { 'data-label': t('ev.name') }, h('strong', null, ev.title), ev.description ? h('div', { class: 'muted small' }, ev.description) : null),
      h('td', { 'data-label': t('common.branch') }, branchName(ev.branch_id)),
      h('td', { 'data-label': t('ev.starts') }, fmtDateTime(ev.starts_at)),
      h('td', { 'data-label': t('ev.capacity') }, String(ev.capacity)),
      h('td', { 'data-label': t('common.status') }, ev.status === 'cancelled' ? badge(t('ev.cancelled'), 'bad') : badge(t('ev.scheduled'), 'ok')),
      h('td', { class: 'actions', 'data-label': t('common.actions') },
        ev.status === 'scheduled' ? button(t('ev.cancel'), async () => {
          const ok = await openForm({
            title: `${t('ev.cancel')}: ${ev.title}`,
            fields: [{ name: 'reason', label: t('common.reason'), type: 'textarea', required: true, maxlength: 300 }],
            onSubmit: async (v) => {
              const { error: e } = await sb.rpc('cancel_event', { p_event_id: ev.id, p_reason: v.reason });
              if (e) throw e;
            },
          });
          if (ok === true) { toast(t('ev.cancelDone'), 'ok'); load(); }
        }, 'btn small') : null)));
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('ev.name'), t('common.branch'), t('ev.starts'), t('ev.capacity'), t('common.status'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, body)));
  }

  upcoming.addEventListener('change', () => guard(load));
  await load();
  return null;
}
