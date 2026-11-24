import { sb } from '../supa.js';
import { state, canManage } from '../state.js';
import { h, clear, button, toast, guard, fmtDate, confirmBox } from '../dom.js';
import { t } from '../i18n.js';

export async function render(box, ctx) {
  const list = h('div', { class: 'table-wrap' });
  box.append(h('h2', null, t('cl.title')), list);
  async function load() {
    clear(list);
    let q = sb.from('trainer_assignments').select('id, member_id, branch_id, assigned_at').is('ended_at', null).order('assigned_at', { ascending: false }).limit(200);
    if (state.branchId) q = q.eq('branch_id', state.branchId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('cl.none'))); return; }
    const { data: ms } = await sb.from('members').select('id, full_name, phone, status').in('id', [...new Set(rows.map((r) => r.member_id))]);
    const by = new Map((ms || []).map((m) => [m.id, m]));
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('mem.name'), t('mem.phone'), t('cl.since'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, rows.map((r) => {
        const m = by.get(r.member_id) || {};
        return h('tr', null,
          h('td', { 'data-label': t('mem.name') }, h('strong', null, m.full_name || t('common.none'))),
          h('td', { 'data-label': t('mem.phone') }, h('span', { class: 'ltr' }, m.phone || '')),
          h('td', { 'data-label': t('cl.since') }, fmtDate(r.assigned_at)),
          h('td', { class: 'actions', 'data-label': t('common.actions') },
            button(t('mem.chat'), () => guard(async () => {
              const { data: c, error: e } = await sb.from('conversations').select('id').eq('kind', 'trainer').eq('member_id', r.member_id).limit(1);
              if (e) throw e;
              if (!c || !c.length) throw new Error(t('cl.noChat'));
              state.openConversation = c[0].id; ctx.goto('chat');
            }), 'btn small'),
            canManage() ? button(t('cl.end'), async () => {
              if (!(await confirmBox(`${t('cl.end')}: ${m.full_name}؟`))) return;
              await guard(async () => { const { error: e } = await sb.rpc('end_trainer_assignment', { p_assignment: r.id }); if (e) throw e; toast(t('cl.ended'), 'ok'); await load(); });
            }, 'btn small') : null));
      }))));
  }
  await load();
  return null;
}
