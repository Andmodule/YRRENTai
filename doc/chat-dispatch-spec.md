# Chat dispatch — спецификация v1 (реализация)

Документ для реализации **только v1**: контракты типов, хранение настроек, идемпотентность, экстренный путь до LLM, связь с существующими сущностями.

Полный продуктовый roadmap и темы v2/v3: [`chat-dispatch-vision.md`](./chat-dispatch-vision.md).

---

## Существующие сущности (расширять, не дублировать)

| Сущность | Путь в коде | Состояние на момент спеки |
|----------|-------------|---------------------------|
| Задача | `backend/src/tasks/entities/task.entity.ts` | Есть `type`, `status`, `priority`, `propertyId`, `reservationId`, `assigneeId`, `notes`, `issueDescription`, `contextLabel`. **Нет** полей источника чата. |
| Объект | `backend/src/property/entities/property.entity.ts` | Есть `timezone` (для `localHour`). **Нет** флагов авто-диспатча. |
| Сообщение чата | `backend/src/chat/entities/chat-message.entity.ts` | Есть `propertyId`, `conversationId`, `content`, `role`, `source`. **Нет** связи с задачей. |

### Поля v1 (миграции)

**`tasks` (TaskEntity):**

- `source` — `'manual' \| 'chat'` (или строка с дефолтом `'manual'`).
- `chatMessageId` — `uuid | null`; для задач из чата **обязательно NOT NULL**. **Уникальный индекс** на уровне БД: одна задача на одно сообщение (см. §3).

**`properties` (PropertyEntity):**

- `autoDispatchEnabled` — `boolean`, **default `false`**.
- `dispatchConfidenceThreshold` — `double precision` / `float`, **default `0.7`** (0–1).

**`chat_messages` (ChatMessageEntity):**

- `taskId` — `uuid | null`, FK на `tasks.id` (опционально ON DELETE SET NULL), для обратной связи UI «сообщение → задача».

*Альтернатива без `taskId` на сообщении:* хранить только `tasks.chatMessageId` — достаточно для v1, если не нужен быстрый join от сообщения к задаче; для бейджа в чате удобнее одна из сторон обязательно заполнена — **рекомендуется `tasks.chatMessageId` как источник истины**, `chat_messages.taskId` — опционально для UX.

---

## 1. Классификация гостя (`GuestMessageClassification`)

Обязательные поля в **v1** (без `confidence` ручная очередь по порогу не работает).

### TypeScript

```typescript
export type GuestIntent =
  | 'supply_request'
  | 'maintenance'
  | 'complaint'
  | 'access'
  | 'information'
  | 'emergency'
  | 'handoff_request';

export interface GuestMessageClassification {
  intent: GuestIntent;
  /** Нормализованная суть: «полотенца», «сломан кран» */
  extractedRequest: string;
  /** 0–1, обязательно в v1 */
  confidence: number;
  /** BCP 47, коротко: «ru», «en», «pl» */
  language: string;
  /** Гость повторяет тот же запрос (эвристика/LLM) */
  isRepeat: boolean;
}
```

### JSON Schema (draft 2020-12) — валидация ответа LLM

Использовать как `response_format` / пост-валидацию в коде; при несоответствии — см. §6 п.3 (один retry, затем ручная очередь + `generic_ack`).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["intent", "extractedRequest", "confidence", "language", "isRepeat"],
  "properties": {
    "intent": {
      "type": "string",
      "enum": [
        "supply_request",
        "maintenance",
        "complaint",
        "access",
        "information",
        "emergency",
        "handoff_request"
      ]
    },
    "extractedRequest": { "type": "string", "minLength": 1, "maxLength": 500 },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "language": { "type": "string", "pattern": "^[a-z]{2}(-[A-Z]{2})?$" },
    "isRepeat": { "type": "boolean" }
  }
}
```

### Порог уверенности

- Читать `dispatchConfidenceThreshold` с **Property** (дефолт `0.7`).
- Если `confidence < threshold` → **не** создавать задачу автоматически (или создавать с флагом «требует проверки» — выбрать одно поведение в задаче и зафиксировать); минимум v1 — **попадание в ручную очередь / inbox менеджера** + безопасный ответ гостю без ложных обещаний SLA.

---

## 2. Модуль политик — контекст, политика, решение

Не оставлять только `resolveDispatch` без типов: реализация — **отдельный модуль** (например `dispatch-policy.service.ts`), внутри могут быть дефолты из констант + чтение колонок Property.

### `DispatchContext`

```typescript
export interface DispatchContext {
  propertyId: string;
  /** В коде бронирования используется reservationId (см. TaskEntity) */
  reservationId: string | null;
  messageId: string;
  /** Из сохранённого `ChatMessage`: `conversationId`, если сообщение в треде; иначе `null`. */
  conversationId: string | null;
  classification: GuestMessageClassification;
  /** 0–23, час в таймзоне объекта (Property.timezone) */
  localHour: number;
  /** Уже сработал pre-LLM emergency guard */
  emergencyPreLlmTriggered: boolean;
}
```

### Хранение политик в v1

- **Глобальные дефолты** — константы в коде (тихие часы, шаблоны, кто эскалируется).
- **Пер-объектные** — колонки `Property`: `autoDispatchEnabled`, `dispatchConfidenceThreshold`.
- Отдельная таблица `dispatch_policies` **не обязательна в v1**; вводить при portfolio/UI настроек (v2).

### `DispatchPolicy` (эффективная политика после merge дефолт + property)

```typescript
export type AssigneeRole = 'staff' | 'manager';

