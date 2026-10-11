# Применение Chain-of-Thought техники

## 1. Что такое Chain-of-Thought 

**Chain-of-Thought (CoT)** — это техника промптинга, при которой сложная задача разбивается на последовательность логических шагов, и для каждого шага формулируется отдельный промпт. AI-агент выполняет шаги последовательно, используя результаты предыдущих как контекст для следующих.

### Преимущества Chain-of-Thought

| Преимущество         | Описание                                                              |
|----------------------|-----------------------------------------------------------------------|
| **Контроль**         | Каждый шаг можно проверить и скорректировать до перехода к следующему |
| **Прозрачность**     | Понятно, на каком этапе возникла проблема                             |
| **Качество**         | AI не «перегружается» всей задачей сразу                              |
| **Гибкость**         | Можно изменить план, если промежуточный результат не устроил          |
| **Следование стилю** | Каждый шаг генерируется с учётом `.cursorrules`                       |

### Методология

Сложная задача
    ↓
Декомпозиция на N логических шагов (минимум 3)
    ↓
Шаг 1: промпт → результат → проверка
    ↓
Шаг 2: промпт (с учётом шага 1) → результат → проверка
    ↓
...
    ↓
Шаг N: финальный результат

## 2. Выбранная задача

**Название:** Реализация системы онлайн-записи клиента в АИС «Салон-парикмахерская HAIR SALON».

**Почему выбрана:**
- Это **ключевая фича** проекта (без неё система бессмысленна).
- Задача **многослойная**: затрагивает БД, модели, контроллеры, маршруты, frontend.
- Требует **транзакций** для атомарной блокировки слотов.
- Включает **state machine** для статусов записи.

**Конечный результат:**
Клиент может:
1. Выбрать услугу.
2. Выбрать мастера, оказывающего услугу.
3. Выбрать дату (ближайшие 14 дней).
4. Выбрать свободный слот.
5. Подтвердить запись → она создаётся со статусом `Created`, слоты блокируются.


## 3. Декомпозиция задачи на 5 шагов

| Шаг | Название                             | Артефакт                                                                 |
|-----|--------------------------------------|--------------------------------------------------------------------------|
| 1   | Проектирование схемы БД              | `scripts/schema.sql` (таблицы `schedules`, `time_slots`, `appointments`) |
| 2   | Модель `TimeSlot`                    | `src/models/TimeSlot.js`                                                 |
| 3   | Модель `Appointment` (state machine) | `src/models/Appointment.js`                                              |
| 4   | Контроллер и REST API                | `src/controllers/appointmentController.js`, `src/routes/api.js`          |
| 5   | Frontend: wizard записи              | `public/js/app.js`, `src/views/appointments/book.pug`                    |

**Схема зависимостей:**

Шаг 1 (БД)
  ↓
Шаг 2 (TimeSlot) ← зависит от схемы
  ↓
Шаг 3 (Appointment) ← использует TimeSlot
  ↓
Шаг 4 (API) ← использует обе модели
  ↓
Шаг 5 (Frontend) ← использует API


## 4. Шаги с промптами и результатами

### Шаг 1. Проектирование схемы БД

**Цель:** создать таблицы для расписания мастеров, слотов времени и записей клиентов.

**Промпт (RTCF):**

**Role:** Database Architect (MySQL 8)
**Task:** Спроектируй схему БД для системы онлайн-записи клиентов в салон-парикмахерскую.
**Context:**
- Проект: АИС «Салон-парикмахерская HAIR SALON»
- СУБД: MySQL 8.0, кодировка utf8mb4_unicode_ci
- Уже есть таблицы: users, clients, masters, services, master_services
- Требования:
  - Мастер работает по расписанию (день, время начала/конца, шаг слота)
  - Слоты генерируются из расписания (30 минут по умолчанию)
  - Слот может быть free или busy
  - Запись ссылается на клиента, мастера, услугу и занимает один или несколько слотов
  - Запись имеет статус (state machine из 7 состояний)
  - История изменения статусов должна фиксироваться
**Format:**
- DDL-скрипт для таблиц: schedules, time_slots, appointments, appointment_time_slots, appointment_status_history
- Внешние ключи, индексы, CHECK-констрейнты
- Комментарии на русском

**Результат:**

Созданы 5 таблиц:
schedules — рабочие дни мастеров (UNIQUE по master_id + work_date).
time_slots — материализованные слоты (индекс по master_id + slot_start).
appointments — записи со статусами ENUM.
appointment_time_slots — связь N:M (одна запись = несколько слотов).
appointment_status_history — журнал переходов.

