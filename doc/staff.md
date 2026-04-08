# RentAI — Staff App (frontend-staff)

## Архитектура

Полностью отдельное приложение Next.js для персонала (горничные, администраторы).
Никак не связано с `frontend-user` кодом — разные сессии, разные порты, разные роли.

| Параметр | Manager (frontend-user) | Staff (frontend-staff) |
|---|---|---|
| Порт dev | **3012** | **3013** |
| Стартовая страница | `/ru/login` → `/ru/dashboard` | `/login` → `/tasks` |
| Роль в JWT | `OWNER` / `MANAGER` | `STAFF` |
| Главный экран | Kanban-доска задач | Чеклист на сегодня |
| i18n | next-intl (ru/en/pl/es/de) | нет (русский, легко добавить) |

Визуально **Staff** отделён от менеджерского кабинета: палитра **teal / slate**, mesh-фон (`.staff-app-bg`), стеклянная шапка, карточки `.staff-card`, дата смены по-русски (`date-fns` + `ru`), отдельные пустые состояния («нет задач» vs «все выполнены»).

### Стили (Tailwind)

В `frontend-staff` нужны **`postcss.config.mjs`** (как в `frontend-user`) и директива **`@source`** в `src/app/globals.css`, иначе PostCSS/Tailwind может не обработать классы — страница выглядит «как чистый HTML» без оформления.

### Socket.IO и `manifest.json`

- **Socket.IO** подключается к **`NEXT_PUBLIC_API_URL`** (например `http://localhost:3010`), а не к origin страницы: через Next.js rewrites путь `/api/socket.io` на порту staff часто даёт **404** (polling/upgrade не проксируются как обычный HTTP).
- В **`public/manifest.json`** лежит минимальный манифест, чтобы ссылка из `layout` не отдавала 404.

---

## Запуск

```bash
# Все сервисы одновременно (три терминала):
pnpm dev:backend   # порт 3010
pnpm dev:frontend  # порт 3012 — менеджер
pnpm dev:staff     # порт 3013 — персонал
```

**Демо-задачи для интерфейса** (нужен пользователь `cleaner@test.com` с ролью `STAFF` и хотя бы один объект в БД):

```bash
cd backend && pnpm run seed:staff-tasks
# другой email: STAFF_EMAIL=other@mail.com pnpm run seed:staff-tasks
```

Повторный запуск удаляет старые задачи с меткой `[seed-staff-tasks]` у этого исполнителя и создаёт новый набор на **сегодня**.

### Миграции PostgreSQL (backend)

Переменная `DATABASE_URL` берётся из корневого `.env` (см. `backend/src/database/data-source.ts`). После `git pull` с новыми миграциями:

```bash
cd backend
pnpm run migration:run
```

Откат одной последней миграции: `pnpm run migration:revert`.

**PowerShell (Windows):** в одной строке `cd` и команда — через `;`, не через `&&` (в старых версиях PowerShell `&&` не работает):

```powershell
Set-Location D:\path\to\RentAI\backend; pnpm run migration:run
```

Если в dev включён `synchronize: true` у TypeORM, схема могла подтянуться без `migration:run`; для staging/production миграции обязательны.

### Сборка `frontend-user` и ошибка PostCSS / `EINVAL`

Проверка типов без CSS: `pnpm exec tsc --noEmit` из каталога `frontend-user`.

Если `next build` падает внутри `@tailwindcss/postcss` / worker с **`EINVAL`** (часто Windows + длинные пути или воркеры):

1. Запуск из короткого пути (например `D:\RentAI`, не глубокая вложенность).
2. Повторить сборку: иногда это единичный сбой воркера.
3. Обновить Node до текущей LTS и пересобрать: `pnpm install` в корне монорепо.
4. В крайнем случае — сборка в WSL2 с тем же репозиторием.

На этой машине после применения миграции `pnpm run build` в `frontend-user` завершился успешно.

### `frontend-staff`: 500 на `/tasks`, `Cannot find module './482.js'` (или похожий chunk)

Это рассинхрон кэша **`.next`** (после прерванной сборки, смены ветки или копирования проекта). Остановите dev-сервер, удалите каталог и запустите снова:

```powershell
Remove-Item -Recurse -Force D:\path\to\RentAI\frontend-staff\.next
pnpm dev:staff
```

Либо один раз `pnpm run build` в `frontend-staff` — пересоберёт артефакты.

---

## Структура `frontend-staff/`

