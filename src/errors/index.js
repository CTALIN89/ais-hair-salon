'use strict';

// Доменные исключения приложения «Салон-парикмахерская HAIR SALON».
 
class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    const { status = 500, code = 'internal_error', details } = options;
    this.name = 'AppError';
    this.httpStatus = status;
    // Alias, чтобы можно было обращаться через .status без нарушения контракта.
    this.status = status;
    this.code = code;
    this.details = details;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

class ValidationError extends AppError {
  constructor(message = 'Ошибка валидации', details) {
    super(message, { status: 400, code: 'validation_error', details });
    this.name = 'ValidationError';
  }
}

class AuthError extends AppError {
  constructor(message = 'Требуется аутентификация') {
    super(message, { status: 401, code: 'auth_error' });
    this.name = 'AuthError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Доступ запрещён') {
    super(message, { status: 403, code: 'forbidden' });
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Ресурс не найден') {
    super(message, { status: 404, code: 'not_found' });
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Конфликт состояния', options = {}) {
    const { code = 'conflict', details } = options;
    super(message, { status: 409, code, details });
    this.name = 'ConflictError';
  }
}

class SlotUnavailableError extends ConflictError {
  constructor(message = 'Выбранный слот уже недоступен', details) {
    super(message, { code: 'slot_unavailable', details });
    this.name = 'SlotUnavailableError';
  }
}

class InvalidTransitionError extends ConflictError {
  constructor(message = 'Недопустимый переход статуса', details) {
    super(message, { code: 'invalid_transition', details });
    this.name = 'InvalidTransitionError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  SlotUnavailableError,
  InvalidTransitionError,
};