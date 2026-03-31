# Zodomus — пошаговый runbook (один объект)

Все ответы RentAI API обёрнуты в `{ "data": ... }`. Учитывайте это в `jq` и при проверках.

## 1. Переменные в `.env` (корень репозитория)

Не оставляйте `ZODOMUS_ENABLED` пустым — только явные значения: `true`, `false`, `1`, `0`, `yes`, `no`.

```env
ZODOMUS_ENABLED=true
ZODOMUS_API_USER=your_user
ZODOMUS_API_PASSWORD=your_password
ZODOMUS_BASE_URL=https://api.zodomus.com
# Для скрипта образцов (шаг 3 — очередь): id объекта в кабинете Zodomus
ZODOMUS_SAMPLE_PROPERTY_ID=your_zodomus_property_id
```

При `ZODOMUS_ENABLED=true` обязательны user и password (проверяет `env.schema.ts`).

## 2. Снять образцы JSON (account, channels, queue)

Скрипт читает **` .env` в корне репозитория** (не `backend/.env`, если его нет).

```bash
# Убедиться, что переменные заданы (из корня репозитория)
grep ZODOMUS .env
# Windows PowerShell:
# Select-String ZODOMUS .env

node doc/zodomus/fetch-samples.mjs
```

В каждом JSON в `_meta` есть **`zodomusApiOk`**: у Zodomus часто **HTTP 200**, но ошибка внутри в виде `body.status.returnCode` (например `400` и `Invalid property id`). Смотрите `_meta.zodomusApiOk` и `body.status.returnMessage`.

Файлы: `doc/zodomus/response-*.json` (в `.gitignore`). Без `ZODOMUS_SAMPLE_PROPERTY_ID` шаг queue будет пропущен — см. `_meta` в `response-queue.json`.

### Что дальше по `response-queue.json`

| Что видите | Следующий шаг |
|------------|----------------|
| Очередь броней с понятными полями | Уточнить типы `ZodomusReservation` и `upsertBooking` в backend |
| Пустой массив очереди при `zodomusApiOk: true` | Объект может быть не активирован в Zodomus — см. их `POST /property-activation` в доке |
| `body.status.returnCode` 401/403 | Неверные ключи или объект не привязан к аккаунту |
| `Invalid property id` / 404 по смыслу | `ZODOMUS_SAMPLE_PROPERTY_ID` не тот id, что ожидает Zodomus — проверить в кабинете / активацию канала |

### Почему 400 при HTTP 200 и как исправить (Mapping API)

Zodomus часто отвечает **HTTP 200**, а успех/ошибка лежит в **`body.status.returnCode`** (например `200` = ок, `400` = ошибка бизнес-логики).

Для **`GET /reservations-queue`** объект должен быть **привязан к каналу** (Mapping): типичный порядок в их доке — `POST /property-activation` → при необходимости `POST /rooms-activation` → `POST /property-check`, и только потом очередь. Без активации запросы с `propertyId` могут возвращать `400` / `Invalid property id`.

**Sandbox:** тестовый объект в Zodomus backoffice (Development). **`Property awaiting approval`** в ответе на `POST /property-activation` — нормальный статус sandbox, не блокер. Возьмите **`propertyId`** как `ZODOMUS_SAMPLE_PROPERTY_ID`. Скрипт вызывает **`GET /room-rates`**, затем **`POST /rooms-activation`** в официальном формате Zodomus: `rooms[]` с **`roomId`**, **`roomName`**, **`quantity`**, **`status`**, **`rates`** (массив id тарифов) — см. **`doc/zodomus/rooms-activation.example.json`**. Ручной override: **`ZODOMUS_ROOMS_ACTIVATION_JSON`** (файл или JSON-строка). После успешной активации ожидайте в ответе что-то вроде **«Number of rooms activated: N»**, затем **`POST /property-check`** → Ok и работает **`GET /reservations-queue`**.

