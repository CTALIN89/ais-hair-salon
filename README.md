# АС «Салон-парикмахерская HAIR SALON»

Автоматизированная система управления деятельностью
салона-парикмахерской реализована в соответствии с заданием и включает:
каталог услуг и категорий, профили мастеров и их расписания, 
онлайн-запись клиентов, личные кабинеты (клиент / мастер /администратор), 
отчёты по выручке и загрузке мастеров, архив записей за
отчётный период.

## Стек

- **Backend:** Node.js 18+, Express, MVC, `express-session`, `bcryptjs`,
  `mysql2/promise`.
- **Шаблоны:** Pug (server-side rendering).
- **Frontend:** HTML / CSS / JavaScript / **jQuery** (AJAX-запросы к REST API,
  возвращающему JSON).
- **БД:** MySQL 8 (DDL — `scripts/schema.sql`).
- **Тесты:** Mocha + Chai + Supertest.

## Структура проекта (MVC)

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

## Установка и запуск

### 1. Подготовка MySQL

```bash
sudo apt-get install -y mysql-server
sudo service mysql start
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS salon CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'salon'@'localhost' IDENTIFIED BY 'salonpass';
GRANT ALL PRIVILEGES ON salon.* TO 'salon'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### 2. Установка зависимостей и конфигурация

```bash
npm install
cp env.example .env    # при необходимости отредактируйте параметры подключения
```

### 3. Схема и демо-данные

```bash
npm run db:migrate      # применяет scripts/schema.sql
npm run db:seed         # добавляет роли, пользователей, услуги, расписания
```

### 4. Запуск сервера

```bash
npm start               # http://localhost:3000
# или с авто-рестартом:
npm run dev
```

### 5. Тесты

```bash
npm test                # mocha "tests-smoke/**/*.test.js"
```

## Демо-учётные записи

| Логин   | Пароль    | Роль          |
| ------- | --------- | ------------- |
| admin   | admin123  | Администратор |
| ivanov  | master123 | Мастер        |
| petrova | master123 | Мастер        |
| client1 | client123 | Клиент        |
| client2 | client123 | Клиент        |

## Страничные маршруты

Определены в [`src/routes/index.js`](src/routes/index.js). Страницы рендерятся
Pug-шаблонами и используются как контейнеры для клиентских AJAX-скриптов.

| Метод    | URL                  | Доступ  | Описание                                                   |
| -------- | -------------------- | ------- | ---------------------------------------------------------- |
| GET      | `/`                  | все     | Главная (обзор салона, CTA на запись)                      |
| GET      | `/auth/login`        | гость   | Форма входа                                                |
| POST     | `/auth/login`        | гость   | Обработка формы входа (fallback без JS)                    |
| GET      | `/auth/register`     | гость   | Форма регистрации клиента                                  |
| POST     | `/auth/register`     | гость   | Обработка регистрации (fallback)                           |
| GET/POST | `/auth/logout`       | все     | Выход и редирект на `/`                                    |
| GET      | `/services`          | все     | Каталог услуг с фильтром по категории                      |
| GET      | `/services/:id`      | все     | Детальная страница услуги                                  |
| GET      | `/masters`           | все     | Список мастеров                                            |
| GET      | `/masters/:id`       | все     | Профиль мастера и его услуги                               |
| GET      | `/appointments/new`  | client  | Wizard записи: услуга → мастер → дата → слот               |
| GET      | `/account`           | client  | Личный кабинет клиента (активные записи, история, отмена)  |
| GET      | `/account/master`    | master  | Личный кабинет мастера (расписание, смена статусов)        |
| GET      | `/admin`             | admin   | Административная панель (обзор)                            |
| GET      | `/admin/users`       | admin   | Управление учётными ролями (мастера, администраторы)       |
| GET      | `/admin/clients`     | admin   | Управление клиентами                                       |
| GET      | `/admin/masters`     | admin   | Управление мастерами (карточки, привязки к услугам)        |
| GET      | `/admin/categories`  | admin   | Управление категориями услуг                               |
| GET      | `/admin/services`    | admin   | Управление услугами и привязками мастер↔услуга             |
| GET      | `/admin/schedules`   | admin   | Расписания мастеров                                        |
| GET      | `/admin/appointments`| admin   | Все записи (фильтры, смена статусов)                       |
| GET      | `/admin/reports`     | admin   | Построение отчётов и выгрузка CSV                          |

## REST API (JSON)

Определён в [`src/routes/api.js`](src/routes/api.js). Все ответы —
`application/json`. Формат ошибок:
`{ "error": { "code": "<CODE>", "message": "..." } }`.

### Аутентификация

| Метод | URL                    | Доступ | Описание                                 |
| ----- | ---------------------- | ------ | ---------------------------------------- |
| POST  | `/api/auth/register`   | гость  | Регистрация клиента                      |
| POST  | `/api/auth/login`      | гость  | Вход (логин/пароль), создание сессии     |
| POST  | `/api/auth/logout`     | все    | Завершение сессии                        |
| GET   | `/api/auth/me`         | все    | Текущий пользователь и его роль          |

### Каталог (публичный)

| Метод | URL                                          | Описание                                |
| ----- | -------------------------------------------- | --------------------------------------- |
| GET   | `/api/services`                              | Список услуг (фильтр `?category_id=`)   |
| GET   | `/api/services/categories`                   | Справочник категорий                    |
| GET   | `/api/services/:id`                          | Одна услуга                             |
| GET   | `/api/services/:id/masters`                  | Мастера, оказывающие данную услугу      |
| GET   | `/api/masters`                               | Список активных мастеров                |
| GET   | `/api/masters/:id`                           | Профиль мастера                         |
| GET   | `/api/masters/:id/slots?date=YYYY-MM-DD`     | Свободные слоты мастера на дату         |

### Записи

| Метод | URL                                     | Доступ       | Описание                                                           |
| ----- | --------------------------------------- | ------------ | ------------------------------------------------------------------ |
| POST  | `/api/appointments`                     | client       | Создать запись `{ service_id, master_id, time_slot_id }`           |
| GET   | `/api/appointments/mine`                | client/master| Свои записи (активные + история)                                   |
| POST  | `/api/appointments/:id/cancel`          | client/admin | Отмена записи                                                      |
| POST  | `/api/appointments/:id/reschedule`      | client/admin | Перенос `{ time_slot_id }`                                         |
| POST  | `/api/appointments/:id/status`          | master/admin | Смена статуса по матрице переходов (7 статусов: `Created`, `Confirmed`, `InService`, `Rescheduled`, `Completed`, `Cancelled`, `Archived`; для `Completed` передаётся `actual_price`) |

### Админ — категории услуг

| Метод  | URL                                   | Описание              |
| ------ | ------------------------------------- | --------------------- |
| GET    | `/api/admin/service-categories`       | Список всех категорий |
| POST   | `/api/admin/service-categories`       | Создать категорию     |
| PUT    | `/api/admin/service-categories/:id`   | Обновить категорию    |
| DELETE | `/api/admin/service-categories/:id`   | Удалить категорию     |

### Админ — услуги

| Метод  | URL                         | Описание                   |
| ------ | --------------------------- | -------------------------- |
| GET    | `/api/admin/services`       | Список всех услуг          |
| POST   | `/api/admin/services`       | Создать услугу             |
| PUT    | `/api/admin/services/:id`   | Обновить услугу            |
| DELETE | `/api/admin/services/:id`   | Архивировать (деактивировать) услугу |

### Админ — мастера

| Метод  | URL                       | Описание                         |
| ------ | ------------------------- | -------------------------------- |
| GET    | `/api/admin/masters`      | Список мастеров                  |
| PUT    | `/api/admin/masters/:id`  | Обновить карточку мастера        |
| DELETE | `/api/admin/masters/:id`  | Деактивировать мастера           |

### Админ — клиенты

| Метод  | URL                         | Описание                   |
| ------ | --------------------------- | -------------------------- |
| GET    | `/api/admin/clients`        | Список клиентов            |
| PUT    | `/api/admin/clients/:id`    | Обновить карточку клиента  |
| DELETE | `/api/admin/clients/:id`    | Удалить/деактивировать клиента |

### Админ — записи

| Метод  | URL                            | Описание                                    |
| ------ | ------------------------------ | ------------------------------------------- |
| GET    | `/api/admin/appointments`      | Все записи (фильтры, поиск)                  |
| POST   | `/api/admin/appointments`      | Создать запись от имени клиента              |
| PUT    | `/api/admin/appointments/:id`  | Обновить запись                              |
| DELETE | `/api/admin/appointments/:id`  | Удалить запись                               |

### Админ — мультимедиа (изображения)

| Метод  | URL                                      | Описание                              |
| ------ | ---------------------------------------- | ------------------------------------- |
| POST   | `/api/admin/services/:id/image`          | Загрузить изображение услуги (multipart) |
| DELETE | `/api/admin/services/:id/image`          | Удалить изображение услуги            |
| POST   | `/api/admin/masters/:id/image`           | Загрузить фото мастера (multipart)    |
| DELETE | `/api/admin/masters/:id/image`           | Удалить фото мастера                  |

### Админ — привязки «мастер ↔ услуга»

| Метод  | URL                                                 | Описание                |
| ------ | --------------------------------------------------- | ----------------------- |
| POST   | `/api/admin/masters/:id/services`                   | Привязать услугу        |
| DELETE | `/api/admin/masters/:id/services/:serviceId`        | Отвязать услугу         |

### Админ — пользователи

| Метод  | URL                                    | Описание                                    |
| ------ | -------------------------------------- | ------------------------------------------- |
| GET    | `/api/admin/users`                     | Список учётных записей                      |
| POST   | `/api/admin/users`                     | Создать пользователя (мастера/администратора)|
| PUT    | `/api/admin/users/:id`                 | Обновить пользователя                       |
| DELETE | `/api/admin/users/:id`                 | Удалить пользователя                        |
| POST   | `/api/admin/users/:id/deactivate`      | Деактивировать учётную запись               |
| POST   | `/api/admin/users/:id/activate`        | Активировать учётную запись                 |
| POST   | `/api/admin/users/:id/role`            | Изменить роль пользователя                  |

### Админ — расписания

| Метод  | URL                                       | Описание                                       |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| GET    | `/api/admin/schedules`                     | Все расписания мастеров                        |
| POST   | `/api/admin/masters/:id/schedule`         | Добавить расписание мастера (дата, смена)      |
| DELETE | `/api/admin/schedule/:id`                 | Удалить расписание (если нет активных записей) |

### Админ — отчёты

| Метод | URL                                      | Описание                                                          |
| ----- | ---------------------------------------- | ----------------------------------------------------------------- |
| POST  | `/api/admin/reports`                     | Сформировать отчёт (`revenue`, `master_load`, `client_history`)   |
| GET   | `/api/admin/reports/:id`                 | Получить сохранённый отчёт (метаданные + позиции)                 |
| GET   | `/api/admin/reports/:id/export`          | Экспорт в CSV                                                     |

### Админ — архивы

| Метод | URL                              | Описание                                                        |
| ----- | -------------------------------- | --------------------------------------------------------------- |
| POST  | `/api/admin/archives`            | Создать архив за период (переносит завершённые/отменённые)      |
| GET   | `/api/admin/archives`            | Список архивов                                                  |
| GET   | `/api/admin/archives/:id`        | Подробности архива                                              |

## Тестирование

Команда `npm test` запускает Mocha по шаблону `tests-smoke/**/*.test.js`.
Smoke-тесты в `tests-smoke/` не требуют MySQL и выполняются за секунды:

- `module-loading.test.js` — `require()` всех моделей, контроллеров и
  middleware отрабатывает без ошибок.
- `validators.test.js` — покрывает `src/utils/validators.js` (ID, email,
  телефон, положительные числа).
- `appointment-state-machine.test.js` — корректность матрицы
  `Appointment.ALLOWED_TRANSITIONS`.
- `report-csv.test.js` — сериализация отчёта в CSV (экранирование
  кавычек/запятых/переводов строки).
- `api-errors.test.js` — единый формат ошибок API
  `{ error: { code, message } }`.