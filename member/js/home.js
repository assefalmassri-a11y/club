import { sb } from '../../js/supa.js';
import { h, badge, fmtDate, fmtDateTime, today } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

export async function render(box, ctx) {
  const [{ data: ms }, { data: last }] = await Promise.all([
    sb.from('memberships').select('ends_on, status').eq('member_id', me.member.id).in('status', ['active', 'paused']).gte('ends_on', today()).order('ends_on', { ascending: false }).limit(1),
    sb.from('checkins').select('checked_in_at').eq('member_id', me.member.id).order('checked_in_at', { ascending: false }).limit(1),
  ]);
  const active = ms && ms[0];
  box.append(h('div', { class: 'hero' },
    h('div', { class: 'muted' }, t('m.hello')), h('h2', null, me.member.full_name),
    active ? h('div', { class: 'big' }, `${t('m.validUntil')} ${fmtDate(active.ends_on)}`) : h('div', { class: 'big' }, t('m.noActive')),
    last && last[0] ? h('div', { class: 'muted small', style: null }, `${t('m.lastVisit')}: ${fmtDateTime(last[0].checked_in_at)}`) : null),
    h('div', { class: 'row', style: null }, h('button', { class: 'btn primary block', type: 'button', onClick: () => ctx.goto('scan') }, t('m.scanTitle'))));
  return null;
}
