import { sb } from '../../js/supa.js';
import { h, toast, errText, confirmBox } from '../../js/dom.js';
import { t } from '../../js/i18n.js';

export function privacyControl() {
  const overlayOpen = () => {
    const overlay = h('div', { class: 'overlay' });
    const del = h('button', { type: 'button', class: 'btn block' }, t('priv.delete'));
    del.addEventListener('click', async () => {
      if (!(await confirmBox(t('priv.confirm')))) return;
      const { error } = await sb.rpc('request_data_deletion');
      if (error) { toast(errText(error), 'error'); return; }
      toast(t('priv.sent'), 'ok'); overlay.remove();
    });
    overlay.append(h('div', { class: 'modal small' }, h('h2', null, t('priv.title')),
      h('p', null, t('priv.body1')), h('p', null, t('priv.body2')), h('p', { class: 'muted small' }, t('priv.body3')),
      del, h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onClick: () => overlay.remove() }, t('common.close')))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  };
  return h('div', { class: 'item' }, h('span', { class: 'muted' }, t('priv.title')), h('button', { type: 'button', class: 'btn small', onClick: overlayOpen }, t('priv.open')));
}
