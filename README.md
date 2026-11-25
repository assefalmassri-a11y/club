# Club

نظام إدارة صالات رياضية (SaaS متعدد الصالات). واجهات ثابتة (ES modules) بلا build، وقاعدة بيانات Supabase (Postgres + Auth + Storage + Edge Functions).

| الواجهة | المسار | الوصف |
|---|---|---|
| لوحة الموظفين | `/` | مالك، مدير فرع، مدرب، موظف. التحقق بخطوتين (TOTP) إلزامي |
| تطبيق الأعضاء | `/member/` | الاشتراك، الفعاليات، الفواتير، المحادثة، الجسم والتمارين، الجلسات الخاصة |
| جهاز الباب | `door-device/` | برنامج Node على جهاز الباب: قارئ RFID/Mifare/NFC + ريليه |

## تشغيل سريع
```
npm run serve        # http://localhost:8080/  (الموظفون) و /member/
npm run check        # فحص الصياغة + تطابق ar/en + تحذيرات (نصوص/ملفات غير مستعملة)
npm i && npx playwright install chromium && npm test   # اختبار دخان للواجهات بمحاكاة Supabase
```
`js/config.js` فيه عنوان مشروع Supabase والمفتاح العام (آمن للعميل: الحماية بـ RLS).

## التوثيق
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): هيكل الكود والقرارات.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): كيف تضيف تبويباً أو لغة أو migration، والاختبارات.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): النشر وإعدادات Supabase اليدوية.
- [docs/FEATURES.md](docs/FEATURES.md): سجل الميزات حسب المراحل.
- [door-device/README.md](door-device/README.md): تشغيل جهاز الباب.
- `supabase/migrations/`: كل تاريخ القاعدة (المراحل 1–23) مطابق للإنتاج، ويمكن إعادة بناء القاعدة منه.

## قواعد أساسية
- كل الكود والتعليقات بالإنجليزي، والواجهة والمستندات بالعربي (مع ترجمة إنكليزية كاملة).
- لا `innerHTML` ببيانات المستخدم، وCSP صارم في كل صفحة.
- المبالغ بأصغر وحدة (`bigint`)، والعملة لكل نادٍ.
- الدخول والخروج بكروت RFID/Mifare/NFC فقط. الخروج يجب أن يبقى ميكانيكياً دائماً.