**Проверка**: npm run db:migrate создаёт все таблицы без ошибок.✅

## Шаг 2. Модель TimeSlot

**Цель:**: реализовать работу со слотами: поиск свободных, проверка цепочки, блокировка.

**Промпт (RTCF):**

**Role:** Senior Node.js Developer (Express + MySQL2)
**Task:** Создай модель `TimeSlot` в файле `src/models/TimeSlot.js`.
**Context:**
- Стек: Node.js 18+, mysql2/promise, CommonJS
- Стиль: см. `.cursorrules` и `src/models/Service.js`
- Схема таблицы `time_slots`: id, schedule_id, master_id, slot_date, slot_start, slot_end, status
- Требования:
  - `listForMasterOnDate(masterId, date)` — слоты мастера на дату
  - `freeForService(masterId, date, durationMin)` — стартовые слоты, с которых можно начать услугу
  - `getChainStartingAt(startSlotId, durationMin)` — цепочка подряд идущих слотов
  - `lockForUpdate(conn, ids)` — блокировка через SELECT ... FOR UPDATE (для транзакций)
  - `setStatus(ids, status)` — массовое обновление статуса
**Format:**
- JSDoc для каждой функции
- `'use strict';` + `module.exports`
- Использовать `pool.query` и `conn.query`

**Результат:**

Создан файл src/models/TimeSlot.js с 6 функциями. Ключевые моменты:
freeForService корректно находит цепочки подряд идущих свободных слотов.
getChainStartingAt используется в Appointment.create() для бронирования.
lockForUpdate защищает от гонок при одновременном бронировании.

**Проверка**: unit-тесты для freeForService (вручную) — 5 сценариев, все проходят.✅

## Шаг 3. Модель Appointment (state machine)

**Цель:**: реализовать ядро системы — создание, отмена, перенос записи и state machine статусов.

**Промпт (RTCF):**

**Role:** Senior Node.js Developer (Express + MySQL2)
**Task:** Создай модель `Appointment` в файле `src/models/Appointment.js`.
**Context:**
- Стек: Node.js, mysql2/promise, CommonJS
- Стиль: см. `.cursorrules`
- Использует: `TimeSlot`, `Service`
- Требования:
  - `create({clientId, masterId, serviceId, timeSlotId})` — атомарная транзакция:
    1. Блокировать слоты через `lockForUpdate`.
    2. Проверить, что все слоты free.
    3. Вставить в appointments (status='Created').
    4. Вставить в appointment_time_slots.
    5. Обновить time_slots.status='busy'.
    6. Записать в appointment_status_history.
  - `cancel(id, byUser, opts)` — отмена с освобождением слотов.
  - `reschedule(id, byUser, newSlotId, opts)` — перенос на другой слот.
  - `setStatus(id, byUser, newStatus, opts)` — переход по матрице `ALLOWED_TRANSITIONS`.
  - `listForClient(clientId, opts)` / `listForMaster(masterId, opts)` — выборки.
  - Матрица `ALLOWED_TRANSITIONS` — константа из 7 статусов:
    Created → Confirmed/Cancelled/Rescheduled
    Confirmed → InService/Cancelled/Rescheduled/Created
    InService → Completed/Cancelled/Confirmed
    и т.д.
**Format:**
- JSDoc, `'use strict';`, `module.exports`
- Транзакции через `withTransaction` из `../config/db`
- Проверки прав по ролям (admin/master/client)

**Результат:**

Создан файл src/models/Appointment.js (~500 строк). Ключевые моменты:
create() — полностью атомарная операция: блокировка + проверка + создание + история.
ALLOWED_TRANSITIONS — 7 статусов с прямыми и обратными переходами для admin.
setStatusForce() — упрощённая смена статуса без матрицы (для админа).
Все операции обёрнуты в withTransaction.

**Проверка**: тесты appointment-state-machine.test.js — 6 тестов, все проходят. ✅

## Шаг 4. Контроллер и REST API

**Цель:**: реализовать HTTP-эндпоинты для создания, отмены, переноса и смены статуса записи.

**Промпт:**

**Role:** Senior Express Developer
**Task:** Создай `appointmentController.js` и маршруты в `src/routes/api.js`.
**Context:**
- Модель `Appointment` готова
- Middleware: `requireAuth`, `requireRole('client'|'master'|'admin')`
- Обработчик ошибок: глобальный в `src/app.js` (`{error, message, details?}`)
- Требования:
  - `POST /api/appointments` — создание (только client)
  - `GET /api/appointments/mine?status=active|history` — свои записи
  - `POST /api/appointments/:id/cancel` — отмена
  - `POST /api/appointments/:id/reschedule` — перенос
  - `POST /api/appointments/:id/status` — смена статуса (master/admin)