export interface DispatchPolicy {
  /** null в v1 не используется; зарезервировано для глобального дефолта из БД позже */
  propertyId: string | null;
  autoDispatchEnabled: boolean;
  dispatchConfidenceThreshold: number;
  defaultAssigneeRole: AssigneeRole;
  escalateToTelegram: boolean;
  quietHoursStart: number; // 0–23, например 22
  quietHoursEnd: number; // 0–23, например 8
}
```

Загрузка: из Property + дефолты из констант.

**Правило v1:** `resolveDispatch` **обязан** учитывать `policy.autoDispatchEnabled`. Если `autoDispatchEnabled === false`, в результате **`createTask: false`** (классификация для логов/eval может выполняться снаружи, но задача из политики не выходит). Не дублировать проверку флага после `resolveDispatch` — единственный источник решения о создании задачи: **`decision.createTask`**.

### `TaskType` (строгое множество для `TaskEntity.type`)

В БД поле — `varchar(32)`; в коде уже используются значения из сидов и `tasks.service.ts`. Зафиксировать union и не подставлять произвольные строки.

```typescript
/** Допустимые значения `TaskEntity.type` в проекте. Расширять при добавлении новых типов в сущность/сид. */
export type TaskType =
  | 'manual'
  | 'checkout_cleaning'
  | 'checkin_prep'
  | 'mid_stay_cleaning';
```

**v1 авто-диспатч из чата:** создавать задачи с типом **`manual`** (или отдельный тип в будущем — только после миграции и обновления этого union).

### `ReplyConstraints`

Ограничения на ответ гостю и генерацию текста (чтобы не «галлюцинировать» SLA).

**Источник `maxSlaMinutes`:** не LLM. Задаётся **константами модуля политики** по сопоставлению `intent` → минуты (пример для v1, настраивается в коде):

| intent | пример `maxSlaMinutes` |
|--------|-------------------------|
| `supply_request` | `30` |
| `maintenance` | `120` |
| `complaint` | `null` (не обещать число) |
| `access` | `null` или срочное по политике |
| `information` / `handoff_request` | не применимо к SLA-обещанию |

LLM **не генерирует** числа минут; в шаблон подставляются только значения из `ReplyConstraints`, сформированного политикой.

```typescript
export type ReplyTemplateId =
  | 'supply_confirmed'
  | 'maintenance_accepted'
  | 'escalated'
  | 'info_only'
  | 'emergency'
  | 'handoff'
  | 'low_confidence_queue'
  | 'generic_ack';

export interface ReplyConstraints {
  templateId: ReplyTemplateId;
  /** Верхняя граница минут для подстановки в шаблон; null = не обещать число */
  maxSlaMinutes: number | null;
  /** Если true — финальный текст собирается из шаблона, LLM не вставляет свои минуты */
  forbidNumericSlaInLlmText: boolean;
}
```

### `DispatchDecision` (выход `resolveDispatch`)

```typescript
export type TaskPriority = 'normal' | 'urgent'; // согласовать с TaskEntity.priority

