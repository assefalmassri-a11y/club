// Public client configuration. The publishable key is safe to ship: all access is enforced by RLS.
export const SUPABASE_URL = 'https://ufpqzisiguofxtubuujs.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_SIdujvZkhXtWZ1-GcEwY6Q_IAA-TLDu';

// Number of minor-unit digits per currency (amounts are stored as integers in minor units).
export const CURRENCY_DECIMALS = { SYP: 2, USD: 2 };
export const DEFAULT_DECIMALS = 2;

export const LOCALE = 'ar-u-nu-latn';
export const CHAT_RETENTION_DAYS = 21;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
