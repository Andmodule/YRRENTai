# Zodomus (Channel Manager) — план и статус

**Пошаговый запуск (env → скрипт → PATCH → sync):** [RUNBOOK.md](./RUNBOOK.md)

## Цель

Единый REST-клиент к [Zodomus](https://www.zodomus.com/) (Basic Auth), без утечки секретов на фронт. Интеграция опциональна (`ZODOMUS_ENABLED`).

## Архитектура

| Слой | Назначение |
|------|------------|
| `ZodomusClient` | HTTP GET/POST, Basic Auth, `502` при ошибке upstream, нормализация `{ data }` |
| `ZodomusService` | Вызовы `/account`, `/channels`, `/reservations-queue`, `/reservations`, `/availability`, ACK |
| `ZodomusSyncService` | Очередь → upsert `BookingEntity` по `zodomusReservationId`, затем ACK |
| `ZodomusController` | `GET .../integrations/zodomus/status`, `POST .../integrations/zodomus/sync` (OWNER/MANAGER) |

## Переменные окружения

См. `.env.example`: `ZODOMUS_ENABLED` парсится явно (`true`/`1`/`yes`), не через `Boolean("false")`.

При `ZODOMUS_ENABLED=true` обязательны `ZODOMUS_API_USER` и `ZODOMUS_API_PASSWORD`.

## База данных

- **bookings**: `zodomusReservationId` (varchar, unique, nullable), `zodomusChannelId`, `zodomusSynced`
- **properties**: `zodomusPropertyId` — внешний id объекта в Zodomus для вызовов API очереди

## Синхронизация

1. На объекте задаётся `zodomusPropertyId` (PATCH property).
2. `POST /api/v1/integrations/zodomus/sync` с `channelId` и внутренним `propertyId`.
3. Для каждого элемента очереди: идемпотентность по `zodomusReservationId`; при незавершённом sync — повтор fetch + upsert + ACK.
4. Точный путь ACK уточняется по официальной доке (заглушка: `POST /reservations-queue/ack`).

## Сертификация

Перед production Zodomus требует пройти certification tests в sandbox; ключи Test vs Production из backoffice.

## Снятие образцов ответов API (локально)

Из корня репозитория (нужны `ZODOMUS_API_USER` / `ZODOMUS_API_PASSWORD` в `.env`):

```bash
node doc/zodomus/fetch-samples.mjs
```

Шаги 1–2 всегда пишут `response-account.json` и `response-channels.json`.  
Шаг 3 (`response-queue.json`) требует **id объекта в Zodomus** — в ответе `/channels` его нет. Добавьте в `.env` опционально `ZODOMUS_SAMPLE_PROPERTY_ID=<id из backoffice>` и перезапустите скрипт.

Файлы `response-*.json` в `.gitignore` (могут содержать персональные данные).

## Реализовано в репозитории

- Модуль `backend/src/integrations/zodomus/` (`client`, `service`, `sync.service`, `controller`, `module`, `tokens`, `types`)
- `env.schema.ts`: `ZODOMUS_*` + refine при `ENABLED=true`
- Миграция `1773400000000-zodomus-booking-property.ts`
- `PropertyEntity.zodomusPropertyId`, поля Zodomus в `BookingEntity`
- Shared: `zodomusPropertyId` в `createPropertySchema` / update
- Эндпоинты: `GET /api/v1/integrations/zodomus/status`, `POST /api/v1/integrations/zodomus/sync`
- Типы ответов — черновик; после первого живого `GET /account` при необходимости подправить `zodomus.types.ts` и разбор списков в `ZodomusService.normalizeArray`
