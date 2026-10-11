# Библиотека промпт-шаблонов (RTCF)

## О методологии RTCF

Каждый промпт в этой библиотеке построен по структуре **RTCF**:

| Элемент         | Значение                         | Зачем нужен                           |
|-----------------|----------------------------------|---------------------------------------|
| **R** — Role    | Кем является AI в этом контексте | Задаёт экспертизу и стиль ответа      |
| **T** — Task    | Что нужно сделать                | Чёткая цель без размытых формулировок |
| **C** — Context | Какая информация нужна           | Даёт AI контекст проекта              |
| **F** — Format  | В каком виде нужен результат     | Управляет структурой ответа           |

Эта структура снижает количество итераций и повышает качество генерируемого кода.

## Шаблон 1: Генерация модели/компонента по описанию

**Role:** Senior Node.js Developer (Express + MySQL2)

**Task:** Создай <тип артефакта> в файле <путь файла>.

**Context:**
- Проект: АИС «Салон-парикмахерская HAIR SALON»
- Стек: Node.js 18+, Express 4, mysql2/promise, Pug 3
- Стиль: см. `.cursorrules` и эталонный файл <путь эталона>
- Функциональные требования: <список требований>
- Ограничения: <что нельзя делать>

**Format:**
- JSDoc-комментарий для экспортируемых функций
- `'use strict';` + `module.exports = { ... }`


### Пример использования:

**Role:** Senior Node.js Developer (Express + MySQL2)

**Task:** Создай функцию `formatPhone(phone)` в файле `src/utils/phone.js`.

**Context:**
- Проект: АИС «Салон-парикмахерская HAIR SALON»
- Стек: Node.js 18+, CommonJS
- Стиль: см. `src/utils/validators.js` (JSDoc, camelCase, комментарии на русском)
- Требования:
  - Принимать номер в любом формате: `'89001234567'`, `'+7 900 123-45-67'`, `'+79001234567'`
  - Возвращать строку в формате `'+7 (900) 123-45-67'`
  - При невалидном номере — возвращать исходное значение
- Ограничения: без внешних библиотек, только регулярные выражения

**Format:**
- JSDoc с `@param` и `@returns`
- `'use strict';` + `module.exports = { formatPhone }`
- Пример вызова для 3 валидных и 2 невалидных случаев

**Результат (пример)**

'use strict';

const NON_DIGIT_RE = /[^\d]/g;

/**
 * Нормализует номер телефона к формату «+7 (XXX) XXX-XX-XX».
 *
 * @param {string|number|null} phone — номер в любом формате
 * @returns {string|null} — нормализованный номер или исходное значение
 */
function formatPhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') {
    return phone;
  }
  const digits = String(phone).replace(NON_DIGIT_RE, '');
  const tenDigits = digits.length === 11 && (digits[0] === '7' || digits[0] === '8')
    ? digits.slice(1)
    : digits;
  if (tenDigits.length !== 10) return phone;
  return `+7 (${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6, 8)}-${tenDigits.slice(8, 10)}`;
}

module.exports = { formatPhone };


## Шаблон 2: Рефакторинг кода с улучшением

**Role:** Senior Code Reviewer (Node.js / Express)

**Task:** Отрефактори файл `<путь файла>` — улучши читаемость, устрани дублирование, приведи к стилю `.cursorrules`.

**Context:**
- Текущий код: <вставить код или указать путь>
- Проблемы:
  - <проблема 1>
  - <проблема 2>
- Ограничения:
  - Не менять публичный API (экспортируемые функции и их сигнатуры)
  - Не менять поведение (тесты должны проходить)
  - Стиль проекта — см. `.cursorrules`

**Format:**
- Краткое описание проблем (до рефакторинга)
- Полный обновлённый файл
- Diff-описание изменений
- Проверка: `npm test` должен вернуть exit 0

### Пример использования:

**Role:** Senior Code Reviewer (Node.js / Express)

**Task:** Отрефактори файл `src/models/ServiceCategory.js`.

**Context:**
- Проблемы:
  - Функции `list()` и `findById()` дублируют SQL-запрос с JOIN.
  - Нет JSDoc-комментариев.
  - Ошибки обрабатываются без `next()`.
- Ограничения: не менять сигнатуры функций

**Format:**
- Список изменений
- Полный код файла
- Diff: что убрано, что добавлено


## Шаблон 3: Написание тестов для существующего кода

**Role:** QA Engineer (Mocha + Chai + Supertest)

**Task:** Напиши unit-тесты для `<модуль/функция>` в файле `tests-smoke/<имя>.test.js`.

**Context:**
- Тестируемый код: <вставить код или путь>
- Фреймворк: Mocha + Chai (+ Supertest при необходимости)
- Стиль: см. `tests-smoke/validators.test.js`
- Обязательные сценарии:
  - Позитивные: <список>
  - Негативные: <список>
- Не подключаться к БД (mock или чистые функции)

**Format:**
- `describe` / `it` с понятными названиями на русском
- Минимум <N> тестов
- Не использовать `console.log`

### Пример использования:

**Role:** QA Engineer (Mocha + Chai)

**Task:** Напиши тесты для `formatPhone` из `src/utils/phone.js` в файле `tests-smoke/phone.test.js`.