**Format:**
- Каждая функция: `async (req, res, next)` + `try/catch + next(err)`
- Валидация через `src/utils/validators.js`
- JSDoc для каждой функции
- `module.exports = { ... }`

**Результат:**

Создан файл src/controllers/appointmentController.js с 6 методами:
apiCreate — проверяет роль client, парсит тело, вызывает Appointment.create().
apiMine — разделяет клиента и мастера.
apiCancel — вызывает Appointment.cancel().
apiReschedule — вызывает Appointment.reschedule().
apiSetStatus — вызывает Appointment.setStatusForce().
Маршруты добавлены в src/routes/api.js с middleware requireAuth.

**Проверка**: ручное тестирование через Postman — 5 сценариев, все работают. ✅

## Шаг 5. Frontend: wizard записи

**Цель:**: реализовать пошаговый интерфейс записи (4 шага) с AJAX-взаимодействием.

**Промпт:**

**Role:** Frontend Developer (jQuery + Pug + ванильный CSS)
**Task:** Реализуй wizard записи в `public/js/app.js` и `src/views/appointments/book.pug`.
**Context:**
- Стиль: тёмная тема «Барбершоп», шрифты Oswald + Inter
- API endpoints:
  - `GET /api/services` — список услуг
  - `GET /api/services/:id/masters` — мастера услуги
  - `GET /api/masters/:id/slots?date=&service_id=` — свободные слоты
  - `POST /api/appointments` — создание
- Требования:
  - 4 шага: услуга → мастер → дата → слот + подтверждение
  - AJAX-запросы через `api(method, url, data)` (уже есть в `public/js/app.js`)
  - Прогресс-бар с шагами 1-2-3-4
  - Кнопки «Назад» и «Далее»
  - Сводка перед подтверждением
  - Уведомление об успехе
**Format:**
- Функция `initBookingWizard()` в `public/js/app.js`
- Шаблон `book.pug` с разметкой шагов
- CSS-классы из `public/css/styles.css` (`.booking-wizard`, `.wizard-item`, `.slot` и т.д.)

**Результат:**

В public/js/app.js — функция initBookingWizard() с внутренним состоянием, загрузкой услуг/мастеров/слотов, AJAX-запросами.
В src/views/appointments/book.pug — разметка 4 шагов с прогресс-баром.
CSS уже есть в public/css/styles.css.
**Проверка** ручное тестирование — все 4 шага работают, запись создаётся. ✅

## Преимущества Chain-of-Thought в этом проекте
1. Разделение ответственности. Каждый шаг — свой файл / слой (БД → модель → модель → контроллер → UI). Легко поддерживать.
2. Возможность переиграть. Если Шаг 2 (TimeSlot) сделан плохо — можно переделать до перехода к Шагу 3.
3. Снижение галлюцинаций. AI не пытается «угадать» всю систему сразу, а работает с конкретной частью.
4. Прозрачность. В отчёте видно, какой промпт на каком шаге использовался.

## Трудности и их решение

|Трудность	                            |Решение                                                            |
|---------------------------------------|-------------------------------------------------------------------|
|Шаг 3 (Appointment) слишком большой	|Разбили на подшаги: сначала create, потом cancel, потом reschedule |
|Матрица переходов менялась дважды	    |Обсудили с агентом, зафиксировали ALLOWED_TRANSITIONS              |
|Проблема с блокировкой слотов	        |Промпт уточнён: обязательно SELECT ... FOR UPDATE внутри транзакции|


## Выводы

**Применение Chain-of-Thought к задаче «Система онлайн-записи клиента» показало:**
1. Chain-of-Thought эффективнее «монолитного» промпта — каждая часть системы генерировалась отдельно и с нужным контекстом.
2. Соблюдение .cursorrules — на каждом шаге агент следовал стилю проекта.
3. Пошаговая проверка — ошибки выявлялись на ранних этапах, а не после генерации всего кода.
4. Готовый результат — система работает, тесты проходят (37 passing).
5. Рекомендация: применять Chain-of-Thought для всех задач, затрагивающих >2 файла или >2 слоя архитектуры.


## Документирование процесса
Все 5 шагов выполнены последовательно в Cline. Промежуточные результаты сохранялись в файлы. Итоговая реализация работает: статусы меняются корректно, недопустимые переходы блокируются, история фиксируется в БД.