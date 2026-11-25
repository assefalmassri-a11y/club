-- Phase 20: remove all QR-based entry/check-in. Entry is by RFID/Mifare/NFC cards (card_tap) only.
drop function if exists public.scan_door(uuid, text);
drop function if exists public.check_in_with_token(text, uuid);
drop function if exists public.create_checkin_token(uuid);
drop function if exists private.door_code(text, bigint);
drop table if exists public.checkin_tokens;
