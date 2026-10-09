'use strict';

// Утилиты валидации и нормализации пользовательского ввода.
 
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d\s\-()]+$/;
const PHONE_DIGITS_RE = /[^\d]/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateEmail(value) {
  if (!isNonEmptyString(value)) return false;
  if (value.length > 128) return false;
  return EMAIL_RE.test(value);
}

function validatePhone(value) {
  if (!isNonEmptyString(value)) return false;
  if (value.length < 7 || value.length > 32) return false;
  if (!PHONE_RE.test(value)) return false;
  // Должна быть хотя бы одна цифра — просто символы "+-() " не считаются.
  const digits = value.replace(PHONE_DIGITS_RE, '');
  return digits.length > 0;
}

function validatePassword(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 8 || value.length > 128) return false;
  return !/\s/.test(value);
}

function isPositiveInt(value) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0;
}

function isSlotStep15(value) {
  return isPositiveInt(value) && value % 15 === 0;
}

function isIsoDate(value) {
  if (!isNonEmptyString(value)) return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCFullYear() === y
    && date.getUTCMonth() === m - 1
    && date.getUTCDate() === d;
}

function normalizeString(value, options = {}) {
  const { maxLen = 255 } = options;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function requireFields(obj, fields) {
  const source = obj && typeof obj === 'object' ? obj : {};
  const missing = [];
  for (const field of fields) {
    const value = source[field];
    if (value === undefined || value === null) {
      missing.push(field);
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      missing.push(field);
    }
  }
  return missing;
}

function collectErrors(schema, input) {
  const errors = {};
  const source = input && typeof input === 'object' ? input : {};
  for (const [field, validator] of Object.entries(schema || {})) {
    if (typeof validator !== 'function') continue;
    if (!validator(source[field])) {
      errors[field] = 'invalid';
    }
  }
  return errors;
}

module.exports = {
  validateEmail,
  validatePhone,
  validatePassword,
  isPositiveInt,
  isNonNegativeNumber,
  isSlotStep15,
  isIsoDate,
  normalizeString,
  requireFields,
  collectErrors,
};