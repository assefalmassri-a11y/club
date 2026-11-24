import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, button, openForm, toast, guard, errText } from '../dom.js';
import { t } from '../i18n.js';

export async function render(box) {
  const branchesEl = h('div', { class: 'list-simple' });
  const isOwner = state.role === 'owner';

  box.append(h('h2', null, t('set.title')),
    h('h3', { class: 'section' }, t('set.club')),
    h('div', { class: 'list-simple' },
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('ctx.clubName')), h('strong', null, state.club.name)),
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('set.currency')), h('strong', null, state.club.default_currency.trim())),
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('set.timezone')), h('strong', { class: 'ltr' }, state.club.timezone || ''))),
    h('div', { class: 'row between wrap section' }, h('h3', null, t('set.branches')),
      isOwner ? button(t('set.addBranch'), async () => { if (await guard(addBranch)) { await refreshBranches(); } }, 'btn small primary') : null),
    branchesEl,
    h('h3', { class: 'section' }, t('set.account')),
    h('div', { class: 'list-simple' }, h('div', { class: 'item' }, h('span', { class: 'muted' }, t('auth.email')), h('strong', { class: 'ltr' }, state.session.user.email || ''))),
    h('div', { class: 'row end', style: null }, button(t('set.changePassword'), () => guard(changePassword), 'btn')));

  async function addBranch() {
    const ok = await openForm({
      title: t('set.addBranch'),
      fields: [
        { name: 'name', label: t('set.branchName'), required: true, maxlength: 80 },
        { name: 'address', label: t('set.address'), maxlength: 200 },
      ],
      onSubmit: async (v) => {
        const { error } = await sb.from('branches').insert({ club_id: state.club.id, name: v.name, address: v.address || null });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('set.branchAdded'), 'ok');
    return ok === true;
  }

  async function changePassword() {
    await openForm({
      title: t('set.changePassword'),
      fields: [{ name: 'pw', label: t('set.newPassword'), type: 'password', required: true, maxlength: 128, dir: 'ltr' }],
      onSubmit: async (v) => {
        if (v.pw.length < 10) throw new Error(t('auth.passwordHint'));
        const { error } = await sb.auth.updateUser({ password: v.pw });
        if (error) throw error;
        toast(t('set.passwordChanged'), 'ok');
      },
    });
  }

  async function refreshBranches() {
    const { data, error } = await sb.from('branches').select('id, name, address').eq('club_id', state.club.id).order('created_at');
    if (error) throw error;
    state.branches = (data || []).filter((b) => state.branches.some((x) => x.id === b.id) || isOwner);
    while (branchesEl.firstChild) branchesEl.removeChild(branchesEl.firstChild);
    for (const b of data || []) branchesEl.append(h('div', { class: 'item' }, h('strong', null, b.name), h('span', { class: 'muted' }, b.address || '')));
  }
  await refreshBranches();
  return null;
}