```
frontend-staff/
├── src/
│   ├── app/
│   │   ├── layout.tsx          ← root layout (Providers, Toaster)
│   │   ├── page.tsx            ← redirect /tasks
│   │   ├── login/page.tsx      ← форма входа (STAFF only)
│   │   └── tasks/page.tsx      ← защищённый чеклист
│   ├── components/
│   │   ├── providers.tsx       ← QueryClientProvider
│   │   ├── auth/
│   │   │   └── login-form.tsx
│   │   ├── tasks/
│   │   │   ├── checklist.tsx              ← смена, маршрут, профиль, онлайн, сокет
│   │   │   ├── checklist-item.tsx         ← дедлайн (teal/amber/red только при просрочке), таймер in_progress
│   │   │   ├── task-detail-staff.tsx      ← заметки staff→manager, детали
│   │   │   ├── task-quick-actions-drawer.tsx ← тап по строке: Начать / Готово / Проблема
│   │   │   ├── photo-verification-drawer.tsx ← фото после «готово» (hasVerificationPhoto)
│   │   │   ├── progress-bar.tsx
│   │   │   └── issue-drawer.tsx           ← проблема + фото
│   │   └── ui/                 ← локальные UI-компоненты
│   ├── hooks/
│   │   ├── use-auth.ts         ← SWR, ключ 'staff-auth/me'
│   │   ├── use-tasks.ts        ← задачи, заметки, завершение смены
│   │   └── use-tasks-socket.ts ← Socket.IO /tasks (toast + вибрация на новые задачи)
│   └── lib/
│       ├── api/client.ts       ← axios, baseURL '/api/v1'
│       ├── compress-image.ts   ← canvas-сжатие фото
│       ├── shift-utils.ts      ← дедлайн, окончание смены, elapsed
│       └── utils.ts            ← cn()
```

---

## Auth-поток персонала

**Браузер (PWA / десктоп):**

1. Открыть `http://localhost:3013` → `/login`
2. Email + пароль аккаунта с ролью `STAFF` → `POST /api/v1/auth/login` (httpOnly cookies на `:3013`)
3. Если роль не `STAFF` — logout и сообщение «только для персонала»
4. Успех → `/tasks`

**Telegram Mini App (основной сценарий для персонала):**

1. В BotFather / `.env` указать `TELEGRAM_STAFF_MINI_APP_URL` на **HTTPS-оригин** деплоя `frontend-staff` (не путь `/ru/tma/...` из `frontend-user`).
2. Пользователь открывает Web App из бота (приглашение `/start=…` привязывает `telegramChatId`).
3. `frontend-staff` загружает `telegram-web-app.js`, читает `initData` → `POST /api/v1/auth/tma/login` — те же cookies, что и в старом TMA.
4. Успех → `/tasks` (чеклист).

**Сессии изолированы:** cookies привязаны к источнику (`localhost:3012` vs `localhost:3013` — разные origins, разные cookie-jar в браузере).

---

## Backend — изменения

### Новая роль `STAFF`
- `packages/shared/src/constants/roles.ts` — добавлен `STAFF`
- `CORS_ORIGINS` обновлён: `localhost:3012,localhost:3013` (и `http://localhost:3013` в полном виде в `.env` backend). Запросы Staff к API идут через same-origin `/api` (Next Route Handler `app/api/[[...path]]` → Nest), cookies остаются на `:3013`.

### `TasksController`
- `GET /tasks`, `PATCH /tasks/:uuid`, `POST /tasks/:uuid/photos` — разрешены для `STAFF`
- Если роль `STAFF` → `findForStaff(userId)` вместо `findForUser(userId)` (фильтр по `assigneeId`)
- STAFF не может переназначать задачи (`assigneeId` patch игнорируется)
- STAFF может обновлять статус / фото только своих задач (enforced в `ensureTaskAccess`)

### `TasksService`
- `findForStaff(userId, from, to)` — задачи где `t.assigneeId = userId`
- `ensureTaskAccess(taskId, userId, role)` — STAFF проверяет `assigneeId`, OWNER/MANAGER проверяет `property.ownerId`
- В DTO: `streetAddress` (одна строка), `hasVerificationPhoto`, `inProgressStartedAt`, `lastManagerSeenAt`, `unseenNotesCount`
- `hasVerificationPhoto` выставляется только при загрузке фото, если статус задачи уже `done`
- Заметки: таблица `task_notes` (staff → manager); `PATCH /tasks/:uuid/seen` обновляет `lastManagerSeenAt` у задачи
- Сокет `task_note_added` для обновления UI менеджера

### Дополнительные эндпоинты (v1.2)
- `GET /tasks/:uuid/notes`, `POST /tasks/:uuid/notes` (multipart: `text`, опционально `photo`) — STAFF
- `PATCH /tasks/:uuid/seen` — OWNER/MANAGER
- `POST /users/me/shift-complete` — STAFF (`users.staffShiftCompletedAt`)

---

## Создание STAFF-пользователя (dev)

Отдельной страницы регистрации в `frontend-staff` нет: регистрация идёт через тот же API, что и у менеджера (`POST /api/v1/auth/register`). Дальше роль меняется вручную в БД.

