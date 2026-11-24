// Member photos: private bucket, client-side resize to a small JPEG, signed URLs for display.
import { sb } from './supa.js';
import { h } from './dom.js';

const MAX = 512;

async function toJpeg(file) {
  if (!/^image\//.test(file.type)) throw new Error('not an image');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) throw new Error('encode failed');
  return blob;
}

export async function uploadPhoto(clubId, memberId, file) {
  const blob = await toJpeg(file);
  const path = `${clubId}/${memberId}.jpg`;
  const { error } = await sb.storage.from('member-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { error: e2 } = await sb.from('members').update({ photo_path: path }).eq('id', memberId);
  if (e2) throw e2;
  return path;
}

// Equipment photo: resized JPEG at <club>/<equipment_id>.jpg, then registered through the RPC.
export async function uploadEquipmentPhoto(clubId, equipmentId, file) {
  const blob = await toJpeg(file);
  const path = `${clubId}/${equipmentId}.jpg`;
  const { error } = await sb.storage.from('equipment-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { error: e2 } = await sb.rpc('set_equipment_photo', { p_id: equipmentId, p_path: path });
  if (e2) throw e2;
  cache.delete('equipment-photos|' + path);
  return path;
}

const cache = new Map();
export async function photoUrl(path, bucket = 'member-photos') {
  const key = bucket + '|' + path;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + 540000 });
  return data.signedUrl;
}

// Round avatar: photo when available, otherwise the first letter.
export function avatar(path, name, size = 'md') {
  const box = h('span', { class: `avatar ${size}` }, (name || '?').trim().charAt(0).toUpperCase());
  if (path) photoUrl(path).then((u) => { if (u) { const im = h('img', { alt: '', loading: 'lazy' }); im.src = u; box.textContent = ''; box.append(im); } }).catch(() => {});
  return box;
}

// Opens the camera/gallery picker and uploads.
export function pickPhoto() {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept: 'image/*' });
    i.addEventListener('change', () => resolve(i.files && i.files[0] ? i.files[0] : null));
    i.addEventListener('cancel', () => resolve(null));
    i.click();
  });
}

// Square thumbnail for equipment (placeholder icon text when no photo).
export function thumb(path, bucket = 'equipment-photos') {
  const box = h('span', { class: 'thumb' }, '▣');
  if (path) photoUrl(path, bucket).then((u) => { if (u) { const im = h('img', { alt: '', loading: 'lazy' }); im.src = u; box.textContent = ''; box.append(im); } }).catch(() => {});
  return box;
}
