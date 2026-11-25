// Member profile: personal info, subscriptions, door entries/exits and invoices in one screen.
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, badge, button, fmtDate, fmtDateTime, fmtMoney, reasonText, guard } from '../dom.js';
import { t } from '../i18n.js';
import { avatar } from '../photo.js';

const STATUS_KIND = { active: 'ok', frozen: 'warn', expired: 'bad', cancelled: 'bad', paused: 'warn' };
const branchName = (id) => (state.branches.find((b) => b.id === id) || {}).name || t('common.none');
const statusText = (s) => (t(`mem.status.${s}`) === `mem.status.${s}` ? s : t(`mem.status.${s}`));

function table(heads, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, t('common.empty'));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
    h('thead', null, h('tr', null, heads.map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c, i) => h('td', { 'data-label': heads[i] }, c)))))));
}
const section = (title, body) => h('div', null, h('h3', { class: 'section' }, title), body);
const field = (label, value) => h('div', null, h('div', { class: 'muted small' }, label), h('div', null, value || h('span', { class: 'muted' }, t('common.none'))));

// Large photo; tap to view it full size.
function bigAvatar(member) {
  const box = avatar(member.photo_path, member.full_name, 'xl');
  box.addEventListener('click', () => {
    const img = box.querySelector('img');
    if (!img) return;
    const full = h('div', { class: 'overlay' }, h('img', { class: 'photo-zoom', alt: member.full_name, src: img.src }));
    full.addEventListener('click', () => full.remove());
    document.body.append(full);
  });
  return box;
}

export async function openMemberProfile(member) {
  const overlay = h('div', { class: 'overlay' });
  const body = h('div', { class: 'stack' });
  overlay.append(h('div', { class: 'modal wide' },
    h('div', { class: 'row gap' }, bigAvatar(member),
      h('div', null, h('h2', null, member.full_name), h('div', { class: 'muted small ltr' }, `#${member.member_no}`))),
    body, h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);

  await guard(async () => {
    const [{ data: m, error }, { data: subs }, { data: att }, { data: invs }, { data: doors }] = await Promise.all([
      sb.from('members').select('full_name, phone, email, birth_date, status, joined_at, branch_id, discount_pct').eq('id', member.id).single(),
      sb.from('memberships').select('id, plan_id, starts_on, ends_on, status, price_cents, currency, membership_plans(name)').eq('member_id', member.id).order('starts_on', { ascending: false }).limit(20),
      sb.from('door_attempts').select('id, door_id, direction, granted, reason, method, created_at').eq('member_id', member.id).order('created_at', { ascending: false }).limit(40),
      sb.from('invoices').select('id, number, label, amount_minor, currency, due_date, status').eq('member_id', member.id).order('number', { ascending: false }).limit(20),
      sb.from('doors').select('id, name'),
    ]);
    if (error) throw error;
    const door = new Map((doors || []).map((d) => [d.id, d.name]));
    clear(body);
    body.append(
      section(t('prof.info'), h('div', { class: 'grid-2' },
        field(t('mem.phone'), m.phone && h('span', { class: 'ltr' }, m.phone)),
        field(t('mem.email'), m.email && h('span', { class: 'ltr' }, m.email)),
        field(t('common.branch'), branchName(m.branch_id)),
        field(t('common.status'), badge(statusText(m.status), STATUS_KIND[m.status])),
        field(t('prof.joined'), m.joined_at && fmtDate(m.joined_at)),
        field(t('prof.birth'), m.birth_date && fmtDate(m.birth_date)),
        field(t('mem.discount'), m.discount_pct ? `${m.discount_pct}%` : null))),
      section(t('prof.subs'), table([t('mem.planName'), t('prof.from'), t('prof.to'), t('common.status'), t('inv.amount')],
        (subs || []).map((s) => [(s.membership_plans && s.membership_plans.name) || t('common.none'), fmtDate(s.starts_on), fmtDate(s.ends_on),
          badge(statusText(s.status), STATUS_KIND[s.status]), h('bdi', null, fmtMoney(s.price_cents, String(s.currency).trim()))]))),
      section(t('prof.access'), table([t('common.date'), t('door.name'), t('door.direction'), t('door.method'), t('common.status')],
        (att || []).map((a) => [fmtDateTime(a.created_at), door.get(a.door_id) || '', t(a.direction === 'exit' ? 'door.exit' : 'door.entry'), a.method || '',
          badge(a.granted ? t('door.granted') : `${t('door.denied')}: ${reasonText(a.reason)}`, a.granted ? 'ok' : 'bad')]))),
      section(t('inv.title'), table([t('inv.number'), t('inv.label'), t('inv.amount'), t('inv.dueDate'), t('common.status')],
        (invs || []).map((i) => [String(i.number), i.label || '', h('bdi', null, fmtMoney(i.amount_minor, String(i.currency).trim())), fmtDate(i.due_date),
          badge(t(`inv.status.${i.status}`), i.status === 'paid' ? 'ok' : 'warn')]))));
  });
}
