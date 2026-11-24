// Public client configuration. The publishable key is safe to ship: all access is enforced by RLS.
export const SUPABASE_URL = 'https://ufpqzisiguofxtubuujs.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_SIdujvZkhXtWZ1-GcEwY6Q_IAA-TLDu';

// Number of minor-unit digits per currency (amounts are stored as integers in minor units).
export const CURRENCY_DECIMALS = { SYP: 2, USD: 2 };
export const DEFAULT_DECIMALS = 2;

export const LOCALE = 'ar-u-nu-latn';
export const CHAT_RETENTION_DAYS = 21;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Public VAPID key for Web Push (the private key never leaves the server).
export const VAPID_PUBLIC = 'BCRVK38P54X_zox-iO4J7fRX0dAEX6Qh2a23lbwnnyLEw9lz8vY3traQpNO_T4LJG3GCSCgDVAhX2vBTFJ98C58';
