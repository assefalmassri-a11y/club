# Club

نظام إدارة صالات رياضية (متعدد الصالات). ثلاث واجهات ثابتة بلا build:

- `/` لوحة الموظفين والمدير (تحقق ثنائي إلزامي).
- `/member/` تطبيق الأعضاء (ربط بكود، مسح كود الباب، فعاليات، فواتير، محادثة).
- `door-device/` برنامج جهاز الباب (انظر README داخله).

## النشر
ارفع المجلد كاملاً (دون `door-device`) إلى GitHub Pages أو أي استضافة HTTPS. عنوان المشروع والمفتاح العام في `js/config.js`.

## ربط عضو بتطبيقه
الموظف: الأعضاء ← «كود ربط التطبيق» (صالح 7 أيام، مرة واحدة). العضو: يسجّل في `/member/` ويدخل الكود.

## الأمان
- RLS على كل الجداول؛ المفتاح العام آمن للعميل.
- CSP في كل صفحة، بلا innerHTML بالبيانات في التطبيقين.
- أنصح بنسخ `supabase-js` محلياً وإزالة `cdn.jsdelivr.net` من CSP.
- الأعضاء بلا MFA إلزامي حالياً (قرار مفتوح: حساب مسروق = دخول للصالة).

## الإعدادات
`js/config.js`: الخانات العشرية للعملات (راجع الليرة السورية). اللغة: `js/i18n.js`.

## الحالة
فُحصت الصياغة بـ `node --check`، ولم تُجرَّب الواجهات في متصفح بعد. ماسح الكود يحتاج متصفحاً يدعم `BarcodeDetector` (Chrome على أندرويد)؛ على iOS يُدخل العضو الكود يدوياً حتى نضيف قارئاً بديلاً.

## Notifications (Web Push), English, branch-restricted plans
- Push: Settings (staff) / Home (member) → "Device notifications → Enable". Needs HTTPS. On iPhone (16.4+) the app must be added to the Home Screen first. Notifications are generic (no message content). Events: new chat message, new invoice, event cancelled, membership ending in 3 days (daily 08:00 UTC cron).
- Server side: Edge Function `push-notify` + table `push_subscriptions`; the VAPID private key stays in the database (`private.app_secrets`), only the public key is in `js/config.js`.
- Language: Arabic/English switch in Settings, member Home and the sign-in screen (stored in localStorage). Dictionary: `js/i18n.js` (ar) and `js/lang-en.js` (en).
- Plans: when creating a plan choose "Restrict to branch"; memberships from that plan only work at that branch (check-in, door, events).
