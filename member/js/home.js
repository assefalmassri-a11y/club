import { sb } from '../../js/supa.js';
import { h, badge, fmtDate, fmtDateTime, fmtMoney, today, openForm, toast, guard, confirmBox, button } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';
import { privacyControl } from './privacy.js';
import { pushControl } from '../../js/push.js';
import { langControl } from '../../js/lang.js';
import { themeControl } from '../../js/theme.js';
import { avatar } from '../../js/photo.js';

export async function render(box, ctx) {
  const [{ data: ms }, { data: last }] = await Promise.all([
    sb.from('memberships').select('ends_on, status').eq('member_id', me.member.id).in('status', ['active', 'paused']).gte('ends_on', today()).order('ends_on', { ascending: false }).limit(1),
    sb.from('checkins').select('checked_in_at').eq('member_id', me.member.id).order('checked_in_at', { ascending: false }).limit(1),
  ]);
  const active = ms && ms[0];
  box.append(h('div', { class: 'hero' },
    avatar(me.member.photo_path, me.member.full_name, 'lg'), h('div', { class: 'muted' }, t('m.hello')), h('h2', null, me.member.full_name), h('div', { class: 'muted ltr' }, `${t('m.memberNo')} #${me.member.member_no}`),
    active ? h('div', { class: 'big' }, `${t('m.validUntil')} ${fmtDate(active.ends_on)}`) : h('div', { class: 'big' }, t('m.noActive')),
    last && last[0] ? h('div', { class: 'muted small', style: null }, `${t('m.lastVisit')}: ${fmtDateTime(last[0].checked_in_at)}`) : null),
    h('div', { class: 'row', style: null }, h('button', { class: 'btn primary block', type: 'button', onClick: () => ctx.goto('scan') }, t('m.scanTitle'))));
  const { data: reqs } = await sb.from('freeze_requests').select('id, status, kind, requested_at').eq('member_id', me.member.id).order('requested_at', { ascending: false }).limit(1);
  const req = reqs && reqs[0];
  const pending = req && req.status === 'pending';
  const frz = h('div');
  const redraw = () => {
    while (frz.firstChild) frz.removeChild(frz.firstChild);
    if (pending) {
      frz.append(h('div', { class: 'card' }, h('div', { class: 'row between wrap' }, h('span', null, t(req.kind === 'resume' ? 'frz.waitingResume' : 'frz.waiting')),
        button(t('frz.cancel'), () => guard(async () => { if (!(await confirmBox(t('frz.cancel')))) return; const { error } = await sb.rpc('cancel_freeze_request', { p_id: req.id }); if (error) throw error; ctx.goto('home'); }), 'btn small'))));
    } else if (active && ms[0].status === 'active') {
      frz.append(button(t('frz.request'), () => guard(async () => {
        const ok = await openForm({ title: t('frz.request'), fields: [{ name: 'r', label: t('frz.reason'), type: 'textarea', maxlength: 300 }],
          onSubmit: async (v) => { const { error } = await sb.rpc('request_freeze', { p_member: me.member.id, p_reason: v.r || null }); if (error) throw error; } });
        if (ok === true) { toast(t('frz.sent'), 'ok'); ctx.goto('home'); }
      }), 'btn block'));
    } else if (active && ms[0].status === 'paused') {
      frz.append(h('p', { class: 'muted small' }, t('frz.paused')), button(t('frz.resume'), () => guard(async () => {
        const ok = await openForm({ title: t('frz.resume'), fields: [{ name: 'r', label: t('frz.reason'), type: 'textarea', maxlength: 300 }],
          onSubmit: async (v) => { const { error } = await sb.rpc('request_resume', { p_member: me.member.id, p_reason: v.r || null }); if (error) throw error; } });
        if (ok === true) { toast(t('frz.sent'), 'ok'); ctx.goto('home'); }
      }), 'btn block'));
    }
  };
  redraw(); box.append(frz);
  const { data: hist } = await sb.from('memberships').select('id, starts_on, ends_on, status, price_cents, currency').eq('member_id', me.member.id).order('starts_on', { ascending: false }).limit(10);
  if (hist && hist.length) {
    box.append(h('h3', { class: 'section' }, t('m.history')),
      h('div', { class: 'list' }, hist.map((x) => h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', null, `${fmtDate(x.starts_on)} → ${fmtDate(x.ends_on)}`), badge(t(`m.sub.${x.status}`), x.status === 'active' ? 'ok' : (x.status === 'paused' ? 'warn' : ''))),
        h('div', { class: 'muted small' }, h('bdi', null, fmtMoney(x.price_cents, String(x.currency).trim())))))));
  }
  box.append(h('div', { class: 'list-simple section' }, pushControl(), langControl(), themeControl(), privacyControl()));
  return null;
}
