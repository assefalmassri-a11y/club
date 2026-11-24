import { sb } from '../../js/supa.js';
import { h, badge, fmtDateTime } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

const METHOD = { qr: 'act.qr', card: 'act.card', pin: 'act.pin', door: 'act.door', staff: 'act.staff', app: 'act.app' };

export async function render(box) {
  const [{ data: ins, error: e1 }, { data: tries, error: e2 }] = await Promise.all([
    sb.from('checkins').select('id, checked_in_at, method').eq('member_id', me.member.id).order('checked_in_at', { ascending: false }).limit(30),
    sb.from('door_attempts').select('id, created_at, granted, reason, direction, method').eq('member_id', me.member.id).order('created_at', { ascending: false }).limit(30),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  box.append(h('h2', null, t('act.title')), h('h3', { class: 'section' }, t('act.visits')));
  box.append((ins || []).length
    ? h('div', { class: 'list' }, ins.map((x) => h('div', { class: 'card' }, h('div', { class: 'row between' },
      h('span', null, fmtDateTime(x.checked_in_at)), h('span', { class: 'muted small' }, t(METHOD[x.method] || 'act.other'))))))
    : h('p', { class: 'muted' }, t('act.none')));
  box.append(h('h3', { class: 'section' }, t('act.doorTitle')));
  box.append((tries || []).length
    ? h('div', { class: 'list' }, tries.map((x) => h('div', { class: 'card' }, h('div', { class: 'row between' },
      h('span', null, fmtDateTime(x.created_at)),
      badge(x.granted ? t('door.granted') : t('door.denied'), x.granted ? 'ok' : 'warn')),
      h('div', { class: 'muted small' }, `${t(x.direction === 'exit' ? 'door.exit' : 'door.entry')} · ${t(METHOD[x.method] || 'act.other')}${x.granted ? '' : ` · ${t(`m.reason.${x.reason}`) === `m.reason.${x.reason}` ? t('m.reason.other') : t(`m.reason.${x.reason}`)}`}`))))
    : h('p', { class: 'muted' }, t('act.none')));
  return null;
}
