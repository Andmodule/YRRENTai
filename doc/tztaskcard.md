# ТЗ: единый Detail Drawer для Task и Incident (Manager Dashboard / TMA)

**Роли:** Principal UX/UI Designer & Frontend Architect.  
**Цель:** унифицировать визуальную подачу `TaskEntity` и `IncidentEntity` в одном компоненте с общим layout (Header, Body, Sticky Action Bar). Сейчас UI фрагментирован (`TaskDetailDrawer`, `IncidentDetailDrawer` и т.д.).

**Принцип:** один shell (`ResponsiveModal`: Drawer на mobile/TMA, Dialog/Sheet на desktop), внутри — условный контент по `mode`. Оба сценария сохраняют **одинаковую** иерархию и нижнюю панель действий.

---

## 0. Доменная модель (важно для разработки)

| Сущность | Что это |
|----------|---------|
| **Task** | Обычная задача; статусы включают `pending`, `in_progress`, `done`, **`issue`**. |
| **Task со статусом `issue`** | Отчёт о проблеме **в контексте задачи**; показывается блок с `issueDescription`. Это **не** замена `IncidentEntity`. |
| **Incident** | Отдельная сущность (инцидент гостя/объекта): тип `damage` / `lost_item`, свои статусы `open` / `in_review` / `resolved` / `closed`, связь с задачей через `taskId` / `dispatchedTaskId`. |

Дублирования контента при открытии и задачи, и инцидента по одному событию в ТЗ не требуется — но при реализации не смешивать: **issue-task** и **incident** отображаются разными `mode`, согласно таблицам ниже.

---

## 1. Архитектура компонента и пропсы

- **Файл:** новый `SharedDetailDrawer.tsx` (или рефакторинг `TaskDetailDrawer.tsx` с обобщением) + по необходимости тонкая обёртка; **удалить дублирование** с текущим `IncidentDetailDrawer` после переноса логики.
- **Обёртка:** существующий `ResponsiveModal` + `ResponsiveModalContent` с пропом **`footer`** для sticky action bar.
- **Режим:** `mode: 'task' | 'incident'`.
- **Данные:** либо `task: Task` + `incident` отсутствует, либо `incident: Incident` + `task` отсутствует (discriminated union в TypeScript).
- **Флаги:** `isManagerView: boolean`, `isStaffView: boolean` (или один производный от роли) — согласовать с текущими хуками авторизации.
- **Открытие/закрытие:** `open`, `onOpenChange` как сейчас.

---

## 2. Шапка и бейджи (sticky top)

### 2.1 STRICT HEADER FALLBACK CHAIN (`mode === 'task'`)

При выборе **главного sticky-заголовка** drawer использовать **строго** такой порядок (без перестановок):

1. **`propertyTitle`** (например «Апартаменты на Арбате»), если не `null` и не пустая строка после `trim`.
2. Иначе **`propertyAddress`** (например «ул. Ленина, 15»), если не пусто.
3. Иначе (в т.ч. **General Task** без объекта) — **локализованная метка типа задачи** по полю `task.type` (в коде: переводы по ключу типа; в ТЗ условно «`typeLabel`») **или** фиксированная строка **«Общая задача»** (через i18n).

**Важно:** текст самой задачи (**`task.title`**, напр. «Починить кран») **не** использовать как основной sticky-заголовок. Его показывать **заметно в теле** drawer (см. §3.2), чтобы шапка оставалась привязкой к объекту/контексту, а не к формулировке работы.

Для **`mode === 'incident'`** заголовок по-прежнему из контекста объекта: `propertyTitle` с fallback на адрес по аналогии; зафиксировать в реализации единообразно с задачами (без `task.title`).

### 2.2 Подзаголовок / ряд бейджей

**`mode === 'task'`**

- Бейдж типа задачи (`TaskTypeBadge` / аналог).
- Бейдж статуса задачи (`TaskStatusBadge` / аналог).
- Текст даты: **`Due:`** `dueDate` + при наличии `dueTime` (формат как в приложении, локаль из i18n).

**`mode === 'incident'`**

- Бейдж типа инцидента: `type === 'damage'` → «Повреждение» (красный/акцент); иначе «Забытая вещь» (amber).
- Бейдж статуса инцидента (локализованные подписи как в `tasks.kanban.incidentCard` или отдельный namespace).
- Текст: **`Reported:`** `createdAt` (дата+время, локаль).

### Закрытие

- Кнопка закрытия и при необходимости handle для drawer — по паттерну текущего `ResponsiveModal` / `DialogContent`.

---

## 3. Тело (scrollable)

### 3.1 `mode === 'incident'`

1. **Репортёр:** имя сотрудника — поле **`reporterName`** (строка с бэкенда). Id при необходимости: **`reportedBy`**.

