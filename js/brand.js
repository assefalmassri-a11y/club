// Club branding: accent colour (CSS variables) and logo. Options (palette, custom colours, logos) are set by the platform owner.
import { sb } from './supa.js';
import { signedUrl } from './photo.js';
import { h } from './dom.js';

const root = document.documentElement;
const VARS = ['--pri', '--pri-600', '--pri-50', '--pri-fg'];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG contrast of white text on this colour (buttons use a darker shade of it).
export const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

export function applyBrand(club) {
  const c = club && club.brand_color;
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) { for (const v of VARS) root.style.removeProperty(v); root.removeAttribute('data-brand'); return; }
  root.setAttribute('data-brand', '1');
  root.style.setProperty('--pri', c);
  root.style.setProperty('--pri-600', `color-mix(in srgb, ${c} 82%, #000)`);
  root.style.setProperty('--pri-50', `color-mix(in srgb, ${c} 14%, var(--surface))`);
  root.style.setProperty('--pri-fg', luminance(c) > 0.45 ? '#0f172a' : '#fff');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', c);
}

let optionsCache = null;
export async function brandingOptions() {
  if (optionsCache) return optionsCache;
  const { data, error } = await sb.rpc('branding_options');
  if (error) throw error;
  optionsCache = data || { palette: [], allow_custom: false, allow_logo: false };
  return optionsCache;
}
export function resetBrandingOptions() { optionsCache = null; }

// <img> of the club logo (filled once the signed URL arrives); returns null when the club has none.
export function logoImg(club, cls = 'club-logo') {
  if (!club || !club.logo_path) return null;
  const img = h('img', { class: cls, alt: club.name || '' });
  signedUrl(club.logo_path, 'club-logos').then((u) => { if (u) img.src = u; }).catch(() => {});
  return img;
}
