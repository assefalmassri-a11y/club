import { sb } from '../../js/supa.js';
import { h, clear, badge, button, toast, guard, fmtDateTime } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

export async function render(box) {
  const list = h('div', { class: 'list' });
  box.append(h('h2', null, t('ev.title')), list);
  async function load() {
    clear(list);
    const [{ data: evs, error }, { data: regs }] = await Promise.all([
      sb.from('events').select('id, title, description, starts_at, ends_at, capacity, status').eq('status', 'scheduled').gte('starts_at', new Date().toISOString()).order('starts_at').limit(50),
      sb.from('event_registrations').select('event_id, status').eq('member_id', me.member.id),
    ]);
    if (error) throw error;
    const mine = new Map((regs || []).filter((r) => r.status !== 'cancelled').map((r) => [r.event_id, r.status]));
    if (!evs || !evs.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    for (const ev of evs) {
      const st = mine.get(ev.id);
      list.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('strong', null, ev.title), st ? badge(t(`m.ev.${st}`), st === 'registered' ? 'ok' : 'warn') : null),
        ev.description ? h('div', { class: 'muted small' }, ev.description) : null,
        h('div', { class: 'muted small' }, fmtDateTime(ev.starts_at)),
        h('div', { class: 'row end' }, st
          ? button(t('m.ev.cancel'), () => guard(async () => { const { error: e } = await sb.rpc('cancel_registration', { p_event_id: ev.id, p_member_id: me.member.id }); if (e) throw e; toast(t('m.ev.cancelled'), 'ok'); await load(); }), 'btn small')
          : button(t('m.ev.register'), () => guard(async () => { const { error: e } = await sb.rpc('register_for_event', { p_event_id: ev.id, p_member_id: me.member.id }); if (e) throw e; toast(t('m.ev.done'), 'ok'); await load(); }), 'btn small primary'))));
    }
  }
  await load();
  return null;
}