2. **Описание:** `description` в заметной карточке (soft red/amber tint) — согласовать с токенами.

3. **Контекст бронирования / гостя (без новых fetch):** карточка (`bg-surface-2`, `rounded-xl`), если есть **`guestName`** или **`reservationId`** или контекст last stay. Поля: `guestName`, `reservationId` (тип на фронте дополнить), `lastStayGuestName`, `lastStayGuestPhone`, **`lastStayCheckOut`**.

4. **Только менеджер (`isManagerView`):** `managerNote` (textarea), `estimatedCost` (строка в API, PATCH как в `usePatchIncident`).

5. Фото: `photoUrls`.

---

### 3.2 `mode === 'task'`

1. **Название задачи:** **`task.title`** — отдельный блок в верхней части тела (крупнее второстепенного текста), т.к. не дублируется в sticky header (см. §2.1).

2. **Предупреждение issue (если `task.status === 'issue'`):** блок алерта с **`issueDescription`**; это не `IncidentEntity`.

3. Чеклист, verification photos, **`notes`** (textarea, auto-save on blur).

4. Контекст бронирования — если уже есть в продукте, не удалять; новый fetch не вводить без отдельного ТЗ.

---

## 4. Auto-save (без кнопок «Сохранить»)

| Поле | Мутация |
|------|---------|
| Task `notes` | **`useUpdateTaskNotes`** / **`usePatchTask`** — **не** `useUpdateTaskStatus`. |
| Incident поля | **`usePatchIncident`**. |
| Статус задачи с кнопок footer | **`useUpdateTaskStatus`**. |

Ошибка: destructive toast; **не** откатывать текст в поле автоматически.

---

## 5. Sticky Action Bar (footer)

- **`footer`** у `ResponsiveModalContent`; mobile: **`pb-safe`**.

### 5.1 `mode === 'task'`

**Staff (`isStaffView`)**

| Статус | Действия |
|--------|----------|
| `pending` | **«Взять в работу»** → `in_progress`. |
| `in_progress` | **«Завершить»** → `done`; **«Сообщить о проблеме»** — см. **§5.3 (строго)**. |

**Manager (`isManagerView`):** «Редактировать», «Закрыть», «Удалить» — только при наличии API/прав.

### 5.2 `mode === 'incident'`

**Менеджер:** `open`/`in_review` — «Создать задачу», «Решено»; `resolved`/`closed` — «Открыть снова» → `in_review`.  
**Staff:** footer **пустой**; manager-поля скрыты.

### 5.3 STRICT: «Сообщить о проблеме» (Staff, task `in_progress`)

**Запрещено:** открывать **второй** `Drawer` или `Sheet` поверх текущего `TaskDetailDrawer` (конфликты z-index, плохой UX на mobile).

**Обязательный workflow:**

1. По нажатию **«Сообщить о проблеме»** разворачивается **inline**-секция (Accordion / Collapsible) в **конце** scrollable body текущего drawer, **сразу над** sticky footer.
2. Содержимое секции:
   - `<textarea>` **required**, **`autoFocus`**, placeholder: «Опишите проблему...» (i18n).
   - Кнопка загрузки фото (иконка камеры), в рамках текущего API загрузки к задаче.
   - Красная кнопка **«Отправить проблему»** (submit).
3. Пока секция развёрнута: кнопки sticky footer (**«Завершить»**, **«Сообщить о проблеме»**) **скрыть или заменить** на одну **«Отмена»**, которая сворачивает секцию и возвращает прежний footer (допускается короткий fade).
4. **Submit:** `PATCH /api/tasks/:id` с `status: 'issue'` и `issueDescription` (+ фото по существующему потоку, если требуется продуктом). При **успехе** — **закрыть drawer целиком** (`onOpenChange(false)`).

---

## 6. Визуал и доступность

- `var(--space-4)`, `px-4` где нужно; `shadow-sm`, `bg-surface*`.
- Клавиатура: `scroll-margin` / `scrollIntoView` — best effort.

---

## 7. Типы и API

- Расширить **`Incident`** (`reservationId`, `reportedBy`, …) в соответствии с `IncidentDto`.
- **`typeLabel`:** в типе `Task` поля нет; в UI вычислять из `task.type` + словарь переводов.

---

## 8. Критерии приёмки

- Соблюдён **fallback заголовка** §2.1; `task.title` в теле, не в header.
- Нет вложенных drawer/sheet для «Сообщить о проблеме»; работает сценарий §5.3.
- Auto-save и матрицы как выше; `pb-safe` на footer.

---

## 9. Вне scope

- Слияние Incident и Task в одну сущность.
- Новые fetch по `reservationId`, если DTO уже достаточен.

---

*Документ включает строгие продуктовые правила по заголовку и inline-issue flow, чтобы исключить неоднозначность и баги вложенных модалок.*
