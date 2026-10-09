'use strict';

/**
 * Unit-тесты для src/utils/validators.js. 
 */

const { expect } = require('chai');
const {
  validateEmail,
  validatePhone,
  validatePassword,
  isPositiveInt,
  isNonNegativeNumber,
  isSlotStep15,
  isIsoDate,
  normalizeString,
  requireFields,
} = require('../src/utils/validators');

describe('Validators', function () {
  describe('validateEmail', function () {
    it('принимает корректный email', function () {
      expect(validateEmail('a@b.ru')).to.equal(true);
      expect(validateEmail('user.name+tag@sub.example.com')).to.equal(true);
    });
    it('отвергает некорректные', function () {
      [null, '', 'abc', 'a@b', '@b.ru', 'a@.ru', 'a b@c.ru'].forEach((v) => {
        expect(validateEmail(v), JSON.stringify(v)).to.equal(false);
      });
    });
  });

  describe('validatePhone', function () {
    it('принимает разные форматы', function () {
      expect(validatePhone('+7 (900) 123-45-67')).to.equal(true);
      expect(validatePhone('89001234567')).to.equal(true);
    });
    it('отвергает короткие/пустые', function () {
      expect(validatePhone('')).to.equal(false);
      expect(validatePhone('12345')).to.equal(false);
    });
  });

  describe('validatePassword', function () {
    it('принимает 8+ non-whitespace', function () {
      expect(validatePassword('abcdefgh')).to.equal(true);
    });
    it('отвергает короткие и с пробелами', function () {
      expect(validatePassword('short')).to.equal(false);
      expect(validatePassword('with space')).to.equal(false);
    });
  });

  describe('isPositiveInt', function () {
    it('принимает положительные целые', function () {
      [1, 2, 100, 1e6].forEach((n) => expect(isPositiveInt(n), String(n)).to.equal(true));
    });
    it('отвергает 0, отрицательные, дробные, не-числа', function () {
      [0, -1, 1.5, '1', null, undefined, NaN, Infinity].forEach((n) => {
        expect(isPositiveInt(n), String(n)).to.equal(false);
      });
    });
  });

  describe('isNonNegativeNumber', function () {
    it('принимает 0 и положительные', function () {
      [0, 0.5, 100, 1500.25].forEach((n) => expect(isNonNegativeNumber(n), String(n)).to.equal(true));
    });
    it('отвергает отрицательные и не-числа', function () {
      [-1, -0.1, NaN, Infinity, '0', null].forEach((n) => {
        expect(isNonNegativeNumber(n), String(n)).to.equal(false);
      });
    });
  });

  describe('isSlotStep15', function () {
    it('принимает кратные 15 положительные', function () {
      [15, 30, 45, 60, 75, 90].forEach((n) => expect(isSlotStep15(n), String(n)).to.equal(true));
    });
    it('отвергает 0, отрицательные, некратные', function () {
      [0, -15, 10, 20, 31, 1.5].forEach((n) => expect(isSlotStep15(n), String(n)).to.equal(false));
    });
  });

  describe('isIsoDate', function () {
    it('принимает валидные даты', function () {
      expect(isIsoDate('2024-01-01')).to.equal(true);
      expect(isIsoDate('2024-12-31')).to.equal(true);
    });
    it('отвергает невалидные', function () {
      ['2024-02-30', '2024-13-01', '01-01-2024', 'not-a-date', '', null].forEach((v) => {
        expect(isIsoDate(v), JSON.stringify(v)).to.equal(false);
      });
    });
  });

  describe('requireFields', function () {
    it('возвращает пустой массив, если всё ок', function () {
      expect(requireFields({ a: 1, b: 'x' }, ['a', 'b'])).to.deep.equal([]);
    });
    it('возвращает список отсутствующих', function () {
      expect(requireFields({ a: 1 }, ['a', 'b', 'c'])).to.deep.equal(['b', 'c']);
      expect(requireFields({ a: 1, b: '  ' }, ['a', 'b'])).to.deep.equal(['b']);
    });
    it('устойчив к отсутствию объекта', function () {
      expect(requireFields(null, ['a'])).to.deep.equal(['a']);
      expect(requireFields(undefined, ['a', 'b'])).to.deep.equal(['a', 'b']);
    });
  });

  describe('normalizeString', function () {
    it('тримит и ограничивает длину', function () {
      expect(normalizeString('  abc  ')).to.equal('abc');
      expect(normalizeString('abcd', { maxLen: 2 })).to.equal('ab');
    });
    it('возвращает undefined для не-строк', function () {
      expect(normalizeString(123)).to.equal(undefined);
      expect(normalizeString(null)).to.equal(undefined);
      expect(normalizeString(undefined)).to.equal(undefined);
    });
  });
});
