# Редактор шаблонов чеклистов — план и процесс

## Цель

Дать менеджеру UI для создания и правки шаблонов чеклистов (автоприменение к типу задачи и при необходимости к объекту). Без UI шаблоны остаются доступны только через API.

## Архитектура

| Слой | Файлы |
|------|--------|
| Backend | `backend/src/tasks/checklist-templates.controller.ts`, `checklist.service.ts` |
| Схема формы | `frontend-user/src/components/checklist/checklist-template.schema.ts` |
| Список пунктов + DnD | `frontend-user/src/components/checklist/ChecklistItemsEditor.tsx` |
| Экран | `frontend-user/src/components/checklist/ChecklistTemplatesScreen.tsx` |
| Утилиты сохранения | `frontend-user/src/modules/checklist-templates/save-checklist-template.ts`, `form-utils.ts` |
| Страница | `frontend-user/src/app/[locale]/settings/checklist-templates/page.tsx` — URL: `/[locale]/settings/checklist-templates` |

## API (v1)

- `GET /api/v1/checklist-templates` — список
- `POST /api/v1/checklist-templates` — создание (тело: `name`, `autoApplyToType`, `propertyId`, `items[]` с `sortOrder`)
- `PATCH /api/v1/checklist-templates/:uuid` — поля шаблона
- `POST /api/v1/checklist-templates/:uuid/items` — новый пункт
- `PATCH /api/v1/checklist-templates/:uuid/items/:itemId` — правка пункта
- `DELETE /api/v1/checklist-templates/:uuid/items/:itemId` — удаление пункта (204)
- `DELETE /api/v1/checklist-templates/:uuid` — удаление шаблона

Доступ: роли `OWNER` / `MANAGER`. Шаблон привязан к `ownerId` (JWT `sub`); при указании `propertyId` проверяется принадлежность объекта владельцу.

## Типы задач

Значения совпадают с `frontend-user/src/modules/tasks/types.ts` (`TaskType`). Подписи — `checklist.templates.taskTypes.*` в `messages/*.json`.

## Сохранение (существующий шаблон)

Локальный diff → параллельные запросы (`Promise.allSettled`). При частичном сбое — toast с числом ошибок, затем `refetch` списка. Без оптимистичного UI на пунктах.

## Mobile (< md)

Список на весь экран; выбор шаблона или «новый» — `?id=<uuid>` или `?id=new` на том же пути (`/[locale]/settings/checklist-templates`). Кнопка «Назад» сбрасывает query. Редирект со старого пути `/dashboard/settings/checklist-templates` настроен в `next.config.ts`.

## i18n

Пространство имён: `checklist.templates` (`useTranslations('checklist.templates')`). Локали: ru, en (+ pl, de, es с английским текстом для шаблонов).

## Пресеты 2026 (профессиональные шаблоны)

- Данные: `frontend-user/src/modules/checklist-templates/presets/professional-presets-2026.ts` (RU/EN тексты; pl/de/es используют EN).
- При нажатии «Новый шаблон» открывается диалог выбора: выездная уборка, подготовка к заезду, промежуточная уборка, ручная задача или пустой шаблон.
- UI: `ChecklistPresetPickerDialog.tsx` — сетка карточек, акцент teal, бейдж «2026».
- После выбора пресета форма заполняется; кнопка «Создать» доступна без дополнительного редактирования; пункты по-прежнему можно перетаскивать и править.

## Порядок внедрения (выполнено)

1. Backend: PATCH шаблона, CRUD пунктов, валидация `propertyId`
2. Zod-схема и маппинг `sortOrder`
3. Страница + двухколоночный layout / mobile
4. Список, форма, `ChecklistItemsEditor` с DnD
5. Save flow + удаление + предупреждение о конфликте autoApply
6. Пресеты 2026 + диалог выбора
7. Документация

## Вне объёма (как в обсуждении)

- Дублирование шаблона, превью для staff app, импорт/экспорт, статистика использования.
