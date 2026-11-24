# «Скидка» поверх базовой цены

Согласовано с менеджером K22 2026-11-23: «выбираю дни, ставлю −10 %, цена снижается сразу на Booking и Airbnb,
в Basic ничего не уходит». Basic Booking (акции, «Скидки») остаётся отдельной функцией — для сезонных цен.

## Как работает

- Скидка — отдельная запись (`property_price_discounts`): ночи, процент 1–90, площадки (Booking / Airbnb),
  название. Базовая цена **не переписывается**.
- Цена ночи на площадке = (своя цена площадки на ночь **или** базовая × % площадки, с «Автоценами»)
  × (1 − скидка), целыми злотыми, не ниже минимальной цены. Если цена до скидки уже ниже минимума — остаётся как
  была. Пересекающиеся скидки не складываются: действует наибольшая.
- «Убрать» удаляет запись — ночи возвращаются к **текущей** базовой (если базовую за это время меняли руками или
  «Автоцены» — учитывается новая).
- Ночи без базовой цены: при создании скидки берут цену Booking, если ночь открыта на продажу (как «Заполнить из
  Booking»; на Booking ничего не меняется). Ночи без цены нигде — в ответе списком, скидка начнёт действовать, когда
  у них появится базовая.
- Airbnb получает цену сам (правило «Airbnb от базовой», `ZODOMUS_AIRBNB_PRICE_FROM_BASE`). Если правило
  выключено, Airbnb считается от цены Booking: скидка Airbnb на него не действует, а скидка Booking доходит до
  Airbnb после отправки в Booking (панель так и пишет и по умолчанию предлагает только Booking).
- Booking — кнопкой «Отправить в Booking» панели «Базовая цена» (после сохранения скидки панель сразу показывает
  проверку). Исключение: ночи с «Автоценами» — утренний запуск сам отправляет их цену в Booking, уже со скидкой
  (и без неё после «Убрать»).
- Базовая, взятая из Booking при создании скидки, пересчитывается обратно через % Booking — цена Booking ночи до
  скидки остаётся прежней. Для Airbnb такие ночи дальше считаются от базовой.
- В клетке базовая не меняется, рядом метка «−10%»; сниженные цены — в строках B и A.
- Расхождение с «Заполнить из Booking»: та кнопка кладёт в базовую цену Booking как есть (без пересчёта через
  % Booking). При % Booking ≠ 0 одна и та же ночь получит разную базовую в зависимости от кнопки.
- Гость не видит зачёркнутой цены и плашки — это не акция Booking. Видимая скидка на Booking — только Basic.

## Включить

1. Миграция `1779000000000-pricing-discounts` (одна новая таблица). SQL для консоли Neon:

```sql
CREATE TABLE IF NOT EXISTS "property_price_discounts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" uuid NOT NULL,
  "dateFrom" date NOT NULL,
  "dateTo" date NOT NULL,
  "pct" smallint NOT NULL,
  "channels" jsonb NOT NULL,
  "name" varchar(80),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_property_price_discounts" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_property_price_discounts_pct" CHECK ("pct" BETWEEN 1 AND 90),
  CONSTRAINT "CHK_property_price_discounts_dates" CHECK ("dateFrom" <= "dateTo"),
  CONSTRAINT "FK_property_price_discounts_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_property_price_discounts_property_dates" ON "property_price_discounts" ("propertyId", "dateFrom", "dateTo");
INSERT INTO "migrations" ("timestamp", "name") VALUES (1779000000000, 'PricingDiscounts1779000000000');
```

2. `ZODOMUS_PROMOTIONS_DISCOUNTS_ENABLED=true` (нужна включённая «Базовая цена»). Выключено — API 503, блока
   «Скидка» нет, таблица не читается, цены как раньше.

Откат: флаг в `false` — скидки перестают действовать сразу (Airbnb — при следующей отправке, Booking — при
следующей «Отправить в Booking»). Таблица: `DROP TABLE IF EXISTS "property_price_discounts";` и удалить строку
из `"migrations"`.

## API

`POST /api/v1/pricing/base-prices/:propertyId/discounts` `{ from, to, pct, channels, name? }` →
`{ discount, filledFromBooking, noPrice[], atMin[] }`; `DELETE …/discounts/:id` → `{ from, to }`.
`GET …/base-prices/:propertyId` отдаёт ещё `discountsEnabled`, `discounts`, `discountPct.{booking,airbnb}`.

Код: `backend/src/pricing/discount.util.ts` (формула; фронт — `discountedPrice` в
`frontend-user/src/modules/pricing/lib/guest-price.ts`), `pricing-base-price.service.ts` (`bookingTargets`,
`createDiscount`, `deleteDiscount`), `airbnb/airbnb-own-price.service.ts` + `ownAirbnbPrices`. Фронт:
`calendar/property-month/DiscountSection.tsx`, клетка — `MonthGrid.tsx` (метка «−10%» у базовой).

## Не сделано

- Скидки самого Airbnb («последняя минута», «раннее бронирование») в строке «A» — следующий шаг (пункт 7):
  нужны поля в «Настройках площадок».
- Проверено только тестами; на проде и в браузере не открывалось.

# Скидки самого Airbnb в строке «A» (пункт 7, 2026-11-24)

Только показ: RentAI отправляет в Airbnb ту же цену, Airbnb сам вычитает свои скидки. RentAI их не читает —
менеджер переписывает из Airbnb (Настройки → Скидки) в «Цена для гостя» → «Настройки площадок» → «Скидки самого
Airbnb»: последняя минута (% и за 0–28 дней до заезда), раннее бронирование (% и за 1–36 месяцев).

- Правило Airbnb: одна скидка на ночь; недельная/месячная важнее последней минуты и раннего бронирования.
- Клетка: `A 300 → 270` — после стрелки цена ночи для гостя при брони сегодня (подсказка называет скидку).
- «Цена для гостя» Airbnb: на 1–6 ночей — скидка по дню заезда; от 7 ночей — недельная/месячная. Учитывает и
  «Скидку» RentAI на Airbnb.
- Скидки у объявлений пилота на 2026-11-24 — вики `rentai/wiki/sources/2026-11-24-skidki-airbnb-pilot.md`.

Включить: SQL в Neon, затем `ZODOMUS_PROMOTIONS_AIRBNB_DEALS_ENABLED=true` (нужна «Цена для гостя»).

```sql
CREATE TABLE IF NOT EXISTS "property_airbnb_deals" (
  "propertyId" uuid NOT NULL,
  "lastMinutePct" smallint,
  "lastMinuteDays" smallint,
  "earlyBirdPct" smallint,
  "earlyBirdMonths" smallint,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_property_airbnb_deals" PRIMARY KEY ("propertyId"),
  CONSTRAINT "CHK_property_airbnb_deals_last_minute" CHECK ("lastMinutePct" IS NULL OR ("lastMinutePct" BETWEEN 1 AND 99 AND "lastMinuteDays" BETWEEN 0 AND 28)),
  CONSTRAINT "CHK_property_airbnb_deals_early_bird" CHECK ("earlyBirdPct" IS NULL OR ("earlyBirdPct" BETWEEN 1 AND 99 AND "earlyBirdMonths" BETWEEN 1 AND 36)),
  CONSTRAINT "FK_property_airbnb_deals_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
);
INSERT INTO "migrations" ("timestamp", "name") VALUES (1779100000000, 'PricingAirbnbDeals1779100000000');
```
