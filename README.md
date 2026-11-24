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

## Member ID, PIN door entry, card printing, activity
- Every member has a per-club number (#1001…), assigned by the database, immutable. Staff list shows/searches it.
- Door by keypad: member number + 6-digit PIN (the member sets the PIN in the app: Home → Door PIN). 5 wrong tries lock that PIN for 15 minutes; a door allows max 20 failed PIN tries/minute. Door device: `POST http://127.0.0.1:8099/pin` with `{"member_no":1001,"pin":"123456"}` (local only; connect your keypad to this). Gateway route `/door-gateway/pin`.
- Membership card: Members → More → "Membership card (print)": name, number and a Code 39 barcode of the number (readable by any barcode scanner). A QR version needs a QR library (not bundled).
- Member app has an "Activity" tab (visits + door attempts).

## Reception, audit, exports
- Reception tab: who is inside now (auto-refresh 20 s); members with no active membership or overdue invoices are flagged and listed first.
- Audit tab (owner only): last 100 sensitive operations, filter by domain.
- Reports → export now also covers visits and memberships (CSV). Do a CSV export of all five files regularly as an offline backup; enable Supabase backups for the real database.

## Calendar-month plans (prorated first month)
Plan type "Calendar month": membership ends on the last day of the month; the first (partial) month is charged by actual remaining days (start day counts), e.g. start 15 Nov on a 30-day month = 16/30 of the price. Renewing starts the day after the previous membership ends (the 1st) at the full price. The plan type is set when creating/editing a plan. Logic: `js/billing.js`.

## Auto billing, reminders, password reset, alerts, weekly classes
- Auto invoices: every day 05:00 UTC the database checks each club; on the 15th (club timezone) every member with an active calendar-plan membership ending this month and no renewal gets an invoice "تجديد اشتراك YYYY-MM" for the next month at the plan's full price, due the last day of the month. Idempotent (never duplicates). Rolling plans are not auto-invoiced.
- Overdue reminders: push to the member on the due date and 3 days after (07:00 UTC daily).
- Forgot password: link on the sign-in screen. REQUIRED once in Supabase Dashboard → Authentication → URL Configuration: set Site URL to https://assefalmassri-a11y.github.io/club/ and add https://assefalmassri-a11y.github.io/club/ and .../club/member/ to Redirect URLs, otherwise the email link will not return to the app.
- Home (owner/manager): alerts for lapsed this week, no visit in 14 days, overdue invoices.
- Events: "Repeat weekly" creates the same class for N weeks (registration, capacity and waiting list already exist).
