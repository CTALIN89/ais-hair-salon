'use strict';

/**
 * Проверка структурной целостности state machine записей. 
 */

const { expect } = require('chai');
const Appointment = require('../src/models/Appointment');

describe('Appointment state machine (smoke)', function () {
  it('ALLOWED_TRANSITIONS включает все 7 статусов', function () {
    const keys = Object.keys(Appointment.ALLOWED_TRANSITIONS);
    expect(keys).to.include.members([
      'Created', 'Confirmed', 'InService', 'Rescheduled',
      'Completed', 'Cancelled', 'Archived',
    ]);
  });

  it('Created → Confirmed/Cancelled/Rescheduled', function () {
    expect(Array.from(Appointment.ALLOWED_TRANSITIONS.Created))
      .to.deep.equal(['Confirmed', 'Cancelled', 'Rescheduled']);
  });

  it('Archived — терминальный (пустой массив)', function () {
    expect(Array.from(Appointment.ALLOWED_TRANSITIONS.Archived))
      .to.deep.equal([]);
  });

 it('InService → Completed / Cancelled / Confirmed', function () {
  expect(Array.from(Appointment.ALLOWED_TRANSITIONS.InService))
    .to.deep.equal(['Completed', 'Cancelled', 'Confirmed']);
});

it('Completed → Archived / InService', function () {
  expect(Array.from(Appointment.ALLOWED_TRANSITIONS.Completed))
    .to.deep.equal(['Archived', 'InService']);
});

it('Cancelled → Archived / Created', function () {
  expect(Array.from(Appointment.ALLOWED_TRANSITIONS.Cancelled))
    .to.deep.equal(['Archived', 'Created']);
});
});
