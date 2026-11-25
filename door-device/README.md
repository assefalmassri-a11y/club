# برنامج جهاز الباب

يعمل على Raspberry Pi أو أي جهاز صغير بـ Node 18+ (بلا مكتبات).

## التشغيل
1. أنشئ الباب من لوحة الموظفين/قاعدة البيانات (`create_door`) واحفظ `door_id` و`secret` (يظهر مرة واحدة).
2. شغّل:
```
DOOR_ID=<uuid> DOOR_SECRET=<secret> RELAY_MODE=shelly SHELLY_URL=http://192.168.1.50 node door.mjs
```
3. اربط قارئ RFID/Mifare/NFC بالجهاز (انظر «الخيارات»).

## الخيارات
- `RELAY_MODE`: `log` (تجربة)، `shelly` (HTTP)، `gpio` (`gpioset` + `GPIO_LINE`).
- `OPEN_MS`: مدة الفتح (الافتراضي 3000، الحد الأقصى 10000).
- الكروت: مرّر UID من القارئ إلى stdin سطراً سطراً، أو `GET http://127.0.0.1:8099/tap?uid=04A1B2C3`.

## الأمان
- السر يبقى على الجهاز ولا يُرسل؛ الاتصال HTTPS مع الوسيط، والخادم المحلي على 127.0.0.1 فقط.
- ساعة الجهاز يجب أن تكون مضبوطة (NTP)، وإلا يرفض الوسيط الطلبات (401).
- **السلامة:** الخروج يجب ألا يعتمد على هذا البرنامج أو الإنترنت أو الكهرباء: مخرج ميكانيكي/زر طوارئ إلزامي.

## الحالة
اختُبر محلياً: خادم النقر المحلي يعمل. (الدخول بالكروت فقط.) لم يُختبر مع باب/ريليه/قارئ حقيقي ولا مع الوسيط بباب فعلي.

## Opening from the app (no device software needed)

Members can also open a door from the member app when they are near it. This needs no extra software on the door device: the app calls `open_door_nearby`, which creates the same open command the device already relays. Staff enable it per door in the Doors tab by standing at the door and pressing "Set door location".
