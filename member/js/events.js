import { sb } from '../../js/supa.js';
import { h, clear, badge, button, toast, guard, fmtDateTime, openForm } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

export async function render(box, ctx) {
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
  // Rate classes attended in the last 30 days.
  const rated = h('div'); box.append(rated);
  const [{ data: att }, { data: myr }] = await Promise.all([
    sb.from('event_registrations').select('event_id').eq('member_id', me.member.id).not('attended_at', 'is', null).limit(50),
    sb.from('event_ratings').select('event_id, stars').eq('member_id', me.member.id).limit(200),
  ]);
  const ids = (att || []).map((a) => a.event_id);
  if (ids.length) {
    const { data: past } = await sb.from('events').select('id, title, starts_at').in('id', ids).gte('starts_at', new Date(Date.now() - 30 * 86400000).toISOString()).lt('ends_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(10);
    const got = new Map((myr || []).map((r) => [r.event_id, r.stars]));
    if ((past || []).length) rated.append(h('h3', { class: 'section' }, t('rt.rateTitle')), h('div', { class: 'list' }, past.map((ev) => h('div', { class: 'card' }, h('div', { class: 'row between wrap' },
      h('span', null, ev.title, h('div', { class: 'muted small' }, fmtDateTime(ev.starts_at))),
      button(got.has(ev.id) ? '★'.repeat(got.get(ev.id)) : t('rt.rate'), () => guard(async () => {
        const ok = await openForm({ title: ev.title, fields: [
          { name: 's', label: t('rt.stars'), type: 'select', required: true, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: '★'.repeat(n) })), value: String(got.get(ev.id) || 5) },
          { name: 'c', label: t('rt.comment'), type: 'textarea', maxlength: 300 }],
          onSubmit: async (v) => { const { error } = await sb.rpc('rate_event', { p_event: ev.id, p_stars: Number(v.s), p_comment: v.c || null }); if (error) throw error; } });
        if (ok === true) { toast(t('trk.saved'), 'ok'); ctx.goto('events'); }
      }), 'btn small'))))));
  }
  return null;
}