**Context:**
- Функция нормализует номер телефона к «+7 (XXX) XXX-XX-XX»
- Стиль: как в `tests-smoke/validators.test.js`
- Обязательные сценарии:
  - Позитивные: 11 цифр (7/8), 10 цифр, разные разделители
  - Негативные: короткий/длинный номер, буквы, пустая строка, null, число

**Format:**
- `describe('formatPhone', () => { it(...) })`
- Минимум 10 тестов

**Результат (пример)**

'use strict';

const { expect } = require('chai');
const { formatPhone } = require('../src/utils/phone');

describe('formatPhone', function () {
  describe('позитивные сценарии', function () {
    it('нормализует 11-значный номер с 8', function () {
      expect(formatPhone('89001234567')).to.equal('+7 (900) 123-45-67');
    });

    it('нормализует 11-значный номер с +7', function () {
      expect(formatPhone('+79001234567')).to.equal('+7 (900) 123-45-67');
    });

    it('убирает пробелы и дефисы', function () {
      expect(formatPhone('+7 900 123-45-67')).to.equal('+7 (900) 123-45-67');
    });
  });

  describe('негативные сценарии', function () {
    it('возвращает исходное значение для короткого номера', function () {
      expect(formatPhone('12345')).to.equal('12345');
    });

    it('возвращает исходное значение для букв', function () {
      expect(formatPhone('abc')).to.equal('abc');
    });

    it('возвращает исходное значение для null', function () {
      expect(formatPhone(null)).to.equal(null);
    });
  });
});

## Шаблон 4: Исправление ошибок и багов

**Role:** Senior Debugger (Node.js / MySQL)

**Task:** Найди и исправь ошибку: `<краткое описание>`.

**Context:**
- Лог ошибки: <вставить лог из терминала или консоли браузера>
- Файлы, где может быть проблема: <список>
- Ожидаемое поведение: <что должно быть>
- Фактическое поведение: <что происходит>
- Ограничения: не менять бизнес-логику, только исправление

**Format:**
- Гипотеза причины (1-2 предложения)
- Исправленный код
- Объяснение: почему баг возник и как исправлен
- Тест, чтобы баг не повторился
- Проверка: `npm test` → exit 0

### Пример использования:

**Role:** Senior Debugger

**Task:** Найди и исправь ошибку: тесты падают с `ReferenceError: AuthError is not defined`.

**Context:**
- Лог:
  ```
  ReferenceError: AuthError is not defined
      at me (src/controllers/authController.js:234:15)
  ```
- Файл: `src/controllers/authController.js`
- Ожидаемое: `/api/auth/me` без сессии → 401 JSON
- Фактическое: 500 из-за отсутствия импорта
- Ограничения: не менять логику метода

**Format:**
- Причина: в файле отсутствует импорт `AuthError`
- Исправление: добавить `const { AuthError } = require('../errors')`
- Проверка: `npm test` → все тесты зелёные


## Шаблон 5: Декомпозиция сложной задачи на подзадачи

**Role:** Tech Lead (Node.js / Express / MySQL)

**Task:** Разбей задачу `<описание>` на подзадачи (от 5 до 10).

**Context:**
- Проект: АИС «Салон-парикмахерская HAIR SALON»
- Стек: Node.js + Express + MySQL + Pug
- Архитектура: MVC
- Ограничения: <специфика задачи>
- Уже есть: <что уже реализовано>

**Format:**
- Нумерованный список подзадач
- Для каждой: цель, файлы, оценка (S/M/L)
- Порядок выполнения с учётом зависимостей
- Схема зависимостей между подзадачами

### Пример использования:

**Role:** Tech Lead

**Task:** Разбей задачу «Реализовать систему лояльности клиентов (бонусные баллы)» на подзадачи.

**Context:**
- Проект: АИС «Салон-парикмахерская»
- Стек: Node.js + Express + MySQL + Pug
- Ограничения:
  - Нельзя менять существующие таблицы без миграции
  - Баллы начисляются после статуса Completed
  - Клиент может тратить баллы при новой записи
- Уже есть: модель Appointment, контроллер adminController, views

**Format:**
- Список из 5-8 подзадач
- Для каждой: цель, файлы, S/M/L
- Схема зависимостей

**Результат (пример)**

**Подзадачи:**
1. Спроектировать схему БД (M)
   Файлы: scripts/migrations/002_loyalty.sql, scripts/schema.sql
   Создать таблицы: loyalty_accounts, loyalty_transactions
2. Создать модель Loyalty (M)
   Файлы: src/models/Loyalty.js
   Функции: getBalance(clientId), accrue(clientId, amount), redeem(clientId, amount)
3. Интегрировать начисление баллов (S)
   Файлы: src/models/Appointment.js
   При переходе в Completed начислять баллы через Loyalty.accrue()
4. Обновить личный кабинет клиента (M)
   Файлы: src/controllers/accountController.js, src/views/account/client.pug
   Показать баланс баллов
5. Добавить списание баллов при записи (L)
   Файлы: src/controllers/appointmentController.js, src/views/appointments/book.pug
   Возможность указать количество баллов к списанию
6. Написать тесты (S)
   Файлы: tests-smoke/loyalty.test.js
   Тесты: начисление, списание, недостаток баллов
7. Обновить README.md (S)
   Добавить раздел «Система лояльности»

Схема зависимостей: 1 → 2 → 3 → 4 → 5 → 6 → 7