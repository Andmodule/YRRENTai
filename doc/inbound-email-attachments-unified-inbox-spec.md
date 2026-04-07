# Входящие вложения email в Unified Inbox — техническое задание (v1)

Документ описывает **контракт, бэкенд и фронтенд** для отображения вложений входящей почты (Resend → R2) в интерфейсе RentAI PMS. Соответствует текущей архитектуре монорепозитория и практикам **2026** (типобезопасность, tenant isolation, a11y, i18n, наблюдаемость).

**Связанные части системы (уже есть):**

| Компонент | Назначение |
|-----------|------------|
| `POST /api/v1/webhooks/resend` | Приём входящего письма, сохранение `messaging_messages`, загрузка файлов в **Cloudflare R2**, строки в `messaging_attachments` |
| Таблица `messaging_attachments` | Метаданные + `storage_key` (приватный R2); скачивание через presigned URL |
| `GET /api/v1/messages/attachments/:id/download` | JWT + tenant check → редирект на временный presigned GET |
| `GET /api/v1/messages/threads`, `GET /api/v1/messages/threads/:threadId` | REST для списка тредов и деталей переписки (JWT, tenant через `UserService.resolveTenantOwnerId`) |

**Этот документ закрывает пробел:** API и UI **отдают и показывают** вложения вместе с сообщениями.

---

## 1. Цели и не-цели

### 1.1 Цели (v1)

- Пользователь (владелец/менеджер тенанта) в **Unified Inbox** видит у входящего сообщения гостя список вложений: имя, тип, размер, действие «открыть».
- Данные приходят с **одного** авторизованного запроса к уже существующему эндпоинту треда — **без** отдельного публичного «списка файлов» без авторизации.
- Ссылка в UI ведёт на **защищённый эндпоинт** Nest (`/messages/attachments/:id/download`); после проверки JWT и владения тредом браузер получает **редирект на временный presigned URL** к R2 (прямой трафик к CDN после обхода API).

### 1.2 Не-цели (v1)

- Загрузка вложений с UI, удаление, переименование.
- Превью PDF/изображений inline в чате (можно заложить расширяемость в компоненте).
- Синхронизация вложений с `chat_messages` / отдельная сущность в чате — только отображение по **email-мосту** (`messaging_*`).

---

## 2. Архитектура (RentAI)

### 2.1 Поток данных

```
Resend (webhook + Attachments API) → Nest (buffers) → R2 (PutObject) → Neon (messaging_attachments)
                                                                              ↓
                                                                    GET /messages/threads/:id
                                                                              ↓
                                                                    Next.js (Unified Inbox UI)
```

### 2.2 Границы ответственности

| Слой | Ответственность |
|------|-----------------|
| **NestJS** `MessagingRestController` | Проверка владения тредом (`ownerId`), сериализация DTO, при необходимости `relations` / join |
| **TypeORM** | Связь `MessagingMessageEntity` ↔ `MessagingAttachmentEntity`, каскад при удалении сообщения уже задан на стороне вложения |
| **R2** | Приватный бакет; доступ только через presigned URL, выдаваемый `StorageService` |
| **Next.js `frontend-user`** | Типы, форматирование размера, чипы, i18n, доступность |

### 2.3 Где лежит код (ориентиры)

| Область | Путь в репозитории |
|---------|---------------------|
| Сущность вложения | `backend/src/messaging/entities/messaging_attachments.entity.ts` |
| Сущность сообщения | `backend/src/messaging/entities/messaging-message.entity.ts` (нужна обратная связь `OneToMany` → `attachments`) |
| Сервис треда | `backend/src/messaging/messaging.service.ts` (`getThreadWithMessages`) |
| REST | `backend/src/messaging/messaging.controller.ts` — `MessagingRestController`, префикс приложения `api/v1` (`backend/src/main.ts`) |
| UI инбокса | `frontend-user/src/components/inbox/` (список, окно переписки — точка интеграции по факту верстки v1) |
| Утилиты | `frontend-user/src/lib/` (например `lib/utils/format-bytes.ts`) |
| Локализация | `frontend-user` — ключи `next-intl` (например пространство `inbox.*`) |

Имена файлов компонентов можно уточнить при реализации (например `InboundAttachmentChip.tsx` рядом с тем компонентом, который рендерит сообщения email-треда).

---

## 3. Контракт API

### 3.1 Эндпоинт

- **Метод:** `GET`
- **Путь:** `/api/v1/messages/threads/:threadId`
- **Авторизация:** `Authorization: Bearer <JWT>` (как сейчас)
- **Семантика:** ответ расширяется: у каждого элемента `messages[]` опционально поле `attachments`.

### 3.2 JSON: типы (camelCase в ответе)

Имена полей в **HTTP JSON — camelCase** (согласовано с Nest/клиентом и типичным фронтом 2026).

```typescript
/** Ответ фрагмент: один элемент messages[] */
interface MessagingMessageDto {
  id: string;
  threadId: string;
  role: 'guest' | 'ai_draft' | 'sent';
  text: string;
  agentText: string | null;
  rawEmailId: string | null;
  sentAt: string | null; // ISO 8601
  createdAt: string;
  attachments: MessagingAttachmentDto[];
}

interface MessagingAttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}
```

**Скачивание:** клиент строит ссылку `GET /api/v1/messages/attachments/{id}/download` (same-origin + cookies). Публичный `storageKey` в API **не отдаётся**.

### 3.3 Правила наполнения

- Вложения только у сообщений, для которых в БД есть строки в `messaging_attachments`.
- Пустой массив `attachments: []` — предпочтительнее, чем отсутствие поля (упрощает типы на фронте); допустимо и `undefined` при сериализации, но тогда фронт обязан нормализовать в `[]`.

