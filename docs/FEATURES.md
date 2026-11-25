> Historical feature log. Changes since: the member door PIN, the Code 39 barcode and all QR entry were removed (entry is by RFID/Mifare/NFC cards); phase 18 proximity (GPS) opening was removed in phase 21 (cards only); phase 19 added club subscriptions; phase 25 added club branding (colour + logo) with platform-controlled options; phase 24 added manager review of members registered by staff; phase 23 gave the platform owner full control (club details, permanent club delete, plans, platform admins, platform log). Current structure: see README.md and docs/ARCHITECTURE.md.

# Club

نظام إدارة صالات رياضية (متعدد الصالات). ثلاث واجهات ثابتة بلا build:

- `/` لوحة الموظفين والمدير (تحقق ثنائي إلزامي).
- `/member/` تطبيق الأعضاء (ربط بكود، فعاليات، فواتير، محادثة).
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
- Membership card: Members → More → "Membership card (print)": name and member number only (no barcode). Door/entry cards are RFID/Mifare/NFC: issue them from Members → Card with the card UID.
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

## Receipts, discounts, freeze, notes, privacy, daily report, error log
- Marking an invoice paid asks for the payment method (cash/transfer/card/other); paid invoices have a printable receipt.
- Standing member discount (%) in Edit member (owner/manager only, audited). Applied to subscriptions and to auto renewal invoices.
- Freeze: pausing a membership and resuming it extends the end date by the days it was paused.
- Staff-only notes per member (injury, allergy…); the member cannot read them.
- Privacy: member app → "Privacy and my data" with a deletion request. Owner/manager sees requests on Home and runs "Anonymize member" (name/phone/email erased, membership cancelled; invoices and ledger are kept without a name).
- Reports → "Daily report": collections by payment method, income/expense, visits, new members; printable.
- Audit tab (owner): app errors reported by clients (last 30 days).

## Phase 13
- Member photo: private bucket `member-photos` (`<club>/<member>.jpg`, resized client-side to 512px JPEG). Staff upload from the member "More" menu; shown in the members list, reception and the member app.
- Measurements and workouts: tables `member_measurements`, `workout_logs`. Members log their own (app tab "Body"); branch staff and the assigned trainer read.
- Trainer payroll: `trainer_rates`, RPCs `set_trainer_rate` / `trainer_payroll` (owner + MFA). Staff tab > "Trainer payroll"; events now take a trainer.
- Exchange rate: `fx_rates`, RPC `set_fx_rate` (owner). Settings > Exchange rate; Overview shows an approximate combined balance when rates exist.

## Phase 14
- Coach workspace (trainer role): own classes with attendance, own assigned clients (measurements, workout plan, chat).
- Workout plans: `workout_plans` (one active per member, history kept) via RPC `save_workout_plan` (assigned trainer or owner/manager). Members see the plan in the Body tab.
- Profit & loss: Reports > "Profit & loss" (per month, per currency, CSV + print).
- Self-service freeze: member requests in the app; staff approve/reject on the Overview (RPC `decide_freeze` pauses the membership). Resuming stays with staff (existing manage-subscription flow).
- Fixes: `trainer_payroll` return types; audit domains extended (fx, payroll, freeze, plan).

## Phase 15
- Trainer data scope tightened in the database: trainers read only assigned/registered members (`private.can_read_member`), their own events' registrations; no memberships/checkins/cards.
- Resume requests (`request_resume`; `decide_freeze` handles both kinds).
- Payroll payment: `pay_trainer_month` records an expense in the ledger (once per trainer/month, `payroll_payments`); "Pay" button in Trainer payroll.

## Phase 16
Analytics (staff), coupons, installments, shop/POS, equipment register, personal-training booking (trainer availability + member booking), class ratings, achievements + opt-in leaderboard, monthly reports (cron `monthly-reports`, daily 06:30 UTC, acts on day 1 per club timezone). Waitlist for classes already existed (`register_for_event` / `promote_waitlist`).

## Phase 17
- Design overhaul: accent colors per section, grouped sidebar, desktop layout (wide grids), mobile bottom bar + bottom-sheet modals, light/dark/auto theme (`js/theme.js`).
- Per-trainer report for the owner (staff → "Report"): classes, attendance, fill rate, rating, PT sessions, clients, salary; CSV export.
- Equipment photo (private bucket `equipment-photos`, path `<club>/<id>.jpg`).

## Phase 27
- Club look and feel (Settings → owner): background tone (7 presets), font (system stacks only), text size, tab style. Live preview, stored on Save (`set_club_theme`, column `clubs.theme`, guarded like the other brand columns).
- The platform owner can allow or block it (`allow_theme` in `platform_set_branding`). CSS layer at the end of `css/app.css` driven by `data-bg/data-font/data-fsize/data-tabs` set in `js/brand.js`.
