# Статус реализации TZ (staffrefill / supply)

**Обновлено:** по мере внедрения.

## Сделано

### Документация

- `TZ-staff-history-supply-logistics.md` **v1.2**: §4.3 (async LLM + optimistic UI для персонала), §5.1a (реляционные `SupplyRequestItem` + сырой `llm_payload`), уточнён §9.

### Backend

- Миграция `1776400000000-staff-interpretation-events.ts`: таблицы `staff_interpretation_events`, `supply_request_items`.
- Сущности `StaffInterpretationEventEntity`, `SupplyRequestItemEntity`.
- `StaffInterpretationService`: приём текста, для **задачи** — добавление заметки через `TasksService.addNote` (видно в карточке задачи), запись события, **асинхронная** обработка LLM через `setImmediate` (HTTP не ждёт DeepSeek).
- DeepSeek JSON + эвристика без ключа; позиции снабжения пишутся в `supply_request_items` для intent из набора RESTOCK/LOGISTICS/SUPPLY.
- `POST /api/v1/tasks/staff/interpret-text` (роль STAFF), тело: `entryPoint`, `targetType`, `targetId`, `text`.

### frontend-staff

- Хук `useStaffInterpretText`.
- Экран `StaffHistorySupplementSheet`: ввод текста, toast успеха, инвалидация кэша задач/истории инцидентов.
- В «Истории» карточка задачи и инцидента **кликабельны** (фото — отдельная кнопка с `stopPropagation`).
- На **карточке активной задачи** в списке — кнопка **микрофона**: голосовой отчёт с предвыбранной этой задачей (`StaffVoiceReportSheet` + `voicePinnedTaskUuid`); FAB по-прежнему без привязки к конкретной карточке.

### frontend-user (manager)

- Страница `/dashboard/tasks`: вкладки **Задачи** / **Снабжение и логистика** (`?panel=supply`), список из `GET /tasks/manager/supply-interpretations`, открытие связанной задачи/инцидента.
- Режим **список**: третья свёртка **«Нехватка и логистика»** (между инцидентами и группами по объектам), тот же источник данных, счётчик, строка → открытие задачи/инцидента.
- Кнопки **Принято к сведению** / **Снять с очереди** → `PATCH .../supply-interpretations/:id` с `action: acknowledge | dismiss`.
- На вкладке снабжения список **опрашивается каждые ~12 с** (пока открыт экран), чтобы подтянуть результат после retry LLM.
- Записи с **сбой LLM** (`manual_review`): бейдж и текст ошибки; те же кнопки снимают с очереди; кнопка **Повторить разбор** → `POST .../retry-llm`.

### Backend (доп.)

- `POST` bulk create задач: при заметках длиной ≥3 символов — `queueFromTaskCreate` (точка входа `task_create`).
- `GET /tasks/manager/supply-interpretations` — очередь: `pending_manager` и `manual_review` (сбой LLM), в ответе `llmError` при ошибке.
- `PATCH /tasks/manager/supply-interpretations/:eventId` — снятие с очереди: `manager_acknowledged` | `manager_dismissed` (логистические задачи не создаются); допустимо для обоих состояний очереди.
- `POST /tasks/manager/supply-interpretations/:eventId/retry-llm` — повторный асинхронный прогон LLM только для `manual_review`.
- После `POST /tasks/staff-miniapp/voice-submit`: очередь интерпретации без второй заметки — `entryPoint: voice_task_report` (комментарий + shortages → один текст для LLM).

## Не сделано / следующие этапы

1. **Маршруты водителя (Route / Stop):** целевой флоу менеджера (пул → маршрутный лист → назначение на маршрут) и водителя (picking → таймлайн остановок → drop-off, гибкий порядок точек) — см. **`TZ-driver-routes-smart-dispatch.md`**.
2. **Миграция БД:** выполнить локально/на стенде: `pnpm --dir backend migration:run` (при необходимости с рабочим `DATABASE_URL`).
3. **Manager UI (продолжение):** светофор по строкам `supply_request_items`, **создание логистических задач** после «Утвердить», пакетная диспетчеризация — по ТЗ §6 (V2 / не MVP); увязать с п.1 при реализации.
4. **Очередь BullMQ:** сейчас `setImmediate`; при высокой нагрузке вынести в Redis worker.
5. **Rate limiting** на endpoint — по желанию (Throttler).
6. **Тесты** e2e/unit — не добавлялись.
