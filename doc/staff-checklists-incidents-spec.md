# Staff — чеклисты в задаче и инциденты (реализация)

Источник: обсуждение roadmap + ТЗ. **i18n** откладывается: строки ключей в `frontend-staff/src/strings/` (или `strings.ts`) с ключами вида `tasks.checklist.title` — позже подключить next-intl без переписывания компонентов.

**UI:** чеклист персонала — в **`TaskDetailStaff`** и связанных экранах staff PWA; менеджерский drawer Kanban — в `frontend-user` (не путать с `TaskDetailDrawer`).

---

## Доступность (a11y) — DoD

Не «настройка в профиле», а требования к разметке:

- Чекбоксы с осмысленным `aria-label` (пункт + задача).
- Прогресс чеклиста: `aria-live="polite"` при изменении счётчика.
- «Обязательно» — не только цвет, текст/бейдж.
- Фокус и Escape в drawer/модалках (vaul/Radix).
- Минимальная зона нажатия (уже в ТЗ ~48px).

Опционально позже: `prefers-reduced-motion`, увеличение шрифта в настройках.

---

## RBAC (кратко)

| Действие | STAFF | OWNER/MANAGER |
|----------|-------|----------------|
| `PATCH` пункт чеклиста задачи | только если `assigneeId` = self | через `ensureTaskAccess` по владельцу объекта |
| `PATCH task` → `done` с обязательными пунктами | 422, если не все required | то же; `?forceComplete=true` только OWNER/MANAGER |
| CRUD шаблонов | — | да |
| CRUD инцидентов (создание) | да (POST) | — |
| Список/редактирование инцидентов | — | да |

**Офлайн + localStorage:** в v1 не реализуем; при появлении — описать merge-правила (конфликт сервер vs клиент).

---

## FEATURE 1: Шаблоны и чеклист задачи

### Сущности (backend)

- `checklist_templates`: `id`, `name`, `autoApplyToType` (nullable `varchar` / enum по типам задач), `ownerId`, `propertyId` (nullable), `createdAt`.
- `checklist_template_items`: `id`, `templateId`, `text`, `required`, `order`.
- `task_checklist_items`: копия для задачи — `id`, `taskId`, `text`, `required`, `order`, `checked`, `checkedAt`, `checkedBy` (nullable).

Приоритет шаблона при авто-применении: **property-specific** (`propertyId` = задачу) **>** глобальный (`propertyId IS NULL`).

### Логика

1. После сохранения новой задачи — найти подходящий шаблон и скопировать строки в `task_checklist_items`.
2. При `PATCH` статуса `done`: если есть `required=true` и `checked=false` → **422** с телом `{ message, uncheckedRequired: string[] }`, кроме `forceComplete=true` и роли OWNER/MANAGER.

### API

- `GET /tasks/:uuid/checklist` — список пунктов.
- `PATCH /tasks/:uuid/checklist/:itemId` — `{ checked: boolean }`.
- `PATCH /tasks/:uuid?forceComplete` — не отдельный endpoint; query на существующем `PATCH /tasks/:uuid` вместе с `status: done`.
- Шаблоны: `GET/POST/PATCH/DELETE /checklist-templates`, CRUD пунктов по необходимости.

Событие сокета: `checklist_item_updated` `{ taskId, itemId, checked }`.

---

## FEATURE 2: Инциденты (забытые вещи / повреждения)

- Отдельная таблица `incidents` (не расширение `issue` задачи).
- Типы: `lost_item`, `damage`; статусы: `open`, `in_review`, `resolved`, `closed`.
- Поля: `propertyId`, `taskId?`, `reservationId?`, `reportedBy`, `description`, `photoUrls` (**jsonb** массив строк), поля по типам (lost: `guestName`, `itemDescription`; damage: `damageLocation`, `estimatedCost`), менеджерские поля.

### API

- `POST /incidents` — создание (STAFF); минимум 1 фото (URL после загрузки или multipart — как в проекте для задач).
- `GET /incidents` — фильтры (manager/owner).
- `GET/PATCH /incidents/:uuid`.

Уведомление в Telegram через `resolveAlertChatId(propertyId, ownerId)` + текст по шаблону.

---

## Порядок реализации

1. Миграции + entities.
2. `ChecklistService` + CRUD шаблонов + авто-применение + guard при `done`.
3. `IncidentsService` + Telegram.
4. Staff PWA: строки, чеклист в `TaskDetailStaff`, `IncidentReportDrawer`, FAB.
5. Dashboard: настройки шаблонов, страница инцидентов.

## Out of scope v1

PDF, депозит, email гостю, полный audit log инцидента (см. `staff-roadmap.md`).

---

## Статус реализации (код)

| Блок | Сделано |
|------|---------|
| Миграции + сущности | `1773200000000-checklists-and-incidents.ts`, entities в `tasks/` и `incidents/` |
| Чеклист задачи | `GET/PATCH .../tasks/:uuid/checklist`, guard при `done`, `forceComplete`, сокет `checklist_item_updated`, `checklistSummary` в DTO задач |
| Шаблоны | `GET/POST/DELETE /checklist-templates`, авто-копирование при `seedDemoIfEmpty` и любой новой задаче через `applyAutoTemplateIfAny` |
| Инциденты | `POST /incidents`, `upload-photos`, `GET/PATCH`, Telegram `notifyIncident`, сокет `incident_created` |
| Staff PWA | `strings/tasks.ts`, чеклист в `TaskDetailStaff`, FAB + `IncidentReportDrawer` |
| Dashboard | `/dashboard/incidents`, `/settings/checklist-templates` (шаблоны чеклистов), сайдбар «Инциденты» |

**Дальше:** полноценный редактор шаблонов в UI, шаги инцидента по ТЗ, PDF, остальные локали `nav.incidents`, доработка `seed:staff-tasks` под шаблоны при необходимости.
