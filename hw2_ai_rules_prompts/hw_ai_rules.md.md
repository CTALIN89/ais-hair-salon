# Шаг 1. Анализ требований к проекту

## 1. Выбранный проект

**Название:** АИС «Салон-парикмахерская HAIR SALON»
**Тип:** Веб-приложение (SSR + REST API)
**Архитектура:** MVC (Model-View-Controller)

## 2. Технологический стек

| Компонент         | Технология                       |
|-------------------|----------------------------------|
| Runtime           | Node.js 18+                      |
| Web-фреймворк     | Express 4                        |
| База данных       | MySQL 8.0                        |
| Драйвер БД        | mysql2/promise                   |
| Шаблонизатор      | Pug 3                            |
| Клиентская часть  | HTML/CSS/JavaScript + jQuery 3.7 |
| Аутентификация    | express-session + bcryptjs       |
| Загрузка файлов   | multer                           |
| Тестирование      | Mocha + Chai + Supertest         |
| Язык комментариев | русский                          |
| Язык интерфейса   | русский                          |

## 3. Структура проекта

```
src/
  app.js              # bootstrap Express, middleware, роутинг, обработка ошибок
  config/             # чтение .env, mysql2 pool, withTransaction
  errors/             # доменные классы ошибок (Validation, NotFound, ...)
  middleware/
    auth.js           # requireAuth / requireRole (контроль доступа по ролям)
    upload.js         # multer-загрузка изображений (мастера/услуги)
  models/             # User, Client, Master, ServiceCategory, Service,
                      # Schedule, TimeSlot, Appointment, Report, Archive
  controllers/        # auth, home, service, master, appointment, account,
                      # admin, media
  services/           # бизнес-логика (Search_Service.js — поиск услуг)
  routes/
    index.js          # страничные маршруты (Pug)
    api.js            # REST API (JSON)
  utils/validators.js # общие валидаторы входа (ID, email, phone, ...)
  views/              # Pug-шаблоны (layout, home, auth, services, masters,
                      # appointments, account, admin, errors, partials)
public/
  css/styles.css      # стили web-клиента
  js/app.js           # клиентский jQuery + AJAX
  img/                # статические изображения (услуги, мастера)
  uploads/
    masters/          # загруженные фото мастеров
    services/         # загруженные изображения услуг
scripts/
  schema.sql          # DDL схемы БД
  migrate.js          # применение schema.sql
  migrations/         # нумерованные SQL-миграции (001_salon_enhancements.sql)
  seed.js             # демо-данные (роли, пользователи, услуги, расписания)
tests-smoke/          # Mocha-тесты, не требуют MySQL
```

## 4. Требования к стилю кода

### Общие правила
- **Строгий режим:** `'use strict';` в начале каждого файла.
- **Отступы:** 2 пробела (не табуляции).
- **Кавычки:** одинарные (`'`).
- **Точка с запятой:** обязательна.
- **Длина строки:** не более 100 символов.

### Именование
| Элемент | Стиль | Пример |
|---------|-------|--------|
| Файлы | camelCase.js | `appointmentController.js` |
| Переменные | camelCase | `masterId`, `startAt` |
| Константы | UPPER_SNAKE_CASE | `ALLOWED_TRANSITIONS` |
| Классы | PascalCase | `Appointment`, `User` |

### Комментарии
- **JSDoc** для всех экспортируемых функций.
- Описание: что делает функция, параметры (`@param`), возврат (`@returns`).
- Язык — русский.

### Структура файла модели
1. `'use strict';`
2. Импорты (pool, ошибки, валидаторы)
3. Константы
4. Helper-функции
5. Основные функции (create, findById, update, remove)
6. `module.exports = { ... }`

## 5. Архитектурные требования

### Разделение ответственности
- **Model** — работа с БД (только через `pool.query` / `withTransaction`).
- **Controller** — обработка HTTP-запросов, вызов моделей, сериализация ответов.
- **Route** — определение URL и middleware.
- **View** — Pug-шаблоны (для SSR-страниц) или JSON (для API).

### Обязательные паттерны
- **Транзакции** — для многошаговых операций (`withTransaction`).
- **Параметризованные запросы** — только `?`, не конкатенация строк.
- **Middleware авторизации** — `requireAuth`, `requireRole` для защищённых маршрутов.
- **Единый формат ошибок** — `{ error, message, details? }`.

## 6. Требования к AI-агенту

AI-агент (Cline / Cursor) должен:
1. Следовать стилю кода проекта (см. раздел 4).
2. Учитывать архитектуру MVC.
3. Не нарушать существующие соглашения (error handling, транзакции).
4. Генерировать код с JSDoc-комментариями на русском.
5. При рефакторинге не менять публичный API (экспортируемые функции).

## 7. Целевые AI-агенты

- **Cline** (VS Code extension) — основной инструмент.
- **Cursor** (IDE) — альтернативный.
- **Aider** (CLI) — для скриптовых сценариев.

Для всех этих агентов используется единый файл правил:
- `.cursorrules` (для Cursor).
- Кастомный файл правил для Cline (в настройках расширения).
- `.aider.conf.yml` для Aider (при необходимости).