// Manager review of members registered by front-desk staff: filter by day/week, approve one or all.
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, button, toast, guard, fmtDateTime, today, addDays } from '../dom.js';
import { t } from '../i18n.js';
import { openMemberProfile } from './member-profile.js';

const branchName = (id) => (state.branches.find((b) => b.id === id) || {}).name || t('common.none');

export async function render(box) {
  const filter = h('select', { 'aria-label': t('rv.period') },
    h('option', { value: 'today' }, t('rv.today')), h('option', { value: 'week' }, t('rv.week')), h('option', { value: 'all' }, t('common.all')));
  filter.value = 'week';
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('rv.title')), filter), h('p', { class: 'muted small' }, t('rv.help')), list);

  async function load() {
    clear(list);
    const { data, error } = await sb.rpc('members_pending_review', { p_club: state.club.id });
    if (error) throw error;
    const since = filter.value === 'today' ? `${today()}T00:00:00` : filter.value === 'week' ? `${addDays(today(), -6)}T00:00:00` : '';
    const rows = (data || []).filter((m) => !since || m.created_at >= since);
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('rv.none'))); return; }
    const approve = (ids) => guard(async () => {
      const { error: e } = await sb.rpc('approve_members', { p_ids: ids });
      if (e) throw e;
      toast(t('rv.done'), 'ok'); await load();
    });
    list.append(
      h('div', { class: 'row end' }, button(`${t('rv.approveAll')} (${rows.length})`, () => approve(rows.map((m) => m.id)), 'btn primary')),
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null, [t('mem.name'), t('mem.phone'), t('common.branch'), t('rv.by'), t('common.date'), t('common.actions')].map((c) => h('th', null, c)))),
        h('tbody', null, rows.map((m) => h('tr', null,
          h('td', { 'data-label': t('mem.name') }, h('strong', null, m.full_name), h('div', { class: 'muted small ltr' }, `#${m.member_no}`)),
          h('td', { 'data-label': t('mem.phone') }, h('span', { class: 'ltr' }, m.phone || '—')),
          h('td', { 'data-label': t('common.branch') }, branchName(m.branch_id)),
          h('td', { 'data-label': t('rv.by') }, h('span', { class: 'ltr' }, m.created_by_email || '—')),
          h('td', { 'data-label': t('common.date') }, fmtDateTime(m.created_at)),
          h('td', { class: 'actions', 'data-label': t('common.actions') },
            button(t('mem.profile'), () => openMemberProfile({ id: m.id, full_name: m.full_name, member_no: m.member_no, photo_path: null }), 'btn small'),
            button(t('rv.approve'), () => approve([m.id]), 'btn small primary')))))));
  }
  filter.addEventListener('change', () => guard(load));
  await load();
  return null;
}
