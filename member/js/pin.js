import { sb } from '../../js/supa.js';
import { h, openForm, toast, errText } from '../../js/dom.js';
import { t } from '../../js/i18n.js';

export function pinControl() {
  const btn = h('button', { type: 'button', class: 'btn small' }, '…');
  const box = h('div', { class: 'item' }, h('span', { class: 'muted' }, t('pin.title')), btn);
  let isSet = false;
  async function paint() {
    const { data } = await sb.rpc('my_pin_status');
    isSet = data === true;
    btn.textContent = isSet ? t('pin.change') : t('pin.set');
  }
  btn.addEventListener('click', async () => {
    await openForm({
      title: t('pin.title'),
      fields: [{ name: 'pin', label: t('pin.new'), type: 'password', required: true, maxlength: 6, dir: 'ltr', inputmode: 'numeric', autocomplete: 'off' }],
      onSubmit: async (v) => {
        if (!/^[0-9]{6}$/.test(v.pin)) throw new Error(t('pin.help'));
        const { error } = await sb.rpc('set_member_pin', { p_pin: v.pin });
        if (error) throw new Error(/weak/.test(error.message) ? t('pin.weak') : errText(error));
        toast(t('pin.saved'), 'ok');
      },
    });
    await paint();
  });
  paint();
  return box;
}
