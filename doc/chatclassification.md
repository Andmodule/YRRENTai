# Классификация чата и авто-диспатч задач — указатель

Документация разделена на два файла, чтобы **не смешивать** объём реализации v1 с долгосрочным roadmap.

| Документ | Назначение |
|----------|------------|
| [**chat-dispatch-spec.md**](./chat-dispatch-spec.md) | **v1 для реализации:** TypeScript-контракты, JSON Schema, `TaskType`, модуль политик (`createTask` / `escalate`), идемпотентность через **уникальный индекс** `chatMessageId`, feature flags на `Property`, emergency до LLM, пайплайн §6–§7, пути к сущностям в `backend/src/…`. |
| [**chat-dispatch-vision.md**](./chat-dispatch-vision.md) | **Vision + roadmap:** архитектура, omnichannel, eval, комплаенс, практики 2026+, второй слой (мультимодальность, DPIA, webhooks), фазы v2/v3. |

Дополнительно: [**staff.md**](./staff.md) — приложение персонала и задачи.
