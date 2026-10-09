'use strict';

/**
 * Smoke-тесты загрузки модулей. 
 */

const { expect } = require('chai');

describe('Module loading (smoke)', function () {
  it('src/app грузится', function () {
    expect(() => require('../src/app')).to.not.throw();
  });

  it('модели загружаются', function () {
    const models = [
      'User', 'Client', 'Master', 'ServiceCategory', 'Service',
      'Schedule', 'TimeSlot', 'Appointment', 'Report', 'Archive',
    ];
    models.forEach((m) => {
      expect(() => require('../src/models/' + m), m).to.not.throw();
    });
  });

  it('контроллеры загружаются', function () {
    const controllers = [
      'authController', 'homeController', 'serviceController',
      'masterController', 'appointmentController', 'accountController',
      'adminController',
    ];
    controllers.forEach((c) => {
      expect(() => require('../src/controllers/' + c), c).to.not.throw();
    });
  });

  it('middleware auth экспортирует requireAuth, requireRole', function () {
    const m = require('../src/middleware/auth');
    expect(m).to.have.property('requireAuth').that.is.a('function');
    expect(m).to.have.property('requireRole').that.is.a('function');
  });

  it('errors экспортирует все классы', function () {
    const e = require('../src/errors');
    const keys = [
      'AppError', 'ValidationError', 'AuthError', 'ForbiddenError',
      'NotFoundError', 'ConflictError', 'SlotUnavailableError',
      'InvalidTransitionError',
    ];
    keys.forEach((k) => {
      expect(e, k).to.have.property(k);
    });
  });

  it('utils/validators экспортирует все функции', function () {
    const v = require('../src/utils/validators');
    const keys = [
      'validateEmail', 'validatePhone', 'validatePassword',
      'isPositiveInt', 'isSlotStep15', 'isIsoDate',
      'normalizeString', 'requireFields',
    ];
    keys.forEach((k) => {
      expect(v, k).to.have.property(k).that.is.a('function');
    });
  });
});
