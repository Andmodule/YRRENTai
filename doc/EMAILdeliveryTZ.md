# ТЗ: inbound email pipeline (Resend → PMS / Chat)

**Назначение:** единая спецификация для production-ready, идемпотентного и безопасного приёма входящей почты от гостей Booking.com через webhooks Resend. **Код по этому документу не включён** — только требования и границы ответственности.

**Версия:** 1.0 (агрегировано из итераций обсуждения + обязательные уточнения по атомарности dedup/очереди).

---

## Context & Goal

Act as an Expert NestJS, TypeScript, and TypeORM developer. The task is to build a production-ready, idempotent, and secure inbound email processing pipeline for the PMS. The system receives webhook events from Resend containing emails (including from Booking.com guests).

**IMPORTANT — do not guess file paths.** Before writing code, use file search tools to locate:

- existing Resend webhook controllers,
- chat / messaging modules,
- `Booking` / `Reservation` entities (or equivalent),

inside `backend/src/` (or the actual backend root of this monorepo).

---

## Phase 1: Security (Fast Fail & Raw Body)

1. **Raw Body Middleware:** Resend requires the **raw, unparsed** JSON body to verify the signature. Configure NestJS middleware so the raw body `Buffer` is preserved **strictly and exclusively** for the webhook route (e.g. `/api/v1/webhooks/resend`). **Do not** break standard JSON parsing for the rest of the application.

2. **ResendWebhookGuard:** Implement a NestJS Guard using **`svix`** to verify the `svix-signature` header against the **raw body**.

3. **Order of operations:**
   - Verify Svix **on raw bytes** (no JSON parse before verification).
   - After successful verification, **parse** the body to JSON for downstream logic (dedup, queue payload).

4. **Action:** If the signature is invalid, return **`401 Unauthorized`** immediately. **Do not** return `200 OK` unless the Svix signature is fully validated. Do not execute any further logic after a failed verification.

---

## Phase 2 & 6: Concurrency, Dedup & Queue (Critical: No “Lost Webhook”)

Resend delivers webhooks **at-least-once**. A naive sequence `INSERT dedup → queue.add → 200` can **lose messages** if `queue.add` fails **after** the dedup row exists: a retry will hit `ON CONFLICT DO NOTHING`, return `200`, and **never enqueue** the job.

### 2.1 Deduplication key

- Dedicated table **`inbound_email_dedup`** (or equivalent) with **`UNIQUE(provider, external_id)`**, where:
  - `provider` = `'resend'`
  - `external_id` = Resend’s **webhook event id** for idempotency (e.g. `payload.email_id` or `payload.id` — **verify exact field names in current Resend API docs**; do not confuse with SMTP `Message-ID`).

### 2.2 Required behavior: dedup + queue without orphan rows

**Choose one strategy (document the chosen one in implementation notes):**

| Strategy | Behavior |
|----------|----------|
| **A. Rollback dedup on queue failure** | Run `INSERT … ON CONFLICT DO NOTHING` in a transaction; on success, `await queue.add(…)`. If `queue.add` throws, **delete** the dedup row (or never commit the insert — see C) and respond **`5xx`** so Resend retries the **full** webhook. |
| **B. Retry `queue.add`** | After successful dedup insert, retry `queue.add` with backoff **until success** or hard failure; only then return `200`. If hard failure after retries, **5xx** and optional dedup cleanup per policy. |
| **C. Transactional outbox** | In **one DB transaction**: insert dedup (or outbox row) + row meaning “pending dispatch”. A separate reliable worker reads outbox and calls BullMQ. HTTP handler returns `200` only when the transaction commits. |

**Anti-pattern:** insert dedup, `queue.add` fails, return `200` anyway → **permanent loss** on retried webhook.

### 2.3 Happy path (after strategy is fixed)

1. **Insert** into `inbound_email_dedup` with `ON CONFLICT DO NOTHING`.
2. **Halt on duplicate:** if **no row inserted** (`affectedRows === 0`), return **`200 OK`** immediately — **do not** enqueue, **do not** call LLM, **do not** emit Socket.IO events.
3. **Enqueue:** synchronously **`await queue.add(…)`** with **BullMQ job id** = same `external_id` (Resend event id) so at-least-once queue delivery does not duplicate **processing** logic.
4. **Return `200 OK`** to Resend **only after** `queue.add` resolves successfully (per chosen strategy A/B/C).

### 2.4 BullMQ

- Configure **job retries**, **backoff**, and **DLQ** (or dead-letter handling) for failed workers.
- Document behavior when adding a job with an **existing job id** (idempotent add vs error — depends on BullMQ settings; align with `external_id`).

---

## Phase 3: Routing Cascade (Booking Match & Normalization)

*Executed inside the BullMQ worker (not in the HTTP request path beyond enqueue).*

1. **Normalization:** Parse `from`. Extract the mailbox from RFC 5322 angle-addr (e.g. `"John" <guest@guest.booking.com>` → `guest@guest.booking.com`). **Lowercase + trim.**

2. **Step A (Alias match):** Query reservation (or booking) where **`guestEmailAlias`** (or stored proxy email) **exactly equals** the normalized address.

3. **Step B (Subject/body fallback):** If A fails, extract Booking reservation number via regex from **`subject`** (and optionally body), with an **extensible** list of locale patterns (not only `#\d{9,}`). Map to **`otaReservationId`** / internal reservation id per existing schema.

4. **Collision resolution:** If multiple rows match, filter by **`ownerId`** / property scope; prefer `status IN ('confirmed', 'in_house')`, order by **`checkInDate` DESC** (or equivalent business rules).

5. **No match:** Log **warn**, complete the job **successfully** (**do not throw**) to avoid infinite retries for permanently unmatchable mail — unless product requires DLQ review.

