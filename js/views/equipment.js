// Equipment register: status, service dates, change log.
import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDate, fmtDateTime, today } from '../dom.js';
import { t } from '../i18n.js';
import { uploadEquipmentPhoto, pickPhoto, thumb } from '../photo.js';

const KIND = { ok: 'ok', needs_service: 'warn', out_of_order: 'bad' };

export async function render(box) {
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('eq.title')),
    canManage() ? button(t('eq.add'), async () => { if (await guard(() => edit(null))) load(); }, 'btn primary') : null), list);

  async function edit(e) {
    const ok = await openForm({
      title: e ? e.name : t('eq.add'),
      fields: [
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: e ? e.branch_id : (state.branchId || (state.branches[0] && state.branches[0].id)) },
        { name: 'name', label: t('eq.name'), required: true, maxlength: 80, value: e ? e.name : '' },
        { name: 'next', label: t('eq.next'), type: 'date', value: e && e.next_service ? e.next_service : '' },
      ],
      onSubmit: async (v) => { const { error } = await sb.rpc('save_equipment', { p_id: e ? e.id : null, p_branch: v.branch, p_name: v.name, p_next: v.next || null }); if (error) throw error; },
    });
    return ok === true;
  }
  async function status(e) {
    const ok = await openForm({
      title: e.name,
      fields: [
        { name: 's', label: t('common.status'), type: 'select', required: true, options: ['ok', 'needs_service', 'out_of_order'].map((s) => ({ value: s, label: t(`eq.s.${s}`) })), value: e.status },
        { name: 'n', label: t('eq.note'), type: 'textarea', maxlength: 300, value: e.note || '' },
      ],
      onSubmit: async (v) => { const { error } = await sb.rpc('set_equipment_status', { p_id: e.id, p_status: v.s, p_note: v.n || null }); if (error) throw error; },
    });
    if (ok === true) toast(t('eq.saved'), 'ok');
    return ok === true;
  }
  async function history(e) {
    const { data } = await sb.from('equipment_logs').select('status, note, at').eq('equipment_id', e.id).order('at', { ascending: false }).limit(20);
    const overlay = h('div', { class: 'overlay' });
    overlay.append(h('div', { class: 'modal small' }, h('h2', null, e.name),
      (data || []).length ? h('div', { class: 'list-simple' }, data.map((r) => h('div', { class: 'item' }, h('span', null, badge(t(`eq.s.${r.status}`), KIND[r.status]), r.note ? ` ${r.note}` : ''), h('span', { class: 'muted small' }, fmtDateTime(r.at))))) : h('p', { class: 'muted' }, t('common.empty')),
      h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  }

  async function load() {
    clear(list);
    const { data, error } = await scoped(sb.from('equipment').select('id, branch_id, name, status, last_service, next_service, note, photo_path').order('name').limit(300));
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('eq.name'), t('common.status'), t('eq.next'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, rows.map((e) => h('tr', null,
        h('td', { 'data-label': t('eq.name') }, h('div', { class: 'row' }, thumb(e.photo_path), h('div', null, h('strong', null, e.name), e.note ? h('div', { class: 'muted small' }, e.note) : null))),
        h('td', { 'data-label': t('common.status') }, badge(t(`eq.s.${e.status}`), KIND[e.status])),
        h('td', { 'data-label': t('eq.next') }, e.next_service ? (e.next_service < today() ? badge(fmtDate(e.next_service), 'warn') : fmtDate(e.next_service)) : t('common.none')),
        h('td', { class: 'actions', 'data-label': t('common.actions') },
          button(t('eq.setStatus'), async () => { if (await guard(() => status(e))) load(); }, 'btn small primary'),
          button(t('eq.history'), () => guard(() => history(e)), 'btn small'),
          canManage() ? button(t('eq.photo'), () => guard(async () => { const f = await pickPhoto(); if (!f) return; await uploadEquipmentPhoto(state.club.id, e.id, f); toast(t('eq.photoDone'), 'ok'); load(); }), 'btn small') : null,
          canManage() ? button(t('shop.edit'), async () => { if (await guard(() => edit(e))) load(); }, 'btn small') : null))))));
  }
  await load();
  return null;
}
