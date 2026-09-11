# Zodomus — резюме локальной проверки

**Дата:** 2026-09-11  
**Режим:** локальный backend `:3010` + frontend `:3012`, аккаунт Zodomus с `api_status: Production API`  
**Объект:** `K22 Komputerowa 7 Chopin Airport (test)` (`6254d427-090d-440f-982f-23add2320cad`), Zodomus property id `10322630`  
**Предыдущая sandbox-проверка:** [TEST-SUMMARY-2026-09-03.md](./TEST-SUMMARY-2026-09-03.md)

## Стенд

| Компонент | Состояние |
|-----------|-----------|
| Backend | `:3010`, `ZODOMUS_ENABLED=true` |
| Frontend | `:3012` |
| БД | Neon (облако) |
| Redis | не запущен → availability push в режиме **inline** (BullMQ ругается на `127.0.0.1:6379`, приложение стартует) |
| Smoke | `GET /health` → ok; `GET /integrations/zodomus/status` → `ok` |
| Zodomus account | Production API (не sandbox Test keys) |
| Unit-тесты | 5 suites / **29 passed** после фикса мока `setZodomusStatus` в `zodomus-sync.inbound.spec.ts` |

## Блокеры live CRM ↔ Booking на этом аккаунте

1. **`POST /reservations-createtest`** → `400 API function only valid for testing, not in production` — inbound «с нуля» через sandbox createtest **недоступен**.
2. Объект `10322630`: queue/summary/availability → **`Property status not Active`**; после activation — «awaiting approval»; `GET /room-rates` → Booking.com `HOTEL_ACCESS_DENIED`.
3. Webhook в кабинете Zodomus смотрит на Render (`yrrentai-1.onrender.com`), не на localhost.

Итог: полный E2E «закрыть даты на Booking и принять новую OTA-бронь» **сейчас упирается в статус объекта/доступ к Booking на стороне Zodomus**, не в отсутствие кода в RentAI.

## Результаты по сценариям

| # | Сценарий | Результат | Факты |
|---|----------|-----------|--------|
| **1** | CRM → Zodomus → Booking (закрыть даты) | **Частично** | Прямая бронь `e4baa931-…` (10–12 Mar 2027) создана в CRM без `zodomusReservationId`. `POST …/push-availability` → **503**: room-rates / Active недоступны. Сырой `POST /availability-multiple` → `Property status not Active`. |
| **2** | CRM отмена прямой | **Пройдено (локально)** | Та же бронь → `CANCELLED`. Outbound reopen на канале не проверен из‑за п.1. |
| **3** | Booking → CRM (новая) | **Заблокировано аккаунтом** | createtest запрещён в Production. Исторические OTA-строки в БД (с 2026-09-03) подтверждают прошлый успешный inbound. |
| **4** | Отмена OTA из CRM | **Пройдено** | `b6fc3435-…` (`zodomusReservationId=103226304602`) → **400 `OTA_CANCEL_VIA_CHANNEL`**. |
| **5** | Овербукинг CRM↔CRM | **Пройдено** | Вторая прямая на те же даты → **409 `BOOKING_CONFLICT`**. Inbound overbooking — unit + исторический флаг на `2fb95862-…`. |

## Матрица полей Booking → CRM (inbound)

По коду (`flattenZodomusReservationsBlock` + `upsertBooking`) и выборке существующих OTA-броней:

| Поле Zodomus | Поле CRM | Код | Живые данные (исторические) |
|--------------|----------|-----|------------------------------|
| reservationId | zodomusReservationId | да | да (`103226304602`, `RENTAI-LOCAL-…`) |
| channelId | zodomusChannelId | да | да (`1`) |
| guest first/last / name | guestName | да | да (`Jorge Mendes`, `John Mendes`) |
| customer.email / phone | guestEmail / guestPhone | да | часто **null** в sandbox createtest payload |
| guest.booking.com alias | guest_email_alias | да | null в выборке |
| arrival/departure | checkIn / checkOut | да | да (полдень TZ) |
| totalPrice | totalPriceMinor (`×100`) | да | да (52000) или **0**, если в payload не было цены |
| currencyCode | currency | да | EUR/USD |
| adults+children / guests | guestsCount (+ adults/children) | да | guestsCount есть; adults/children часто null |
| remarks / mealPlan | notes | да | да (meal plan texts) |
| payment* | otaPaymentHint | да | null в выборке |
| status / queue 3 | status / CANCELLED | да | да + unit |
| — | zodomusSynced | да | true |
| overlap | overbookingConflict | да | true на одном историческом ряду |

**CRM → Booking (outbound):** только сегменты `{ roomId, dateFrom, dateTo, availability }` — гость/цена/статус брони на канал **не** отправляются (ожидаемое ограничение API).

## Вердикт

- Локальный стек и интеграция RentAI **живы** (`status=ok`).
- Логика CRM (прямая бронь, отмена, овербукинг, блок отмены OTA) **работает**.
- Live push занятости и новый inbound с Production API **нельзя завершить**, пока объект не станет **Active** и Booking не отдаст room-rates (или пока снова не будут Test/sandbox keys для createtest).
- UI: в карточке интеграций объекта добавлен блок «Как работает Zodomus»; [BOOKING-FLOW.md](./BOOKING-FLOW.md) переведён на русский.
