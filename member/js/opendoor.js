// Open a door from the app: the server checks the membership and that the phone is within the door's radius.
import { sb } from '../../js/supa.js';
import { h, button, toast, guard, reasonText } from '../../js/dom.js';
import { t } from '../../js/i18n.js';
import { getPosition } from '../../js/geo.js';

export async function openDoorControl() {
  const { data, error } = await sb.rpc('my_doors');
  const doors = (!error && Array.isArray(data) ? data : []).filter((d) => d.has_location);
  if (!doors.length) return null;

  const pick = doors.length > 1
    ? h('select', { 'aria-label': t('od.door') }, doors.map((d) => h('option', { value: d.id }, `${d.name} (${t(`door.${d.direction}`)})`)))
    : null;
  const btn = button(t('od.open'), () => guard(async () => {
    const door = pick ? pick.value : doors[0].id;
    btn.disabled = true;
    try {
      toast(t('od.locating'));
      const pos = await getPosition();
      const { data: res, error: e } = await sb.rpc('open_door_nearby', { p_door_id: door, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.accuracy });
      if (e) throw e;
      const r = Array.isArray(res) ? res[0] : res;
      toast(reasonText(r && r.reason), r && r.granted ? 'ok' : 'error');
    } finally { btn.disabled = false; }
  }), 'btn primary block');

  return h('div', { class: 'card' },
    h('h3', null, t('od.title')),
    h('p', { class: 'muted small' }, t('od.hint')),
    pick, btn);
}
