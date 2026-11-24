import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, confirmBox } from '../dom.js';
import { t } from '../i18n.js';
import { openPayroll } from './payroll.js';
import { openTrainerReport } from './trainer-report.js';

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }

export async function render(box) {
  const list = h('div', { class: 'table-wrap' });
  const isOwner = state.role === 'owner';
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('staff.title')),
    isOwner ? h('div', { class: 'row gap' }, button(t('pay.title'), () => guard(openPayroll)), button(t('staff.add'), async () => { if (await guard(addStaff)) load(); }, 'btn primary')) : null), list);

  async function addStaff() {
    const ok = await openForm({
      title: t('staff.add'),
      fields: [
        { name: 'email', label: t('staff.email'), type: 'email', required: true, maxlength: 120, dir: 'ltr' },
        { name: 'role', label: t('staff.role'), type: 'select', required: true, options: ['branch_manager', 'trainer', 'staff'].map((r) => ({ value: r, label: t(`role.${r}`) })), value: 'staff' },
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: state.branchId || (state.branches[0] && state.branches[0].id) },
      ],
      onSubmit: async (v) => {
        const { error } = await sb.rpc('add_staff_by_email', { p_club: state.club.id, p_email: v.email, p_role: v.role, p_branch: v.branch });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('staff.added'), 'ok');
    return ok === true;
  }

  async function load() {
    clear(list);
    const { data, error } = await sb.rpc('staff_directory', { p_club: state.club.id });
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const me = state.session.user.id;
    const body = rows.map((r) => h('tr', null,
      h('td', { 'data-label': t('staff.email') }, h('span', { class: 'ltr' }, r.email || ''), r.user_id === me ? h('span', { class: 'muted small' }, ` (${t('staff.you')})`) : null),
      h('td', { 'data-label': t('staff.role') }, badge(t(`role.${r.role}`), r.role === 'owner' ? 'ok' : '')),
      h('td', { 'data-label': t('common.branch') }, r.branch_id ? branchName(r.branch_id) : t('ctx.allBranches')),
      h('td', { class: 'actions', 'data-label': t('common.actions') },
        isOwner && r.role === 'trainer' ? button(t('tr.report'), () => openTrainerReport(r), 'btn small primary') : null,
        isOwner && r.role !== 'owner' && r.user_id !== me ? button(t('staff.remove'), async () => {
          if (!(await confirmBox(`${t('staff.remove')}: ${r.email}؟`))) return;
          await guard(async () => {
            const { error: e } = await sb.from('staff').delete().eq('id', r.id);
            if (e) throw e;
            toast(t('staff.removed'), 'ok');
            await load();
          });
        }, 'btn small') : null)));
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('staff.email'), t('staff.role'), t('common.branch'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, body)));
  }
  if (isOwner) box.append(h('p', { class: 'muted small' }, t('staff.help')));
  await load();
  return null;
}
