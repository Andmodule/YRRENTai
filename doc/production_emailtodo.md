# Email (Resend) в продакшене — оценка и TODO

Краткий конспект: настройка inbound/outbound через Resend, типичные ошибки и пробелы для мультитенантности.

## Текущее состояние (что уже хорошо)

- **Вебхук** `POST /api/v1/webhooks/resend` обрабатывает `email.received`; тело письма при необходимости догружается через Received Emails API.
- **Идемпотентность**: дедуп по `Message-Id` / Resend id, advisory lock на обработку.
- **Маршрутизация к объекту** внутри одного владельца: подсказки из Booking/Zodomus (hotel id, reservation, имя объекта), иначе `RESEND_INBOUND_PROPERTY_ID` или первое свойство владельца.
- **Подпись Svix**: при заданном `RESEND_WEBHOOK_SECRET` запросы без валидной подписи отклоняются (`401`).

## Пробелы и риски (TODO)

1. **`RESEND_DEFAULT_OWNER_ID` обязателен для вебхука**  
   Без него обработчик отвечает **`400`** с текстом `RESEND_DEFAULT_OWNER_ID is not configured` — Resend будет бесконечно ретраить доставку. В проде переменная должна быть задана у **того же** процесса, что принимает HTTP (не только в локальном `.env`).

2. **Подпись вебхука в проде**  
   Если секрет не задан, верификация **пропускается** (удобно для dev, опасно для prod). В проде задать **`RESEND_WEBHOOK_SECRET`** (Svix signing secret из панели Resend).

3. **Один дефолтный владелец на весь inbound**  
   Сейчас `ownerId` для входящей почты берётся только из env, а не из адресата письма (`to` в payload не используется для выбора пользователя). Для **нескольких независимых арендодателей** с одним доменом inbound это архитектурное ограничение: все письма попадают в кабинет **одного** `users.id`, пока не будет отдельной маршрутизации.

4. **TODO (продукт): мультитенантный inbound**  
   Варианты на будущее: таблица маршрутов (адрес / поддомен / plus-tag → `ownerId`), разбор `data.to`, отдельные домены или отдельные webhook endpoints на арендодателя. До реализации — осознанно один «системный» владелец для тестового inbound.

5. **Домен и «from»**  
   `RESEND_FROM_EMAIL` должен быть с верифицированного домена в Resend; иначе API вернёт ошибку про непроверенный домен.

## Чеклист «готовы к продy» (email)

- [ ] Заданы **`RESEND_API_KEY`**, **`RESEND_FROM_EMAIL`**, при необходимости **`RESEND_INBOUND_DOMAIN`** (как в вашей схеме Resend).
- [ ] Задан **`RESEND_DEFAULT_OWNER_ID`** (UUID существующего `users.id`).
- [ ] В проде задан **`RESEND_WEBHOOK_SECRET`**; вебхук в Resend указывает на публичный URL API с **сырым телом** (Nest должен получать raw body для Svix — см. `main.ts`).
- [ ] Проверена доставка: Resend показывает **200**, а не бесконечные **Attempting** с `400`.
- [ ] Опционально: **`RESEND_INBOUND_PROPERTY_ID`**, если нужен явный объект вместо «первого свойства» владельца.

## Связанные переменные окружения

| Переменная | Назначение |
|------------|------------|
| `RESEND_API_KEY` | API Resend (outbound + fetch received body) |
| `RESEND_WEBHOOK_SECRET` | Svix secret для проверки подписи вебхука; без него в dev верификация отключена |
| `RESEND_FROM_EMAIL` | Адрес отправителя исходящих ответов |
| `RESEND_INBOUND_DOMAIN` | Документация/конфиг домена для inbound (по проекту) |
| `RESEND_DEFAULT_OWNER_ID` | UUID владельца (`users.id`) для всего inbound на этом endpoint |
| `RESEND_INBOUND_PROPERTY_ID` | Явный UUID объекта для email→chat; иначе — первое свойство владельца |

## Код (ориентиры)

- `backend/src/messaging/messaging.controller.ts` — `POST .../webhooks/resend`, проверка `RESEND_DEFAULT_OWNER_ID`
- `backend/src/messaging/messaging.service.ts` — `processInbound`, маршрутизация к **property** внутри `ownerId`
- `backend/src/messaging/guards/resend-webhook.guard.ts` — Svix / пропуск без секрета
- `backend/src/messaging/dto/resend-webhook.dto.ts` — payload; поле `to` пока не используется для выбора владельца
