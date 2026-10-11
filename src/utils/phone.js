'use strict';

// Форматирование российских телефонов к единому виду «+7 (900) 123-45-67».

const NON_DIGIT_RE = /[^\d]/g;

/**
 * Приводит телефон к единому формату «+7 (XXX) XXX-XX-XX».
 *
 * Понимает наиболее частые форматы ввода: 89001234567, 79001234567,
 * 9001234567, +7 900 123-45-67, +7 (900) 123-45-67 и т.п. (разделители
 * и пробелы игнорируются). Для номеров вида 8XXXXXXXXXX / 7XXXXXXXXXX
 * используются последние 10 цифр (код страны заменяется на 7); для
 * 10-значных номеров код страны 7 добавляется.
 *
 * Если передано не строковое значение, цифры не извлекаются или длина
 * национального номера не равна 10 — возвращается исходное значение
 * без изменений (валидация на стороне вызывающего кода).
 *
 * @param {*} phone Исходный номер в любом формате.
 * @returns {*} Отформатированная строка «+7 (XXX) XXX-XX-XX» либо
 *               исходное значение без изменений, если номер невалиден.
 */
function formatPhone(phone) {
  if (typeof phone !== 'string') return phone;

  const digits = phone.replace(NON_DIGIT_RE, '');
  if (digits.length === 0) return phone;

  let national;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    // 89001234567 / 79001234567 → код страны отбрасываем.
    national = digits.slice(1);
  } else if (digits.length === 10) {
    // 9001234567 → код страны 7 добавляем.
    national = digits;
  } else {
    return phone;
  }

  const area = national.slice(0, 3);
  const mid = national.slice(3, 6);
  const low = national.slice(6, 8);
  const tail = national.slice(8, 10);
  return `+7 (${area}) ${mid}-${low}-${tail}`;
}

module.exports = { formatPhone };