export interface DispatchDecision {
  createTask: boolean;
  priority: TaskPriority;
  assigneeRole: AssigneeRole;
  escalate: boolean;
  replyConstraints: ReplyConstraints;
  /** Тип задачи для `TaskEntity.type`, только если `createTask`; v1 из чата: `manual` */
  taskType?: TaskType;
}
```

Сигнатура: `resolveDispatch(context: DispatchContext, policy: DispatchPolicy): DispatchDecision`.

---

## 3. Идемпотентность создания задачи из чата

**Цель:** повтор HTTP/повтор обработки одного и того же сообщения не создаёт вторую задачу.

**v1 — каноничный способ:** уникальность на уровне БД.

- Частичный **уникальный индекс** PostgreSQL: `UNIQUE (chat_message_id) WHERE chat_message_id IS NOT NULL` (имя колонки в миграции — как в TypeORM, обычно `chatMessageId` → в БД часто `chatMessageId` или snake_case по настройкам).
- Для задач, созданных из чата, **`chatMessageId` всегда заполняется** — вторая вставка с тем же id сообщения получит ошибку уникальности → обработать как идempotent success (вернуть существующую задачу) или no-op.

Опционально для HTTP-клиентов: заголовок `Idempotency-Key` = `messageId` — удобство, но **источник истины** — уникальный индекс по `chatMessageId`, а не SHA-256 в приложении.

Повтор текста гостем = **новый** `messageId` → новая строка задачи допустима (смысловой дедуп «окно N минут» — отдельное правило политики, не путать с уникальностью по сообщению).

---

## 4. Feature flags (v1)

Отдельный сервис LaunchDarkly **не вводить**.

Использовать колонки на **`properties`**:

- `autoDispatchEnabled` (boolean, default `false`)
- `dispatchConfidenceThreshold` (float, default `0.7`)

Поведение: при `autoDispatchEnabled === false` политика внутри `resolveDispatch` выставляет **`createTask: false`**; отдельная проверка флага перед `INSERT` не нужна (см. §2).

---

## 5. Emergency — двухуровневая схема (v1)

**Не ждать ответа LLM** для критичных по задержке сценариев.

1. **До вызова LLM:** быстрый **keyword / regex guard** по нормализованному тексту (минимум RU; расширить en/pl по мере необходимости). Примеры категорий: пожар, газ, кровь, угроза жизни, «вызовите скорую», `112`, «помогите» в явном контексте ЧС — список ведётся в константах, версионируется.
2. При срабатывании: **немедленная эскалация** (Telegram/логика дежурного по существующим каналам) + **фиксированный шаблон гостю** («Немедленно звоните 112 / экстренные службы вашего региона») без обещаний про горничную.
3. **После** (параллельно или опционально): вызов LLM для логирования `intent: emergency` и аудита — **не блокирует** первый ответ гостю.

Классификатор LLM всё равно может вернуть `emergency` — второй слой; при уже сработавшем guard поле `emergencyPreLlmTriggered: true` в `DispatchContext`.

---

## 6. Пайплайн v1 (порядок)

1. Сохранить сообщение гостя (`chat_messages`).
2. Emergency pre-LLM → при hit: эскалация + шаблон гостю; решение политики может запретить второй «творческий» ответ.
3. Иначе: LLM structured classification → валидация JSON Schema.
   - При **невалидном JSON:** один **retry** с коротким исправляющим промптом («верни только JSON по схеме»).
   - После **второй неудачи** → запись в **ручную очередь** / inbox менеджера + ответ гостю по шаблону `generic_ack` (без обещаний SLA).
4. Загрузить Property, собрать `DispatchPolicy` (включая `autoDispatchEnabled`), вычислить `localHour` из `Property.timezone`.
5. `resolveDispatch(context, policy)` — внутри учитываются `autoDispatchEnabled`, порог `confidence`, intent; итоговое **`decision.createTask`** уже финально.
6. Если **`decision.createTask`** → создать задачу (`source: 'chat'`, `chatMessageId`, тип из `decision.taskType`); идемпотентность — **уникальный индекс** по `chatMessageId` (§3). Повторной проверки `autoDispatchEnabled` здесь **нет**.
7. Сгенерировать ответ гостю с учётом `decision.replyConstraints` (шаблон + опционально LLM в рамках запретов).

---

## 7. Порядок реализации (первые шаги)

1. Контракт классификации: `GuestMessageClassification` + JSON Schema; поля связи `messageId`, `propertyId`, `reservationId`; **`confidence` обязателен**.
2. Модуль политик: `resolveDispatch(context, policy) → DispatchDecision` с полями **`createTask`**, **`escalate`**, **`replyConstraints`**, **`taskType`** (не использовать имена `shouldCreateTask` / `shouldEscalate` — они не каноничны).
3. Пайплайн: шаги как в §6; при невалидном JSON — retry и fallback как в §6 п.3.
4. Миграции: `tasks.source`, `tasks.chatMessageId` + **уникальный индекс**; колонки Property для флагов.
5. Eval: 10–20 сценариев на staging.

---

## 8. Связанные документы

- [`chat-dispatch-vision.md`](./chat-dispatch-vision.md) — roadmap, v2/v3, дополнительные практики.
- [`staff.md`](./staff.md) — staff app и задачи.
- Указатель: [`chatclassification.md`](./chatclassification.md).
