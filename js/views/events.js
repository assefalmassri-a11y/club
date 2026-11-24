import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDateTime } from '../dom.js';
import { t } from '../i18n.js';

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }

export async function openAttendance(ev) {
  const { data: regs, error } = await sb.from('event_registrations').select('member_id, status, attended_at').eq('event_id', ev.id).neq('status', 'cancelled').order('queue_no');
  if (error) throw error;
  const ids = (regs || []).map((r) => r.member_id);
  const names = new Map();
  if (ids.length) { const { data: ms } = await sb.from('members').select('id, full_name').in('id', ids); for (const m of ms || []) names.set(m.id, m.full_name); }
  const overlay = h('div', { class: 'overlay' });
  const body = h('div', { class: 'list-simple' });
  const draw = (rows) => {
    clear(body);
    if (!rows.length) { body.append(h('p', { class: 'muted' }, t('ev.noRegs'))); return; }
    for (const r of rows) {
      body.append(h('div', { class: 'item' },
        h('span', null, names.get(r.member_id) || t('common.none'), ' ', badge(t(`ev.reg.${r.status}`), r.status === 'registered' ? 'ok' : 'warn')),
        h('span', { class: 'row gap' },
          button(t('ev.present'), () => mark(r, true), r.attended_at ? 'btn small primary' : 'btn small'),
          button(t('ev.absent'), () => mark(r, false), 'btn small'))));
    }
  };
  async function mark(r, attended) {
    await guard(async () => {
      const { error: e } = await sb.rpc('mark_attendance', { p_event_id: ev.id, p_member_id: r.member_id, p_attended: attended });
      if (e) throw e;
      r.attended_at = attended ? new Date().toISOString() : null;
      draw(regs);
    });
  }
  draw(regs || []);
  overlay.append(h('div', { class: 'modal' }, h('h2', null, `${t('ev.attTitle')}: ${ev.title}`), body, h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

export async function render(box) {
  const upcoming = h('input', { type: 'checkbox', checked: true, id: 'ev-upcoming' });
  const list = h('div', { class: 'table-wrap' });
  const canCreate = state.role !== 'staff' || true; // the database decides who may create events
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('ev.title')),
    h('div', { class: 'row gap' },
      h('label', { class: 'check', for: 'ev-upcoming' }, upcoming, h('span', null, t('ev.upcomingOnly'))),
      canCreate ? button(t('ev.new'), async () => { if (await guard(createEvent)) load(); }, 'btn primary') : null)), list);

  async function createEvent() {
    let trainers = [];
    try { const { data } = await sb.rpc('staff_directory', { p_club: state.club.id }); trainers = (data || []).filter((r) => r.role === 'trainer'); } catch (_) { /* optional */ }
    const ok = await openForm({
      title: t('ev.new'),
      fields: [
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: state.branchId || (state.branches[0] && state.branches[0].id) },
        { name: 'title', label: t('ev.name'), required: true, maxlength: 120 },
        { name: 'trainer', label: t('ev.trainer'), type: 'select', options: [{ value: '', label: t('common.none') }, ...trainers.map((r) => ({ value: r.id, label: r.email }))], value: '' },
        { name: 'desc', label: t('ev.desc'), type: 'textarea', maxlength: 1000 },
        { name: 'starts', label: t('ev.starts'), type: 'datetime-local', required: true },
        { name: 'ends', label: t('ev.ends'), type: 'datetime-local', required: true },
        { name: 'capacity', label: t('ev.capacity'), type: 'number', required: true, min: '1', step: '1', value: '20' },
        { name: 'weeks', label: t('ev.weeks'), type: 'number', required: true, min: '1', max: '12', step: '1', value: '1' },
      ],
      onSubmit: async (v) => {
        const starts = new Date(v.starts);
        const ends = new Date(v.ends);
        const cap = Number(v.capacity);
        if (!(starts < ends) || !Number.isInteger(cap) || cap < 1) throw new Error(t('err.invalid'));
        const weeks = Number(v.weeks);
        if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new Error(t('err.invalid'));
        for (let i = 0; i < weeks; i++) {
          const s2 = new Date(starts); s2.setDate(s2.getDate() + 7 * i); // setDate keeps the local clock time across DST changes
          const e2 = new Date(ends); e2.setDate(e2.getDate() + 7 * i);
          const { error } = await sb.rpc('create_event', {
            p_branch_id: v.branch, p_title: v.title, p_description: v.desc || null, p_trainer_staff_id: v.trainer || null,
            p_starts_at: s2.toISOString(), p_ends_at: e2.toISOString(), p_capacity: cap,
          });
          if (error) throw new Error(i ? `${t('ev.partial', { n: i })}: ${error.message}` : error.message);
        }
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
        ev.status !== 'cancelled' ? button(t('ev.attendance'), () => guard(() => openAttendance(ev)), 'btn small') : null,
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
