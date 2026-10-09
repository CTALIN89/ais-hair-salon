'use strict';

/**
 * Контроллер записей (Appointment) — HTML-страница мастера бронирования и
 * REST-эндпоинты управления жизненным циклом записи.
 */

const Appointment = require('../models/Appointment');
const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} = require('../errors');
const { isPositiveInt, isNonNegativeNumber } = require('../utils/validators');

function roleOf(user) {
  if (!user) return null;
  if (user.role && typeof user.role === 'object' && user.role.code) {
    return String(user.role.code);
  }
  if (user.role_code) return String(user.role_code);
  if (typeof user.role === 'string') return user.role;
  return null;
}

function toPositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return isPositiveInt(n) ? n : null;
}

function parseAppointmentId(raw) {
  const id = toPositiveInt(raw);
  if (id === null) {
    throw new ValidationError('Некорректный идентификатор записи', {
      errors: [{ field: 'id', message: 'Ожидается положительное целое' }],
    });
  }
  return id;
}

function normalizeMineStatus(raw) {
  if (raw === 'active' || raw === 'history') return raw;
  return undefined;
}

async function bookingPage(req, res, next) {
  try {
    const preselected = {
      service_id: toPositiveInt(req.query.service_id),
      master_id: toPositiveInt(req.query.master_id),
      // Дата — строка `YYYY-MM-DD`; отдаём как есть, клиентский wizard
      // сверит её с min/max при выставлении в input[type=date].
      date: typeof req.query.date === 'string' ? req.query.date : null,
    };
    res.render('appointments/book', {
      title: 'Новая запись',
      preselected,
    });
  } catch (err) {
    next(err);
  }
}

async function apiCreate(req, res, next) {
  try {
    const user = req.session.user;
    if (roleOf(user) !== 'client') {
      return next(new ForbiddenError('Записаться на услугу может только клиент'));
    }

    const body = req.body || {};
    const serviceId = toPositiveInt(body.service_id);
    const masterId = toPositiveInt(body.master_id);
    const timeSlotId = toPositiveInt(body.time_slot_id);

    const fieldErrors = [];
    if (serviceId === null) fieldErrors.push({ field: 'service_id', message: 'Обязателен идентификатор услуги' });
    if (masterId === null) fieldErrors.push({ field: 'master_id', message: 'Обязателен идентификатор мастера' });
    if (timeSlotId === null) fieldErrors.push({ field: 'time_slot_id', message: 'Обязателен идентификатор слота' });
    if (fieldErrors.length > 0) {
      return next(new ValidationError('Ошибка валидации', { errors: fieldErrors }));
    }

    const appointment = await Appointment.create({
      clientId: user.id,
      masterId,
      serviceId,
      timeSlotId,
    });

    res.status(201).json({ appointment });
  } catch (err) {
    next(err);
  }
}

async function apiMine(req, res, next) {
  try {
    const user = req.session.user;
    const status = normalizeMineStatus(req.query.status);
    const role = roleOf(user);

    let appointments = [];
    if (role === 'client') {
      appointments = await Appointment.listForClient(user.id, { status });
    } else if (role === 'master') {
      appointments = await Appointment.listForMaster(user.id, { status });
    } else {
      // admin / guest: этот эндпоинт не предназначен для них.
      appointments = [];
    }

    res.json({ appointments });
  } catch (err) {
    next(err);
  }
}

async function apiCancel(req, res, next) {
  try {
    const id = parseAppointmentId(req.params.id);
    const { comment } = req.body || {};
    const appointment = await Appointment.cancel(id, req.session.user, {
      comment: typeof comment === 'string' ? comment : null,
    });
    if (!appointment) return next(new NotFoundError('Запись не найдена'));
    res.json({ appointment });
  } catch (err) {
    next(err);
  }
}

async function apiReschedule(req, res, next) {
  try {
    const id = parseAppointmentId(req.params.id);
    const body = req.body || {};
    const newSlotId = toPositiveInt(body.time_slot_id);
    if (newSlotId === null) {
      return next(new ValidationError('Не указан новый слот', {
        errors: [{ field: 'time_slot_id', message: 'Ожидается положительное целое' }],
      }));
    }
    const comment = typeof body.comment === 'string' ? body.comment : null;
    const appointment = await Appointment.reschedule(
      id, req.session.user, newSlotId, { comment }
    );
    if (!appointment) return next(new NotFoundError('Запись не найдена'));
    res.json({ appointment });
  } catch (err) {
    next(err);
  }
}

async function apiSetStatus(req, res, next) {
  try {
    const id = parseAppointmentId(req.params.id);
    const body = req.body || {};
    const status = body.status;
    if (typeof status !== 'string' || status.length === 0) {
      return next(new ValidationError('Необходимо указать целевой статус', {
        errors: [{ field: 'status', message: 'Ожидается строковое значение' }],
      }));
    }

    let actualPrice;
    if (status === 'Completed') {
      const raw = body.actual_price;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (isNonNegativeNumber(n)) {
        actualPrice = n;
      }
    }

    const comment = typeof body.comment === 'string' ? body.comment : null;

    const appointment = await Appointment.setStatusForce(
      id, req.session.user, status, { actualPrice, comment }
    );
    if (!appointment) return next(new NotFoundError('Запись не найдена'));
    res.json({ appointment });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  bookingPage,
  apiCreate,
  apiMine,
  apiCancel,
  apiReschedule,
  apiSetStatus,
};