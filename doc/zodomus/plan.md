# Zodomus (Channel Manager) — план и статус

**Пошаговый запуск (env → скрипт → PATCH → mapping):** [RUNBOOK.md](./RUNBOOK.md)

Сообщения гостей / чат через Zodomus **в этом документе не описаны** — отдельная задача.

## Цель

REST-клиент к [Zodomus](https://www.zodomus.com/) (Basic Auth), без утечки секретов на фронт. Интеграция опциональна (`ZODOMUS_ENABLED`).

## Архитектура

| Слой | Назначение |
|------|------------|
| `ZodomusClient` | HTTP GET/POST, Basic Auth; при ошибке в теле `body.status.returnCode` (или верхний `returnCode`) ≥ 400 → **502**; разворачивание `{ data }` где есть |
| `ZodomusService` | `/account`, `/channels`, `/price-model`, `/room-rates`, `/reservations-queue`, `/reservations`, `/availability`, `POST /rooms-activation` (`activateRooms`), ACK очереди |
| `ZodomusSyncService` | Очередь → **upsert** `BookingEntity` по `zodomusReservationId` → ACK; **`syncAllForUser`** для всех объектов с `zodomusPropertyId` |
| `ZodomusController` | См. [HTTP API](#http-api-nest) |
| `CalendarService` | `GET /calendar` — брони из БД; канал OTA выводится **не** из поля `channelSource` (такого поля нет), а из **`zodomusChannelId`** |

## HTTP API (Nest)

Базовый путь: **`/api/v1/integrations/zodomus`** (все ответы обёрнуты в `{ data: ... }`).

| Метод | Путь | Тело | Роль |
|-------|------|------|------|
| GET | `status` | — | Проверка включения и `GET /account` Zodomus |
| POST | `sync` | `{ channelId, propertyId }` | **`propertyId` — внутренний UUID объекта RentAI**; синк очереди для одного объекта |
| POST | `sync-all` | `{ channelId? }` (по умолчанию `1`) | Синк для **всех** объектов владельца, у которых задан `zodomusPropertyId` |

## Переменные окружения

См. **`.env.example`**: `ZODOMUS_ENABLED` задаётся явно (`true`/`1`/`yes`), не через `Boolean("false")`.

При `ZODOMUS_ENABLED=true` обязательны `ZODOMUS_API_USER` и `ZODOMUS_API_PASSWORD`.

Скрипт образцов: см. комментарии в `doc/zodomus/fetch-samples.mjs` (в т.ч. `ZODOMUS_RUN_ACTIVATION`, `ZODOMUS_ROOMS_ACTIVATION_JSON`, `ZODOMUS_CREATE_TEST_RESERVATION`, `ZODOMUS_CREATE_TEST_STATUS`, `ZODOMUS_CREATE_TEST_RESERVATION_ID`).

## База данных

- **bookings**: `zodomusReservationId` (varchar, unique, nullable), **`zodomusChannelId`** (int, nullable), `zodomusSynced` (boolean)
- **properties**: `zodomusPropertyId` — внешний id объекта в Zodomus для очереди / синка

Отдельного поля **`channelSource`** в сущностях нет: источник канала для календаря выводится из **`zodomusChannelId`** (см. ниже).

## `upsertBooking` (реализовано)

`ZodomusSyncService` после `GET /reservations` сохраняет бронь в **`BookingEntity`**:

- Идентификация: **`zodomusReservationId`**, **`zodomusChannelId`** = числовой `channelId` синка (например `1` = Booking.com в типичной конфигурации).
- Гость: `guestFirstName` / `guestLastName` / `guestName`, `guestEmail`.
- Даты: `checkIn`, `checkOut` (ISO-строки из API → `Date`; при отсутствии — запасные значения).
- Сумма: `totalPrice` трактуется как **основные единицы валюты** → **`totalPriceMinor`** = `round(price * 100)` (как в календаре `totalPrice = minor / 100`).
- Статус строки брони: **`mapZodomusStatusToBookingStatus(raw.status)`** → значения **`BOOKING_STATUS`** из `@rentai/shared` (по подстрокам cancel / confirm и т.д.).
- После успешного сохранения и ACK у записи выставляется **`zodomusSynced = true`**.

Если реальный JSON `GET /reservations` отличается от черновика в `zodomus.types.ts` (`ZodomusReservation`), имеет смысл **уточнить типы и маппинг полей** под живой ответ — логика upsert уже на месте.

## Календарь (frontend-user)

- Данные: **`useCalendarData`** → **`GET /api/v1/calendar?from&to`** — только брони из БД.
- В DTO брони поле **`channel`**: `'booking' | 'airbnb' | 'direct' | 'other'` — заполняется в **`CalendarService`** функцией **`calendarChannelFromBooking`** по **`zodomusChannelId`** (например `1` → `booking`, `3` → `airbnb`, иначе при наличии Zodomus → `other`, без Zodomus → `direct`).
- Объекты с **`zodomusPropertyId`** помечаются флагом **`zodomusLinked`** в ответе календаря.
- Кнопка **«Синхр. OTA»** вызывает **`POST /integrations/zodomus/sync-all`** (хук **`useZodomusCalendarSync`**, по успеху **`invalidateQueries(['calendar'])`**).

Тест вручную: задать **`zodomusPropertyId`** на объекте → синк очереди (кнопка или `sync` для одного объекта) → бронь OTA с фильтром канала **Booking** (i18n-ключи вида `channelBooking`, не обязательно строка «Booking.com»).

## Синхронизация (поток)

1. На объекте задаётся **`zodomusPropertyId`** (PATCH property / UI).
2. Вызов **`POST .../sync`** с **`channelId`** и **внутренним UUID `propertyId`**, либо **`POST .../sync-all`** с опциональным **`channelId`**.
3. Для каждого элемента очереди: поиск по **`zodomusReservationId`**; если уже **`zodomusSynced`** — пропуск; иначе **`getReservation`** → **`upsertBooking`** → **`ackReservation`**.

## Сертификация

Перед production Zodomus требует certification в sandbox; ключи Test vs Production — из backoffice.

## Снятие образцов API (локально)

Из **корня** репозитория (в `.env` — `ZODOMUS_API_USER` / `ZODOMUS_API_PASSWORD`):

```bash
node doc/zodomus/fetch-samples.mjs
```

Подробности шагов (активация, `room-rates`, `rooms-activation`, `createtest`, очередь): [RUNBOOK.md](./RUNBOOK.md).

Файлы `response-*.json` в `.gitignore`.

## Реализовано в репозитории (чеклист)

- Модуль `backend/src/integrations/zodomus/` (`client`, `service`, `sync.service`, `controller`, `module`, `tokens`, `types`, `zodomus-status.util`)
- `env.schema.ts`: блок `ZODOMUS_*`
- Миграция с полями Zodomus у **bookings** / **properties**
- Shared: `zodomusPropertyId` в схемах property
- Эндпоинты: **`status`**, **`sync`**, **`sync-all`**
- Календарь: маппинг канала из **`zodomusChannelId`**, **`zodomusLinked`**, кнопка синка OTA
- `doc/zodomus/fetch-samples.mjs` + примеры JSON для **`rooms-activation`**