---

## Phase 4: Content Normalization (Anti-Fragile Parsing)

1. **HTML → text:** Use **`html-to-text`** on `html` when present. If the message is plain-text only, **fallback** to `text`.

2. **Multi-language truncation:** Maintain an extensible list of quote / thread markers (`<hr>`, `On … wrote:`, `Le … a écrit :`, `--- Original Message ---`, etc.).

3. **Disclaimers:** Strip common Booking.com footer / legal blocks via regex (expect maintenance as templates change).

4. **Output:** Only the **new** guest reply, suitable for chat and optional LLM.

---

## Phase 5: Heuristics & LLM Fallback (Spam / Bot Protection)

Run on **cleaned** text.

1. **Headers:** If Resend passes `headers`, check for `Auto-Submitted: auto-generated`, `X-Autoreply: yes`, etc. If matched → **drop** (complete job without saving guest-visible noise), **return 200** at HTTP level already happened — worker just no-ops.

2. **Short message exemption:** **Do not** drop short replies (`Ok`, `Yes`, `+1`). If length **&lt; `MIN_LLM_EVAL_LENGTH`** (configurable, e.g. 20), **skip LLM** and treat as human.

3. **LLM:** For text **≥ `MIN_LLM_EVAL_LENGTH`** with clean headers, call `LlmProviderService.verifyHumanIntent()` (or equivalent).

4. **Fail-open:** On LLM timeout/error/inconclusive heuristics → **default `isHuman = true`** (prefer noisy inbox over dropping a real guest emergency).

5. **Persist & emit:** Save message linked to reservation/property per existing data model; emit via **`ChatGateway`** (Socket.IO) to the correct room/namespace.

---

## Phase 6: Persistence & Real-Time Delivery

- Heavy work runs in the **worker** after successful enqueue.
- Ensure observability: structured logs for **ignored duplicate**, **no reservation**, **dropped by header**, **LLM path**, **save + emit**.

---

## Non-goals (this TZ)

- Frontend / Next.js implementation details.
- Inventing module paths under `backend/src/` without repository search.

---

## Alignment notes (RentAI / existing code)

- Today’s inbound path may live under **`messaging`**, **`Resend` webhook DTO**, **`rawEmailId`** dedup on messages — this TZ may **extend or converge** with that; implementers must reconcile with existing entities and migrations.
- **Guest email** identifies **conversation/thread**; **listing/property** must come from **message content / reservation linkage** (OTA ids, aliases), not from “any email from Booking” alone.

---

## Checklist before marking “done”

- [ ] Svix verification on **raw body**; `401` on failure.
- [ ] Dedup **cannot** orphan a webhook without a recoverable job (strategy A/B/C).
- [ ] Duplicate webhook → `200`, no duplicate side effects.
- [ ] `queue.add` only after dedup success; `200` only after safe enqueue per strategy.
- [ ] Worker: reservation routing, normalization, heuristics, LLM policy, persist, emit.
- [ ] BullMQ: retries, DLQ, job id = Resend event id.
- [ ] Field names for Resend payload verified against **current** API docs.

---

## Реализация в этом репозитории (сводка)

Ниже — что уже сделано в коде RentAI по состоянию на версию с миграцией `1774500000000`. Детали смотрите в `backend/src/messaging/`, `backend/src/booking/`.

| Блок ТЗ | Статус |
|--------|--------|
| **Phase 1** Raw body + Svix | Глобальный `rawBody` в `main.ts`, `ResendWebhookGuard` проверяет подпись. В **production** без `RESEND_WEBHOOK_SECRET` — `401`. |
| **Phase 2** Dedup + очередь | Таблица `inbound_email_dedup` (`UNIQUE provider + external_id`), `InboundEmailDedupService`. Ключ: `extractResendWebhookEventId` → `email_id` или `id` из `data`. При `REDIS_URL`: после успешного insert — `InboundEmailDeliveryService.enqueueWithRetries` (BullMQ, `jobId` = event id); при полном провале — удаление dedup + **503**. Без Redis — синхронный `processInbound` (dedup для событий с id не блокирует повторную обработку без id — см. контроллер). |
| **Phase 3** Алиас брони | Колонка `bookings.guest_email_alias`, `BookingService.findByGuestEmailAliasForOwner`. В `MessagingService.processInbound` для канала `booking` сначала проверяется алиас, затем прежняя цепочка `hotel_id` / бронь / имя. |
| **Phase 4** HTML | Пакет `html-to-text`, метод `htmlToPlainForInbound` в `MessageParserService` (для тела письма и подсказок). `extractBookingHotelIdFromHtml` по-прежнему использует **сырой HTML**. |
| **Phase 5** Заголовки | `shouldDropInboundByMailHeaders` (`Auto-Submitted: auto-generated`, `X-Autoreply`, `Precedence: bulk|junk|list`) — ранний выход в `processInboundCore` без записи в чат. `verifyHumanIntent` на mail path **не** используется. |
| **Phase 4** цитаты / футеры | `stripInboundQuoteNoise` после `extractInboundBody` (маркеры «On … wrote», Booking footer). |
| **Ошибки pipeline** | `processInbound` оборачивает ядро в `try/catch`: лог + `TelegramService.notifyOwnerOpsMessage` (если у владельца настроен Telegram), затем rethrow (ретраи Bull / 500 sync). |
| **Миграция** | `pnpm --filter backend exec typeorm migration:run` (или скрипт проекта) после деплоя. |

**Заполнение `guest_email_alias`:** вручную или будущим синком с OTA; пока колонка `NULL`, маршрутизация идёт по существующей логике `hotel_id` / бронь.
