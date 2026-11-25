// One-shot GPS reading, used to open a door from the app and to place a door on the map.
import { t } from './i18n.js';

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t('geo.unsupported'))); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(t(e && e.code === 1 ? 'geo.denied' : 'geo.failed'))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}
