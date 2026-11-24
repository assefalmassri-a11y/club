import { sb } from '../../js/supa.js';
import { h, badge, fmtDate, fmtMoney, today } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { me } from './ctx.js';

export async function render(box) {
  const { data, error } = await sb.from('invoices').select('id, number, label, amount_minor, currency, due_date, status').eq('member_id', me.member.id).order('number', { ascending: false }).limit(50);
  if (error) throw error;
  box.append(h('h2', null, t('m.tab.invoices')));
  if (!data || !data.length) { box.append(h('p', { class: 'muted' }, t('m.inv.none'))); return null; }
  box.append(h('div', { class: 'list' }, data.map((i) => {
    const st = i.status === 'issued' && i.due_date < today() ? 'overdue' : i.status;
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', null, i.label), badge(t(`inv.status.${st}`), { issued: 'warn', paid: 'ok', void: '', overdue: 'bad' }[st])),
      h('div', { class: 'row' }, h('span', { dir: 'ltr' }, fmtMoney(i.amount_minor, i.currency.trim())), h('span', { class: 'muted small' }, `${t('inv.dueDate')}: ${fmtDate(i.due_date)}`)));
  })));
  return null;
}
