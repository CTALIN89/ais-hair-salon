'use strict';

// Форматирование длительности в человекочитаемый вид «1 ч 30 мин».

/**
 * Преобразует количество минут в строку вида «1 ч 30 мин», «45 мин» или «2 ч».
 *
 * Правила вывода:
 * - меньше 60 минут → только минуты («45 мин»);
 * - кратно 60 → только часы («2 ч»);
 * - иначе → часы и минуты («1 ч 30 мин»).
 *
 * Невалидным считается всё, что не является конечным целым числом
 * (не-число, `NaN`, `Infinity`, дробные и отрицательные значения) —
 * в этом случае возвращается пустая строка.
 *
 * @param {*} minutes Количество минут.
 * @returns {string} Строка с часами и/или минутами либо пустая строка,
 *                   если значение невалидно.
 */
function formatDuration(minutes) {
  if (typeof minutes !== 'number') return '';
  if (!Number.isFinite(minutes)) return '';
  if (!Number.isInteger(minutes) || minutes < 0) return '';

  if (minutes < 60) return `${minutes} мин`;
  if (minutes % 60 === 0) return `${minutes / 60} ч`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ч ${rest} мин`;
}

module.exports = { formatDuration };