### Шаг 1 — зарегистрировать аккаунт (любой из способов)

**Вариант A — через UI менеджера (проще всего)**  
1. Запустите `pnpm dev:frontend` (порт **3012**).  
2. Откройте `http://localhost:3012/ru/register`.  
3. Зарегистрируйте пользователя с email, например `cleaner@test.com`, и паролем (минимум 8 символов).  
4. Запомните пароль — он же для входа на `http://localhost:3013/login`.

**Вариант B — напрямую в API (curl)**  
Бэкенд должен быть запущен (`pnpm dev:backend`, порт **3010**).

```bash
curl -X POST http://localhost:3010/api/v1/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"cleaner@test.com\",\"password\":\"YourPass123\",\"firstName\":\"Мария\",\"lastName\":\"Иванова\"}"
```

**PowerShell (Windows):**

```powershell
Invoke-RestMethod -Uri "http://localhost:3010/api/v1/auth/register" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"cleaner@test.com","password":"YourPass123","firstName":"Мария","lastName":"Иванова"}'
```

Если email уже занят — ответ будет ошибка «уже зарегистрирован»: либо войдите с тем паролем, который задали при регистрации, либо используйте другой email.

### Шаг 2 — выставить роль `STAFF` в БД

Подключитесь к той же PostgreSQL, что указана в `DATABASE_URL` (например, консоль **Neon** → SQL Editor).

Колонка `role` в БД имеет тип **PostgreSQL enum** (часто `users_role_enum`). Значение `STAFF` должно сначала **существовать в этом enum**, иначе будет ошибка:

`invalid input value for enum users_role_enum: "STAFF"`.

**Сначала** (один раз на базу) добавьте значение в enum:

```sql
ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'STAFF';
```

**Затем** обновите пользователя:

```sql
UPDATE users SET role = 'STAFF' WHERE email = 'cleaner@test.com';
```

Проверка:

```sql
SELECT id, email, role FROM users WHERE email = 'cleaner@test.com';
```

Если имя типа другое, посмотрите его в схеме: `\d users` в psql или в Neon — тип колонки `role`.

### Шаг 3 — вход в staff-приложение

1. `pnpm dev:staff` (порт **3013**).  
2. `http://localhost:3013/login` — email и **тот же пароль**, что при регистрации.  
3. Если снова «Неверный email или пароль» — пользователь не создан, пароль другой, или роль ещё не `STAFF` (проверьте SQL).

### Назначение задач

Менеджер в Kanban назначает исполнителя (`assigneeId` = `id` пользователя staff) или через `PATCH /api/v1/tasks/:uuid` с `{ "assigneeId": "<uuid-staff>" }`.

---

## Реализовано ✅

- [x] `frontend-staff/` — отдельное Next.js 15 приложение (порт 3013)
- [x] Собственная страница входа с проверкой роли `STAFF`
- [x] Чеклист задач на сегодня (TanStack Query)
- [x] Swipe-жесты (touch) + клавиатура (Space = done, Shift+Space = issue)
- [x] Drawer для сообщения о проблеме (текст + фото с камеры)
- [x] Сжатие изображений на клиенте перед загрузкой
- [x] Socket.IO — инвалидация кэша при обновлении задачи; toast + вибрация на **новые** задачи (§9)
- [x] Роль `STAFF` в shared, backend, CORS
- [x] `frontend-user` — Kanban без staff-маршрутов; карточки: verified + непрочитанные заметки; drawer с заметками и `seen`
- [x] v1.2: дедлайн по цвету (teal / amber / red) **только при просрочке**; таймер для `in_progress`; адрес одной строкой (`streetAddress`)
- [x] v1.2: фото после выполнения (`PhotoVerificationDrawer`); завершение смены; индикатор «онлайн» (offline P3 — только бейдж в v1)
- [x] v1.2: заметки staff → manager (`task_notes`, счётчик непрочитанного, `PATCH .../seen`)

---

## Предстоит 🔮

- [ ] UI создания STAFF-пользователей менеджером (invite flow)
- [ ] Нотификации (FCM/Web Push) о новых задачах
- [ ] Полноценный offline (Service Worker + IndexedDB) — сейчас только индикатор сети
- [ ] Переключение языка (добавить next-intl в staff)
- [ ] История выполненных задач (архив)
- [ ] Двусторонний чат с менеджером (сейчас только заметки от персонала)

---

## Roadmap / глобальные пробелы

Подробный разбор по категориям (инвентарь, чеклисты в задаче, инспекция, смены, коммуникация, маршрут, статистика, инциденты, i18n) и таблица приоритетов: **[staff-roadmap.md](./staff-roadmap.md)**.

**Реализация P1 (чеклисты + инциденты):** спека, RBAC, a11y DoD, этапы — **[staff-checklists-incidents-spec.md](./staff-checklists-incidents-spec.md)**.
