# Zodomus integration — fix plan

Выявлено по официальной документации Zodomus (doc/zodomus/documentationzodomus, doc/zodomus/apifaq).

## Исправления (реализованы в рамках этого PR)

| # | Файл | Проблема | Исправление |
|---|------|----------|-------------|
| 1 | `zodomus.service.ts` | `/reservations-queue/ack` — эндпоинта нет в Zodomus API; GET /reservations само снимает бронь с очереди | Удалить метод `ackReservation`; убрать вызов из sync-сервиса |
| 2 | `zodomus-sync.service.ts` | Статус из очереди — **число** (1=new, 2=modified, 3=cancelled); код пытался делать `.includes('cancel')` по строке | `mapZodomusQueueStatus` → числовое сравнение; `status=3` → немедленно отменяем бронь в БД без GET /reservations |
| 3 | `zodomus-sync.service.ts` | При `status=2 (modified)` нужно перечитать полную бронь и обновить; при `status=3 (cancelled)` — отменить без лишнего GET | Раздельные ветки по числовому статусу очереди |
| 4 | `zodomus.service.ts` | `POST /availability` принимает `dateFrom`/`dateTo`/`availability` (одно число), не `dates[]` | Переписать `setAvailability` под правильный формат |
| 5 | `zodomus.service.ts` | `GET /price-model` — No request payload; `channelId` передавался зря | Убрать параметр |
| 6 | `zodomus.service.ts` | `normalizeArray` не обрабатывает ключ `rooms` — `GET /room-rates` возвращал `[]` | Добавить ветку для `rooms` |
| 7 | `zodomus.controller.ts` + новый `zodomus-webhook.controller.ts` | Нет Webhook-эндпоинта — брони от Zodomus при webhook-режиме терялись | `POST /integrations/zodomus/webhook` без JWT, с проверкой `webhookKey` из env |
| 8 | новый `zodomus-cron.service.ts` | Нет автоматического polling — очередь опрашивалась только вручную | `@nestjs/schedule` cron каждые 15 мин для всех объектов с `zodomusPropertyId` |
| 9 | `zodomus.service.ts` + `zodomus.controller.ts` | Нет `GET /reservations-summary` — при онбординге теряются исторические будущие брони | Метод `getReservationSummary` + эндпоинт `POST /integrations/zodomus/import-summary` |

## Переменные окружения добавлены

```env
# Ключ для верификации входящих webhook-вызовов от Zodomus (backoffice → Development → Webhook key)
ZODOMUS_WEBHOOK_KEY=

# Интервал опроса очереди в минутах (по умолчанию 15)
ZODOMUS_POLL_INTERVAL_MINUTES=15

# ID канала для cron-polling (по умолчанию 1 = Booking.com)
ZODOMUS_DEFAULT_CHANNEL_ID=1
```

## Важно: разница test / production

- **Sandbox:** `GET /reservations-queue` возвращает фиксированные данные. ACK (удаление из очереди) происходит после `GET /reservations`. Повторный запрос очереди вернёт те же id до следующего `createtest`.
- **Production:** брони поступают в реальном времени. Рекомендуется **и webhook, и cron** (webhook — мгновенно, cron — страховка при сбоях webhook).
