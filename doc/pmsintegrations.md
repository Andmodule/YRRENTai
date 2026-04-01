# PMS Integrations Roadmap

## Tier 1 — Ядро (реализовано)

### iCal / ICS sync
**Почему первым:** универсальный стандарт RFC 5545. Поддерживают Airbnb, VRBO, Expedia, HomeAway, TripAdvisor — без API-ключей.

| Направление | Описание |
|---|---|
| **Import** | Объект хранит список URL внешних `.ics` каналов. Периодически (cron) или вручную тянем события, создаём/обновляем блокировки в БД. |
| **Export** | `GET /ical/export/:propertyId.ics` — публичный `.ics` фид объекта. Любая платформа может подписаться и видеть занятость. |

**Новые поля:**
- `PropertyEntity.icalImportUrls` — `jsonb[]` список URL
- `BookingEntity.icalUid` — внешний UID события (дедупликация)

**Новые эндпоинты:**
- `GET /ical/export/:propertyId.ics` — публично, без JWT
- `POST /ical/import` — вручную потянуть один URL
- `POST /ical/sync-property` — синхронизировать все URL объекта
- `PUT /ical/urls` — сохранить список URL для объекта

---

## Tier 2 — Платежи и коммуникации

### Stripe (или ЮKassa для РФ)
- Прямой сбор платежей с гостей
- Депозиты, возвраты, webhooks
- Поля: `BookingEntity.stripePaymentIntentId`, `paidAt`, `depositMinor`

### Email-уведомления (SMTP / SendGrid)
- Подтверждение брони гостю
- Напоминания: заезд через 24ч, выезд через 24ч
- Использовать `nodemailer` (уже есть в экосистеме Node)

---

## Tier 3 — Расширенный PMS

### Умные замки (TTLock API, Nuki)
- Автовыдача PIN-кода гостю при подтверждении брони
- Отзыв PIN после выезда

### Динамическое ценообразование (PriceLabs / Beyond)
- Webhook или API-pull актуальных ставок
- Обновление тарифов через Zodomus `POST /rates`

### WhatsApp Business API (360dialog / Meta)
- Мессенджер вместо/в дополнение к Telegram
- Автосообщения гостям

### Бухгалтерия (1С, МоёДело)
- Выгрузка закрытых броней как актов
- Синхронизация оплат
