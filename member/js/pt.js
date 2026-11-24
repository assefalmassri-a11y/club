// Personal-training booking: pick a trainer and a free slot (server validates availability, membership and limits).
import { sb } from '../../js/supa.js';
import { h, clear, button, toast, guard, fmtDateTime, confirmBox } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

export async function render(box) {
  const wrap = h('div');
  box.append(h('h2', null, t('pt.memberTitle')), wrap);
  async function load() {
    clear(wrap);
    const [{ data: trainers, error: e1 }, { data: mine, error: e2 }] = await Promise.all([
      sb.rpc('pt_trainers', { p_club: me.member.club_id }),
      sb.from('pt_bookings').select('id, starts_at, trainer_staff_id').eq('member_id', me.member.id).eq('status', 'booked').gte('starts_at', new Date().toISOString()).order('starts_at').limit(10),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const label = new Map((trainers || []).map((x) => [x.staff_id, x.label]));
    wrap.append(h('h3', { class: 'section' }, t('pt.mine')));
    wrap.append((mine || []).length ? h('div', { class: 'list' }, mine.map((b) => h('div', { class: 'card' }, h('div', { class: 'row between wrap' },
      h('span', null, fmtDateTime(b.starts_at), ' · ', label.get(b.trainer_staff_id) || ''),
      button(t('common.cancel'), () => guard(async () => { if (!(await confirmBox(t('common.cancel')))) return; const { error } = await sb.rpc('cancel_pt', { p_id: b.id }); if (error) throw error; toast(t('pt.cancelled'), 'ok'); await load(); }), 'btn small'))))) : h('p', { class: 'muted' }, t('pt.none')));
    wrap.append(h('h3', { class: 'section' }, t('pt.book')));
    if (!(trainers || []).length) { wrap.append(h('p', { class: 'muted' }, t('pt.noTrainers'))); return; }
    const from = new Date().toISOString().slice(0, 10); const to = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
    for (const tr of trainers) {
      const { data: slots } = await sb.rpc('pt_open_slots', { p_trainer: tr.staff_id, p_from: from, p_to: to });
      const byDay = new Map();
      for (const s of slots || []) { const k = new Date(s.starts_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
      wrap.append(h('div', { class: 'card-box' }, h('h3', null, tr.label),
        byDay.size ? [...byDay.entries()].map(([day, arr]) => h('div', null, h('div', { class: 'muted small' }, day), h('div', { class: 'row gap wrap' }, arr.map((s) => button(new Date(s.starts_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), () => guard(async () => {
          if (!(await confirmBox(`${t('pt.book')}: ${fmtDateTime(s.starts_at)}`))) return;
          const { error } = await sb.rpc('book_pt', { p_trainer: tr.staff_id, p_starts: s.starts_at }); if (error) throw error;
          toast(t('pt.booked'), 'ok'); await load();
        }), 'btn small'))))) : h('p', { class: 'muted' }, t('pt.noSlots'))));
    }
  }
  await load();
  return null;
}
