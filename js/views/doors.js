import { sb } from '../supa.js';
import { state, scoped } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDateTime } from '../dom.js';
import { t } from '../i18n.js';

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }

function reasonText(r) { const k = `m.reason.${r}`; return t(k) === k ? String(r || '') : t(k); }

function showSecret(title, rows) {
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, title),
    rows.map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'muted small' }, k), h('div', { class: 'secret', dir: 'ltr' }, String(v)))),
    h('p', { class: 'muted small' }, `${t('common.copyHint')} ${t('door.secretHelp')}`),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  document.body.append(overlay);
}

export async function render(box) {
  const doorsEl = h('div', { class: 'table-wrap' });
  const cardsEl = h('div', { class: 'table-wrap' });
  const attEl = h('div', { class: 'table-wrap' });
  box.append(
    h('div', { class: 'row between wrap' }, h('h2', null, t('door.title')), button(t('door.add'), async () => { if (await guard(addDoor)) load(); }, 'btn primary')), doorsEl,
    h('h3', { class: 'section' }, t('door.cards')), cardsEl,
    h('h3', { class: 'section' }, t('door.attempts')), attEl);

  async function addDoor() {
    let created = null;
    const ok = await openForm({
      title: t('door.add'),
      fields: [
        { name: 'name', label: t('door.name'), required: true, maxlength: 60 },
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: state.branchId || (state.branches[0] && state.branches[0].id) },
        { name: 'dir', label: t('door.direction'), type: 'select', required: true, options: [{ value: 'entry', label: t('door.entry') }, { value: 'exit', label: t('door.exit') }] },
      ],
      onSubmit: async (v) => {
        const { data, error } = await sb.rpc('create_door', { p_branch_id: v.branch, p_name: v.name, p_direction: v.dir });
        if (error) throw error;
        created = Array.isArray(data) ? data[0] : data;
      },
    });
    if (ok === true && created) { toast(t('door.created'), 'ok'); showSecret(t('door.created'), [[t('door.id'), created.door_id], [t('door.secret'), created.secret]]); }
    return ok === true;
  }

  async function load() {
    clear(doorsEl); clear(cardsEl); clear(attEl);
    const { data: doors, error } = await scoped(sb.from('doors').select('id, branch_id, name, active, direction').order('created_at'));
    if (error) throw error;
    const dn = new Map((doors || []).map((d) => [d.id, d.name]));
    if (!doors || !doors.length) doorsEl.append(h('p', { class: 'muted' }, t('common.empty')));
    else doorsEl.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('door.name'), t('common.branch'), t('door.direction'), t('common.status'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, doors.map((d) => h('tr', null,
        h('td', { 'data-label': t('door.name') }, h('strong', null, d.name), h('div', { class: 'muted small ltr' }, d.id)),
        h('td', { 'data-label': t('common.branch') }, branchName(d.branch_id)),
        h('td', { 'data-label': t('door.direction') }, t(`door.${d.direction}`)),
        h('td', { 'data-label': t('common.status') }, badge(d.active ? t('door.active') : t('door.inactive'), d.active ? 'ok' : '')),
        h('td', { class: 'actions', 'data-label': t('common.actions') },
          button(d.active ? t('door.disable') : t('door.enable'), () => guard(async () => { const { error: e } = await sb.rpc('set_door_active', { p_door_id: d.id, p_active: !d.active }); if (e) throw e; await load(); }), 'btn small'),
          button(t('door.rotate'), () => guard(async () => { const { data: s, error: e } = await sb.rpc('rotate_door_secret', { p_door_id: d.id }); if (e) throw e; showSecret(t('door.rotate'), [[t('door.id'), d.id], [t('door.secret'), s]]); }), 'btn small')))))));

    const { data: cards } = await scoped(sb.from('access_cards').select('id, member_id, uid_suffix, label, status, issued_at').order('issued_at', { ascending: false }).limit(100));
    const ids = [...new Set((cards || []).map((c) => c.member_id))];
    const names = new Map();
    if (ids.length) { const { data: ms } = await sb.from('members').select('id, full_name').in('id', ids); for (const m of ms || []) names.set(m.id, m.full_name); }
    if (!cards || !cards.length) cardsEl.append(h('p', { class: 'muted' }, t('door.noCards')));
    else cardsEl.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('inv.member'), 'UID', t('mem.cardLabel'), t('common.status'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, cards.map((c) => h('tr', null,
        h('td', { 'data-label': t('inv.member') }, names.get(c.member_id) || t('common.none')),
        h('td', { 'data-label': 'UID' }, h('span', { class: 'ltr' }, `••${c.uid_suffix || ''}`)),
        h('td', { 'data-label': t('mem.cardLabel') }, c.label || ''),
        h('td', { 'data-label': t('common.status') }, badge(String(c.status) === 'active' ? t('door.card.active') : t('door.card.revoked'), String(c.status) === 'active' ? 'ok' : 'bad')),
        h('td', { class: 'actions', 'data-label': t('common.actions') }, String(c.status) === 'active' ? button(t('door.revoke'), async () => {
          const ok = await openForm({
            title: t('door.revoke'),
            fields: [{ name: 'reason', label: t('common.reason'), type: 'textarea', required: true, maxlength: 300 }],
            onSubmit: async (v) => { const { error: e } = await sb.rpc('revoke_card', { p_card_id: c.id, p_reason: v.reason }); if (e) throw e; },
          });
          if (ok === true) { toast(t('door.revoked'), 'ok'); load(); }
        }, 'btn small') : null))))));

    const { data: att } = await scoped(sb.from('door_attempts').select('id, door_id, member_id, granted, reason, method, created_at').order('created_at', { ascending: false }).limit(30));
    const aids = [...new Set((att || []).map((a) => a.member_id).filter(Boolean))];
    if (aids.length) { const { data: ms } = await sb.from('members').select('id, full_name').in('id', aids); for (const m of ms || []) names.set(m.id, m.full_name); }
    if (!att || !att.length) attEl.append(h('p', { class: 'muted' }, t('common.empty')));
    else attEl.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('common.date'), t('door.name'), t('inv.member'), t('door.method'), t('common.status')].map((c) => h('th', null, c)))),
      h('tbody', null, att.map((a) => h('tr', null,
        h('td', { 'data-label': t('common.date') }, fmtDateTime(a.created_at)),
        h('td', { 'data-label': t('door.name') }, dn.get(a.door_id) || ''),
        h('td', { 'data-label': t('inv.member') }, names.get(a.member_id) || t('common.none')),
        h('td', { 'data-label': t('door.method') }, a.method || ''),
        h('td', { 'data-label': t('common.status') }, badge(a.granted ? t('door.granted') : `${t('door.denied')}: ${reasonText(a.reason)}`, a.granted ? 'ok' : 'bad')))))));
  }
  await load();
  return null;
}