**Скрипт с активацией** (из корня репозитория):

```env
ZODOMUS_SAMPLE_PROPERTY_ID=...
ZODOMUS_RUN_ACTIVATION=true
# опционально: если не задать, скрипт возьмёт первый id из GET /price-model
# ZODOMUS_PRICE_MODEL_ID=...
# опционально: свой канал (по умолчанию — первый из /channels)
# ZODOMUS_SAMPLE_CHANNEL_ID=1
# опционально: свой JSON для POST /rooms-activation (иначе берётся из GET /room-rates)
# ZODOMUS_ROOMS_ACTIVATION_JSON=doc/zodomus/rooms-activation.mapped-products.example.json
# опционально: тестовая бронь в sandbox
# ZODOMUS_CREATE_TEST_RESERVATION=true
# ZODOMUS_CREATE_TEST_STATUS=new   # new | modified | cancelled | summary — обязательно для POST /reservations-createtest
# ZODOMUS_CREATE_TEST_RESERVATION_ID=   # optional — свой id тестовой брони (поле reservationId в теле createtest)
```

```bash
node doc/zodomus/fetch-samples.mjs
```

Появятся файлы `response-property-check.json`, `response-price-model.json`, `response-property-activation.json`, **`response-room-rates.json`**, `response-rooms-activation.json`, при необходимости `response-createtest.json`, затем `response-queue.json`.

**Backend:** `ZodomusClient` выбрасывает **502**, если в теле **`body.status.returnCode`** (или верхнеуровневый **`returnCode`**) указывает на ошибку (≥ 400).

## 3. Привязать объект в RentAI (только внешний id Zodomus)

- **`RENTAI_UUID`** — внутренний UUID объекта в RentAI (из UI или `GET /api/v1/properties`).
- **`zodomusPropertyId`** — id объекта в **кабинете Zodomus** (не обязательно «hotel_id из URL Booking»; сверяйте с Zodomus).
- **`zodomusChannelId` на property не задаётся** — канал передаётся при синке.

```bash
curl -X PATCH "http://localhost:PORT/api/v1/properties/RENTAI_UUID" \
  -H "Cookie: access_token=..." \
  -H "Content-Type: application/json" \
  -d '{"zodomusPropertyId":"your_zodomus_property_id"}'
```

Подставьте свой **PORT** (часто `3010`, см. `backend` / корневой `.env`).  
Авторизация: как у вашего клиента — **Cookie** (httpOnly JWT) или **`Authorization: Bearer <token>`** после логина.

## 4. Проверить, что поле сохранилось

```bash
curl -s "http://localhost:PORT/api/v1/properties/RENTAI_UUID" \
  -H "Cookie: access_token=..." \
  | jq .data.zodomusPropertyId
```

## 5. Запустить синк очереди броней

Здесь **`propertyId` — внутренний UUID объекта RentAI**, не OTA id.

`channelId` — из `response-channels.json` (например Booking.com → `id: 1`).

```bash
curl -X POST "http://localhost:PORT/api/v1/integrations/zodomus/sync" \
  -H "Cookie: access_token=..." \
  -H "Content-Type: application/json" \
  -d '{"channelId":1,"propertyId":"RENTAI_UUID"}'
```

## 6. Статус интеграции Zodomus (вместо отдельного property-check)

```bash
curl -s "http://localhost:PORT/api/v1/integrations/zodomus/status" \
  -H "Cookie: access_token=..." \
  | jq .
```

Ожидаемо при включённой интеграции:

```json
{
  "data": {
    "status": "ok",
    "account": { }
  }
}
```

Если интеграция выключена: `{ "data": { "status": "disabled" } }`.

## Роли

Эндпоинты property и Zodomus требуют JWT с ролью **OWNER** или **MANAGER**.

## Дальше

После успешного синка можно доработать маппинг `upsertBooking` по реальному `response-queue.json` и затем массовый онбординг объектов.