### 3.4 Производительность

- Один запрос к БД на загрузку треда с сообщениями и вложениями: `leftJoinAndSelect` / `relations: ['attachments']` **или** эквивалент без N+1.
- Индекс `idx_messaging_attachments_message` уже есть — использовать при join по `message_id`.

### 3.5 OpenAPI

- Обновить `@ApiProperty` / DTO / Swagger-схемы для `MessagingRestController`, чтобы контракт был задокументирован в Swagger UI (как принято в проекте для публичных эндпоинтов).

---

## 4. Бэкенд: задачи реализации

1. **Связь ORM:** на `MessagingMessageEntity` добавить `@OneToMany(() => MessagingAttachmentEntity, (a) => a.message)` (имя свойства `attachments`), на `MessagingAttachmentEntity` при необходимости уточнить `inverse` side (если TypeORM потребует).
2. **`getThreadWithMessages`:** включить загрузку `attachments` для каждого сообщения (или явный QueryBuilder с join).
3. **Маппинг в DTO:** сущность → DTO; поля `file_name`, размер, MIME; без публичного URL.
4. **Безопасность:** убедиться, что по-прежнему вызывается `assertThreadOwnedBy` / эквивалентная проверка `ownerId` до отдачи данных (уже есть для треда).
5. **Тесты (желательно):** unit или e2e: тред с двумя сообщениями и вложениями только у guest-сообщения — в JSON присутствуют ожидаемые поля.

---

## 5. Фронтенд: задачи реализации

### 5.1 Типы

- Общий модуль типов (например `frontend-user/src/types/messaging.ts` или рядом с хуком загрузки треда): `MessagingAttachmentDto` / `EmailAttachment` — синхронизировать с §3.2.

### 5.2 Загрузка данных

- Использовать существующий HTTP-клиент (axios/fetch wrapper), базовый URL API и JWT — как у остальных защищённых запросов.
- После получения ответа — типизировать `messages` с `attachments`.

### 5.3 Утилита `formatBytes`

- Реализовать по образцу из продуктовых ТЗ: KB/MB/GB, защита от `0` и отрицательных значений.
- Покрыть граничные случаи (0, 1023, очень большие числа).

### 5.4 Компонент чипа вложения

- **Клиентский компонент** (`'use client'`), если используются обработчики/иконки с состоянием.
- Иконка по `contentType` (PDF, image/*, fallback `File`).
- Ссылка: `<a href={publicUrl} target="_blank" rel="noopener noreferrer">` — см. [HTML living standard / безопасные ссылки](https://html.spec.whatwg.org/).
- `title` с полным именем файла при `truncate`.
- Семантика: ссылка должна иметь **доступное имя** (текст или `aria-label` с именем файла и размером).

### 5.5 Встраивание в Unified Inbox

- Блок «Вложения» **после** основного текста сообщения гостя (и после безопасного рендера HTML, если он есть).
- Условный рендер: `attachments?.length > 0`.
- Визуальная иерархия: лёгкая граница сверху (`border-t`), подпись секции, `flex-wrap` для чипов.

### 5.6 i18n

- Все пользовательские строки (заголовок секции, «Вложения», счётчик, при необходимости aria) — через **next-intl**, ключи в неймспейсе инбокса (например `inbox.attachments.*`), без хардкода в компонентах (кроме dev-only).

### 5.7 Состояния

- Загрузка треда: скелетон или существующий паттерн списка сообщений.
- Ошибка API: существующий error boundary / toast — не ломать страницу целиком.

---

## 6. Безопасность и соответствие 2026

| Тема | Требование v1 |
|------|----------------|
| **Tenant isolation** | Только владелец треда получает вложения; проверка на уровне сервиса до маппинга в DTO. |
| **Публичные URL** | `publicUrl` предполагает публичный бакет или публичный R2.dev — осознанный риск утечки по URL. Для чувствительных данных в будущем: отдельная задача на **presigned GET** или прокси с авторизацией. |
| **XSS** | Текст письма по-прежнему через санитайзер (например DOMPurify), вложения — только ссылки, без `dangerouslySetInnerHTML` для URL. |
| **Mixed content** | `publicUrl` только `https:`. |
| **Логи** | Не логировать полные URL с секретами (в R2 их обычно нет); не логировать содержимое файлов. |

---

## 7. Наблюдаемость (опционально v1)

- Метрика/лог: число вложений на ответ `GET threads/:id` (для диагностики «не приехали вложения»).
- При ошибке join в БД — явный лог с `threadId` (без PII).

---

## 8. Критерии приёмки

1. Для тестового письма с вложениями, обработанного пайплайном Resend→R2, в UI отображаются все вложения с корректным размером и открывающейся ссылкой.
2. Сообщения без вложений не показывают блок вложений.
3. Другой тенант / неверный JWT не получает чужой тред (существующее поведение сохраняется).
4. Типы TypeScript на фронте согласованы с ответом API.
5. Локализация: язык интерфейса меняется без правок компонента (строки из словарей).

---

## 9. Вне scope / backlog

- Inline preview изображений, virus scan, лимиты размера на UI.
- Дублирование вложений в модели `chat_messages` для не-email каналов.
- Админ-приложение `admin/` — только если там появится отдельный экран email-тредов; на v1 ориентир **`frontend-user`**.

---

## 10. Версионирование документа

| Версия | Дата | Изменения |
|--------|------|-----------|
| 1.0 | 2026-04-07 | Первоначальная спека под текущую архитектуру RentAI |
