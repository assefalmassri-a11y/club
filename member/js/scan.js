import { sb } from '../../js/supa.js';
import { h, clear, errText } from '../../js/dom.js';
import { t } from '../../js/i18n.js';

// QR payload shown on the door screen: "club1:<door_uuid>:<12 hex code>"
const RE = /^club1:([0-9a-f-]{36}):([0-9a-f]{12})$/i;

export async function render(box) {
  let stream = null; let timer = null; let busy = false;
  const video = h('video', { playsinline: true, muted: true, 'aria-label': t('m.scanTitle') });
  const frame = h('div', { class: 'scan-box off' }, video);
  const result = h('div', { 'aria-live': 'polite' });
  const toggle = h('button', { type: 'button', class: 'btn primary block' }, t('m.scanStart'));
  const manual = h('input', { type: 'text', dir: 'ltr', maxlength: 80, placeholder: 'club1:…', class: 'code-input', 'aria-label': t('m.scanManual') });
  const send = h('button', { type: 'button', class: 'btn block' }, t('m.scanSend'));
  box.append(h('h2', null, t('m.scanTitle')), h('p', { class: 'muted' }, t('m.scanHelp')), frame, toggle, result,
    h('label', { class: 'field' }, h('span', null, t('m.scanManual')), manual), send);

  function stop() {
    if (timer) clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((x) => x.stop()); stream = null;
    video.srcObject = null; frame.classList.add('off'); toggle.textContent = t('m.scanStart');
  }

  async function submit(raw) {
    const m = RE.exec(String(raw).trim());
    if (!m) { show(false, t('m.scanBadFormat')); return; }
    if (busy) return; busy = true;
    try {
      const { data, error } = await sb.rpc('scan_door', { p_door_id: m[1], p_code: m[2].toLowerCase() });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      const key = `m.reason.${r.reason}`;
      const msg = t(key) === key ? t('m.reason.other') : t(key);
      show(!!r.granted, msg);
      if (navigator.vibrate) navigator.vibrate(r.granted ? 80 : [60, 40, 60]);
      stop();
    } catch (e) { show(false, errText(e)); } finally { busy = false; }
  }
  function show(ok, msg) { clear(result); result.append(h('div', { class: `result ${ok ? 'ok' : 'bad'}`, role: 'status' }, msg)); }

  toggle.addEventListener('click', async () => {
    if (stream) { stop(); return; }
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { show(false, t('m.scanNoCam')); return; }
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream; await video.play();
      frame.classList.remove('off'); toggle.textContent = t('m.scanStop');
      timer = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        try { const codes = await det.detect(video); if (codes.length) await submit(codes[0].rawValue); } catch (_) { /* keep scanning */ }
      }, 350);
    } catch (_) { stop(); show(false, t('m.scanNoCam')); }
  });
  send.addEventListener('click', () => submit(manual.value));
  return stop;
}
