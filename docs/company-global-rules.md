# Общие правила компании (Company global rules)

## Назначение

Единые **описание** и **правила** для всех объектов аренды в рамках `companyId`. Используются AI-ассистентом при ответах гостям (чат, WhatsApp, email).

## Хранение

- Таблица `companies`: `globalDescription` (text, max 5000), `globalRules` (text, max 10000), `globalQaEntries` (jsonb, до 50 пар `{ id, question, answer }`).
- **Не** копируются в `properties` и **не** дублируются в `knowledge_base_entries` при сохранении.

## API

| Метод | Путь | Роли |
|-------|------|------|
| GET | `/api/v1/company/global-rules` | OWNER, MANAGER |
| PATCH | `/api/v1/company/global-rules` | OWNER, MANAGER |

Тело PATCH: `{ globalDescription?, globalRules?, globalQaEntries? }` (пустая строка → `null`; в Q&A сохраняются только пары с заполненными вопросом и ответом).

## Приоритет при конфликте

1. **База знаний объекта** (property-specific KB) — побеждает по той же теме.
2. **Общие правила компании** — значения по умолчанию, если у объекта нет своей записи.
3. При отсутствии обоих — эскалация к персоналу (как при пустой KB).

Реализация: `buildAgentKnowledgeContext()` в `backend/src/agent/constants/agent-prompts.ts`; два блока в промпте + инструкция в `buildSystemPrompt()`.

## UI

- Список объектов: иконка настроек → `/properties/global-rules`.
- Карточка объекта, вкладка «База знаний»: ссылка на общие правила.

## Acceptance (проверка)

1. Общие: «Заезд с 15:00», в объекте KB `checkin`: «14:00» → ответ **14:00**.
2. В объекте нет Wi‑Fi, в общих есть → ответ из общих.
3. Смена общих **не** меняет записи KB объекта.
4. Новый объект без KB → AI видит общие правила.
