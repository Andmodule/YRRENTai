# Telegram в продакшене — оценка и TODO

Краткий конспект: что уже ок, чего не хватает для «надёжного» продa, и чеклист.

## Текущее состояние (что уже хорошо)

- **Разделение**: запись эскалации в БД и отправка в Telegram разведены; при сбое HTTP остаётся запись без `tgBotMessageId` — удобно для отладки.
- **Ретраи**:
  - С **`REDIS_URL`**: BullMQ — персистентные повторы и backoff.
  - Без Redis: инлайн-ретраи в процессе — ок для dev/малой нагрузки, хуже при рестарте между попытками.
- **Наблюдаемость**: счётчики Prometheus, опционально `GET /api/v1/metrics` при `METRICS_ENABLED=true`, в `GET /api/v1/health` — блок `telegram` (`mode: redis | inline`, при Redis — счётчики очереди).
- **Один чат на аккаунт** (`users.telegramChatId`) — меньше расхождений в конфиге.

## Пробелы (TODO для «жёсткого» продa)

1. **Redis в проде**  
   Без очереди задачи не переживают рестарт процесса. Для стабильного SLA в проде нужен **стабильный Redis** и **`REDIS_URL`**.

2. **DLQ / разбор failed**  
   После исчерпания попыток BullMQ кладёт job в **failed**. Нужен процесс: Bull Board, скрипт, алерт по `failed` или по метрикам — иначе возможен «тихий» хвост.

3. **Инциденты vs эскалации**  
   Эскалации идемпотентны по `tgBotMessageId`. Инциденты — с ретраями; при дублировании вызова теоретически возможны дубли в Telegram (редко).

4. **Защита `/metrics`**  
   Сейчас включение только через `METRICS_ENABLED`. В проде обычно ещё: **internal network**, ingress rules или basic auth.

5. **Алерты (SLO)**  
   Метрики есть; правила в Prometheus/Grafana — на стороне инфраструктуры: рост `failed`, отсутствие успешных доставок N минут и т.д.

## Чеклист «готовы к продy»

- [ ] В проде поднят **Redis**, задан **`REDIS_URL`**.
- [ ] Включён **`METRICS_ENABLED=true`**, настроен **scrape** `GET /api/v1/metrics`.
- [ ] Настроены **алерты** по failed jobs / метрикам Telegram.
- [ ] Продуман **runbook**: что делать с failed jobs, как проверить `health.telegram`.
- [ ] **`/metrics`** недоступен из публичного интернета без необходимости.

## Связанные переменные окружения

| Переменная | Назначение |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Бот API |
| `REDIS_URL` | Очередь BullMQ для эскалаций (опционально; без — инлайн-ретраи) |
| `METRICS_ENABLED` | `GET /api/v1/metrics` и node default metrics |

## Код (ориентиры)

- `backend/src/telegram/telegram-delivery.service.ts` — очередь / инлайн
- `backend/src/telegram/telegram-escalation-sender.service.ts` — HTTP-доставка эскалации
- `backend/src/telegram/telegram-metrics.service.ts` — Prometheus registry и счётчики
- `backend/src/telegram/metrics.controller.ts` — `/metrics`
