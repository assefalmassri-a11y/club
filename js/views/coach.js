// Trainer workspace: own classes (attendance) and own assigned clients (plan, measurements, chat).
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, button, guard, fmtDateTime, fmtDate, badge } from '../dom.js';
import { t } from '../i18n.js';
import { avatar } from '../photo.js';
import { openAttendance } from './events.js';
import { openTracking, editPlan } from './tracking.js';
import { openRatings } from './insights.js';
import { openForm, toast } from '../dom.js';

export async function render(box, ctx) {
  const { data: me, error: e0 } = await sb.from('staff').select('id').eq('club_id', state.club.id).eq('user_id', state.session.user.id).maybeSingle();
  if (e0) throw e0;
  const myId = me && me.id;
  const [{ data: evs, error: e1 }, { data: asg, error: e2 }] = await Promise.all([
    sb.from('events').select('id, title, starts_at, ends_at, capacity, status, branch_id').eq('trainer_staff_id', myId).gte('ends_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).order('starts_at').limit(30),
    sb.from('trainer_assignments').select('id, member_id, assigned_at').eq('trainer_staff_id', myId).is('ended_at', null).order('assigned_at', { ascending: false }).limit(200),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const ids = (asg || []).map((a) => a.member_id);
  const members = new Map();
  if (ids.length) { const { data: ms } = await sb.from('members').select('id, full_name, member_no, phone, status, branch_id, photo_path').in('id', ids); for (const m of ms || []) members.set(m.id, m); }

  box.append(h('h2', null, t('coach.title')), h('h3', { class: 'section' }, t('coach.classes')));
  box.append((evs || []).length ? h('div', { class: 'list' }, evs.map((ev) => h('div', { class: 'card' },
    h('div', { class: 'row between wrap' }, h('strong', null, ev.title), ev.status === 'cancelled' ? badge(t('ev.cancelled'), 'bad') : badge(t('ev.scheduled'), 'ok')),
    h('div', { class: 'row between wrap' }, h('span', { class: 'muted small' }, fmtDateTime(ev.starts_at)),
      ev.status !== 'cancelled' ? button(t('ev.attendance'), () => guard(() => openAttendance(ev)), 'btn small') : null)))) : h('p', { class: 'muted' }, t('coach.noClasses')));

  box.append(h('h3', { class: 'section' }, t('coach.clients')));
  const rows = (asg || []).map((a) => ({ a, m: members.get(a.member_id) })).filter((x) => x.m);
  box.append(rows.length ? h('div', { class: 'list' }, rows.map(({ a, m }) => h('div', { class: 'card' },
    h('div', { class: 'row gap' }, avatar(m.photo_path, m.full_name, 'md'), h('div', null, h('strong', null, m.full_name), h('div', { class: 'muted small ltr' }, `#${m.member_no}${m.phone ? ` · ${m.phone}` : ''}`), h('div', { class: 'muted small' }, `${t('cl.since')} ${fmtDate(a.assigned_at)}`))),
    h('div', { class: 'row gap wrap' },
      button(t('trk.title'), () => guard(() => openTracking(m)), 'btn small'),
      button(t('plan.title'), () => guard(() => editPlan(m)), 'btn small primary'),
      button(t('mem.chat'), () => guard(async () => {
        const { data: id, error } = await sb.rpc('open_support_conversation', { p_member: m.id });
        if (error) throw error;
        state.openConversation = id; ctx.goto('chat');
      }), 'btn small'))))) : h('p', { class: 'muted' }, t('cl.none')));

  // Personal-training availability and bookings.
  const { data: av } = await sb.from('pt_availability').select('weekday, start_time, end_time, slot_minutes').eq('trainer_staff_id', myId).order('weekday');
  const { data: bk } = await sb.from('pt_bookings').select('id, member_id, starts_at, status').eq('trainer_staff_id', myId).eq('status', 'booked').gte('starts_at', new Date().toISOString()).order('starts_at').limit(30);
  const bnames = new Map();
  const bids = [...new Set((bk || []).map((b) => b.member_id))];
  if (bids.length) { const { data: ms } = await sb.from('members').select('id, full_name').in('id', bids); for (const m of ms || []) bnames.set(m.id, m.full_name); }
  const dayName = (i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'long' });
  const hm = (s) => String(s).slice(0, 5);
  box.append(h('div', { class: 'row between wrap section' }, h('h3', null, t('pt.title')), button(t('pt.setAvail'), async () => {
    const cur = (av || []).map((a) => `${a.weekday} ${hm(a.start_time)}-${hm(a.end_time)} ${a.slot_minutes}`).join('\n');
    const ok = await openForm({ title: t('pt.setAvail'), fields: [{ name: 'rows', label: t('pt.availHelp'), type: 'textarea', maxlength: 600, value: cur, dir: 'ltr' }],
      onSubmit: async (v) => {
        const rows = [];
        for (const line of v.rows.split('\n').map((l) => l.trim()).filter(Boolean)) {
          const m = line.match(/^([0-6])\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})(?:\s+(30|45|60|90))?$/);
          if (!m) throw new Error(`${t('err.invalid')}: ${line}`);
          rows.push({ weekday: Number(m[1]), start: m[2], end: m[3], slot: Number(m[4] || 60) });
        }
        const { error } = await sb.rpc('set_pt_availability', { p_rows: rows }); if (error) throw error;
      } });
    if (ok === true) { toast(t('pay.saved'), 'ok'); ctx.goto('coach'); }
  }, 'btn small')));
  box.append((av || []).length ? h('div', { class: 'list-simple' }, av.map((a) => h('div', { class: 'item' }, h('span', null, dayName(a.weekday)), h('span', { class: 'muted ltr' }, `${hm(a.start_time)}–${hm(a.end_time)} · ${a.slot_minutes}m`)))) : h('p', { class: 'muted' }, t('pt.noAvail')));
  box.append(h('h3', { class: 'section' }, t('pt.bookings')));
  box.append((bk || []).length ? h('div', { class: 'list-simple' }, bk.map((b) => h('div', { class: 'item' }, h('span', null, bnames.get(b.member_id) || t('common.none')),
    h('span', { class: 'row gap' }, h('span', { class: 'muted small' }, fmtDateTime(b.starts_at)),
      button(t('common.cancel'), () => guard(async () => { const { error } = await sb.rpc('cancel_pt', { p_id: b.id }); if (error) throw error; ctx.goto('coach'); }), 'btn small'))))) : h('p', { class: 'muted' }, t('pt.noBookings')));
  box.append(h('div', { class: 'row end section' }, button(t('rt.title'), () => guard(openRatings), 'btn small')));
  return null;
}
