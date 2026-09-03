# Zodomus — резюме локальной проверки

**Дата:** 2026-09-03  
**Режим:** локальный backend + Zodomus sandbox (Test API)  
**Объект:** `zodomus 1test` (`1dce5f18-a6ca-46f0-9d55-bf611a91ef85`), Zodomus property id `10322630`, room `1032263001`

## Стенд

| Компонент | Состояние |
|-----------|-----------|
| Backend | `:3010`, `ZODOMUS_ENABLED=true` |
| БД | Neon (облако) |
| Redis | не запущен → availability push в режиме **inline** |
| Unit-тесты | 5 suites / **29 passed** (`zodomus-sync.inbound`, `zodomus-overbooking`, `zodomus-availability-push`, `booking.service.create`, `booking.service.transition`) |
| Smoke | `GET /integrations/zodomus/status` → `ok`; `fetch-samples` account → `zodomusApiOk: true` |
| Cleanup | тестовые прямые и OTA-брони отменены, leftover = 0 |

## Семантика (что реально проверялось)

Публичный API Zodomus **не создаёт и не отменяет** гостевые брони на Booking.com из CRM.

| Направление | Механизм |
|-------------|----------|
| CRM → Booking | Прямая бронь в RentAI + `POST /availability-multiple` (занятость) |
| Booking → CRM | Sandbox `POST /reservations-createtest` + queue sync / webhook |
| Овербукинг CRM | Hard reject `409 BOOKING_CONFLICT` |
| Овербукинг inbound OTA | Бронь сохраняется, флаг `overbookingConflict=true` |

Подробнее: [BOOKING-FLOW.md](./BOOKING-FLOW.md).

## Результаты по сценариям

| # | Сценарий | Результат | Факты |
|---|----------|-----------|--------|
| **1** | CRM → Zodomus → Booking (закрыть даты) | **Пройдено** | Прямая бронь `619ea1ce-…` (10–12 Dec 2026). Push: `pushed=true`, `segmentCount=1`, `dispatchMode=inline`. Zodomus принял `availability-multiple`. |
| **2** | CRM отмена → Zodomus (открыть даты) | **Пройдено** | Та же бронь → `CANCELLED`. Повторный push: `pushed=true`. |
| **3** | Booking → Zodomus → CRM (новая) | **Пройдено** | `createtest status=new` → sync `processed=2`. Локально: `50872921-…`, `zodomusReservationId=RENTAI-LOCAL-…`, `channelId=1`, `zodomusSynced=true`. |
| **4** | Отмена Booking → CRM | **Пройдено** | CRM cancel OTA → **400 `OTA_CANCEL_VIA_CHANNEL`**. `createtest cancelled` + sync → статус **`CANCELLED`**. |
| **5** | Овербукинг | **Пройдено** | **CRM→CRM:** вторая бронь на те же даты → **`BOOKING_CONFLICT`**. **CRM vs OTA:** create на даты OTA → **409**. **Inbound:** OTA `RENTAI-OBL3-…` upsert с **`overbookingConflict=true`** (бронь сохранена, не отклонена). |

## Ограничения sandbox

1. **`GET /availability` после close** часто всё ещё показывает `1` — sandbox врёт по readback; критерий успеха = `pushed=true` / `returnCode=200` на POST.
2. **Webhook в аккаунте Zodomus** смотрит на Render, не на localhost — inbound проверяли через **createtest + sync**.
3. **`ZODOMUS_SAMPLE_PROPERTY_ID` в `.env` нет** — queue-часть `fetch-samples` пропускается (account/channels ок).
4. **`createtest` выбирает разные даты** при каждом вызове — для inbound-overbooking нужен короткий цикл «sync → занять даты → новый createtest».

## Вердикт

Интеграция на локалке по пяти сценариям **работает**. Код по результатам этой проверки не менялся — багов в проверенных путях не найдено.
