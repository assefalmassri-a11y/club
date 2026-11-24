// Achievements (streak, visits, badges) computed from the member's own check-ins + opt-in monthly leaderboard.
import { sb } from '../../js/supa.js';
import { h, toast, guard } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function render(box) {
  const { data: ins, error } = await sb.from('checkins').select('checked_in_at').eq('member_id', me.member.id).order('checked_in_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const days = new Set((ins || []).map((r) => dkey(new Date(r.checked_in_at))));
  // Streak counted in weeks with at least 2 visits is more realistic than daily; here: consecutive days, allowing today to be pending.
  let streak = 0; const d = new Date(); if (!days.has(dkey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dkey(d))) { streak++; d.setDate(d.getDate() - 1); }
  const month = dkey(new Date()).slice(0, 7);
  const monthVisits = [...days].filter((k) => k.startsWith(month)).length;
  const total = days.size;
  const badges = [[1, 'bd.first'], [10, 'bd.v10'], [30, 'bd.v30'], [100, 'bd.v100'], [365, 'bd.v365']].map(([n, k]) => ({ n, k, got: total >= n }));
  const streakB = [[3, 'bd.s3'], [7, 'bd.s7'], [14, 'bd.s14'], [30, 'bd.s30']].map(([n, k]) => ({ n, k, got: streak >= n }));
  box.append(h('h2', null, t('bd.title')),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, String(streak)), h('div', { class: 'tile-label' }, t('bd.streak'))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, String(monthVisits)), h('div', { class: 'tile-label' }, t('bd.month'))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, String(total)), h('div', { class: 'tile-label' }, t('bd.total')))),
    h('div', { class: 'badges' }, [...badges, ...streakB].map((b) => h('span', { class: `badge-chip ${b.got ? 'got' : ''}` }, `${b.got ? '🏅' : '🔒'} ${t(b.k)}`))));

  const { data: me2 } = await sb.from('members').select('show_on_board').eq('id', me.member.id).single();
  let on = !!(me2 && me2.show_on_board);
  const board = h('div', { class: 'list-simple' });
  const toggle = h('button', { type: 'button', class: 'btn block' }, '');
  async function drawBoard() {
    toggle.textContent = on ? t('bd.optOut') : t('bd.optIn');
    while (board.firstChild) board.removeChild(board.firstChild);
    const { data } = await sb.rpc('leaderboard', { p_club: me.member.club_id });
    if (!(data || []).length) board.append(h('p', { class: 'muted' }, t('bd.boardEmpty')));
    (data || []).forEach((r, i) => board.append(h('div', { class: 'item' }, h('span', null, `${i + 1}. ${r.first_name} #${r.member_no}`), h('strong', null, String(r.visits)))));
  }
  toggle.addEventListener('click', () => guard(async () => { const { error: e } = await sb.rpc('set_board_optin', { p_member: me.member.id, p_on: !on }); if (e) throw e; on = !on; toast(t('trk.saved'), 'ok'); await drawBoard(); }));
  box.append(h('h3', { class: 'section' }, t('bd.board')), board, h('p', { class: 'muted small' }, t('bd.privacy')), toggle);
  await drawBoard();
  return null;
}
