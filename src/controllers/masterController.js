'use strict';

const Master = require('../models/Master');
const Service = require('../models/Service');
const TimeSlot = require('../models/TimeSlot');
const { NotFoundError, ValidationError } = require('../errors');
const { isIsoDate } = require('../utils/validators');


const PUBLIC_DAYS = 14;

function toPublicMaster(master) {
  if (!master) return null;
  return {
    id: master.id,
    full_name: master.full_name,
    specialization: master.specialization || null,
    bio: master.bio || null,
    photo_url: master.photo_url || null,
    is_active: master.is_active === true || master.is_active === 1,
  };
}

function localDateString(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minutesBetween(startStr, endStr) {
  const [ds, ts = '00:00:00'] = String(startStr).split(' ');
  const [de, te = '00:00:00'] = String(endStr).split(' ');
  const [ys, mos, das] = ds.split('-').map(Number);
  const [hs, mis, ses = 0] = ts.split(':').map(Number);
  const [ye, moe, dae] = de.split('-').map(Number);
  const [he, mie, see = 0] = te.split(':').map(Number);
  const a = new Date(ys, (mos || 1) - 1, das || 1, hs || 0, mis || 0, ses || 0);
  const b = new Date(ye, (moe || 1) - 1, dae || 1, he || 0, mie || 0, see || 0);
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/**
 * GET `/masters` — страница со списком активных мастеров.
 */
exports.listPage = async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const masters = (await Master.list({ q })).map(toPublicMaster);
    res.render('masters/list', { title: 'Мастера', masters, q });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/masters/:id` — карточка мастера: услуги и сетка свободных слотов
 * на ближайшие 14 дней. Email/phone в шаблон не передаются.
 */
exports.detailPage = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Мастер не найден'));
    }
    const master = await Master.findById(id);
    if (!master || !master.is_active || !master.user_is_active) {
      return next(new NotFoundError('Мастер не найден'));
    }

    const [services, dates] = await Promise.all([
      Master.listServices(id),
      (async () => {
        const out = [];
        for (let i = 0; i < PUBLIC_DAYS; i++) {
          const date = localDateString(i);
          const slots = await TimeSlot.listForMasterOnDate(id, date);
          const slotsCount = slots.filter((s) => s.status === 'free').length;
          out.push({ date, slotsCount });
        }
        return out;
      })(),
    ]);

    res.render('masters/detail', {
      title: master.full_name,
      master: toPublicMaster(master),
      services,
      dates,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/masters` — список активных мастеров (без контактных данных).
 */
exports.apiList = async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const masters = (await Master.list({ q })).map(toPublicMaster);
    res.json({ masters });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/masters/:id` — карточка мастера (без email/phone).
 */
exports.apiMasterById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Мастер не найден'));
    }
    const master = await Master.findById(id);
    if (!master || !master.is_active || !master.user_is_active) {
      return next(new NotFoundError('Мастер не найден'));
    }
    res.json({ master: toPublicMaster(master) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/masters/:id/slots?date=YYYY-MM-DD[&service_id=N]`
 */
exports.apiAvailableSlots = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Мастер не найден'));
    }

    const date = req.query.date;
    if (!isIsoDate(date)) {
      return next(new ValidationError('Некорректный параметр date', {
        errors: [{ field: 'date', message: 'Ожидается формат YYYY-MM-DD' }],
      }));
    }

    // Проверим, что мастер существует и активен. Иначе публичный API не
    // должен раскрывать внутренние id.
    const master = await Master.findById(id);
    if (!master || !master.is_active || !master.user_is_active) {
      return next(new NotFoundError('Мастер не найден'));
    }

    let slots;
    if (req.query.service_id !== undefined && req.query.service_id !== '') {
      const serviceId = Number(req.query.service_id);
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return next(new ValidationError('Некорректный параметр service_id', {
          errors: [{ field: 'service_id', message: 'Ожидается положительное целое' }],
        }));
      }
      const service = await Service.findById(serviceId);
      if (!service || !service.is_active) {
        return next(new NotFoundError('Услуга не найдена'));
      }
      slots = await TimeSlot.freeForService(id, date, service.duration_min);
    } else {
      const all = await TimeSlot.listForMasterOnDate(id, date);
      slots = all
        .filter((s) => s.status === 'free')
        .map((s) => ({
          id: s.id,
          slot_start: s.slot_start,
          slot_end_effective: s.slot_end,
          duration_min: minutesBetween(s.slot_start, s.slot_end),
        }));
    }

    res.json({ slots });
  } catch (err) {
    next(err);
  }
};