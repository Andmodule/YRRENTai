# Мультитенантность (SaaS) и продакшен API

Кратко: модель данных, изоляция тенантов, переменные окружения, деплой и безопасность.

## Модель

- Таблица **`companies`**: организация (тенант). Первый пользователь при регистрации создаёт компанию и становится **OWNER**.
- Колонка **`companyId`** (FK → `companies`) на сущностях: пользователи (кроме **SUPERADMIN**), объекты (**properties**), задачи (**tasks**), инциденты (**incidents**), шаблоны чеклистов (**checklist_templates**).
- **SUPERADMIN**: `companyId` может быть `null`, доступ к данным платформы без привязки к одному тенанту (где это поддержано в коде).
- Изоляция **на уровне приложения** (фильтры по владельцу тенанта / `companyId`), без RLS в PostgreSQL в v1.

Миграция с дефолтным тенантом для существующих строк:  
`backend/src/database/migrations/1775600000000-companies-multitenancy.ts`  
(дефолтный UUID и имя **RentAI Demo** экспортируются из файла миграции при необходимости для скриптов).

## Регистрация и профиль

- **POST /auth/register** принимает **`companyName`** (см. `@rentai/shared` `registerSchema`). Создаётся компания + пользователь **OWNER**.
- Ответ и **`GET /users/me`** отдают **`companyId`** и **`companyName`** в профиле.
- JWT (access) содержит **`companyId`** для тенантных пользователей.

## Переменные окружения (auth / SaaS)

| Переменная | Назначение |
|------------|------------|
| `AUTH_PUBLIC_REGISTRATION_ENABLED` | `true` (по умолчанию): открытая регистрация. `false`: **POST /auth/register** → **403** (invite-only, корпоративный онбординг). |
| `AUTH_COOKIE_CROSS_SITE` | `true` в проде, если фронт и API на **разных доменах** — httpOnly cookies с `SameSite=None; Secure`. |
| `JWT_SECRET` | Минимум 16 символов; в проде — криптостойкий секрет, не из репозитория. |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Время жизни токенов (строки вида `15m`, `7d`). |
| `CORS_ORIGINS` | Список origin фронта через запятую (без пробелов или с trim в коде). |

Подробнее см. корневой и `backend/.env.example`.

## Ограничение частоты (rate limit) на auth

Чтобы снизить риск перебора паролей и спама регистраций:

- **register**: 5 запросов / минуту (на IP / стандартный контекст throttler).
- **login**: 20 / мин.
- **tma/login**: 30 / мин.
- **refresh**: 60 / мин.

Эндпоинт **POST /auth/ws-token** отдельно ограничен (см. контроллер).

## Поведение API в production

- **Swagger** (`/api/docs`) **не** поднимается при `NODE_ENV=production` (чтобы не светить схему API наружу).
- **TypeORM `synchronize`**: только в **development**; в production схема БД только через **миграции** (`pnpm migration:run` из корня монорепо или скрипт backend).

## Роли и доступ к данным

- **OWNER**: идентификатор тенанта = свой `sub` / `companyId`.
- **MANAGER** / **STAFF**: привязка к владельцу через **`employerOwnerId`**; в коде для операций «как у владельца» используется **`resolveTenantOwnerId`** или **`findOneForUser`** для объектов.
- Сервисы, завязанные на «владельца объекта», не должны использовать сырой `user.sub` как owner там, где роль **MANAGER** — см. контроллеры properties, bookings, operations, calendar, checklist-templates, chat, zodomus, ical, messaging, kb.

## Чеклист деплоя (минимум)

- [ ] `NODE_ENV=production`
- [ ] Заданы **`DATABASE_URL`**, прогнаны **миграции** (в т.ч. multitenancy).
- [ ] Сильный **`JWT_SECRET`**, заданы **`CORS_ORIGINS`**, при раздельных доменах фронта/API — **`AUTH_COOKIE_CROSS_SITE=true`** и HTTPS.
- [ ] Решено по открытой регистрации: при необходимости **`AUTH_PUBLIC_REGISTRATION_ENABLED=false`**.
- [ ] Бэкапы PostgreSQL, мониторинг 5xx/латентности, при необходимости WAF/CDN перед API.
- [ ] Внутренний доступ к **`/api/v1/metrics`** (если включён) — не из публичного интернета без защиты.

## Связанные файлы кода (ориентиры)

- Сущность компании: `backend/src/user/entities/company.entity.ts`
- Регистрация с компанией: `UserService.registerOwnerWithCompany`, `AuthService.register`
- JWT payload / cookies: `AuthService.setAuthCookiesForUser`, `jwt.strategy.ts`
- Разрешение владельца тенанта: `UserService.resolveTenantOwnerId`, `resolveCompanyId`
- Доступ к объекту по роли: `PropertyService.findOneForUser`
