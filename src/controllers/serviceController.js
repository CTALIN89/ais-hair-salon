'use strict';

const Service = require('../models/Service');
const ServiceCategory = require('../models/ServiceCategory');
const Master = require('../models/Master');
const { NotFoundError } = require('../errors');

function parseCategoryId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * GET `/services` — страница каталога с фильтром по категории.
 */
exports.listPage = async (req, res, next) => {
  try {
    const selectedCategoryId = parseCategoryId(req.query.category_id);
    const q = req.query.q || '';
    const [categories, services] = await Promise.all([
      ServiceCategory.list(),
      Service.list({ activeOnly: true, categoryId: selectedCategoryId, q }),
    ]);
    res.render('services/list', {
      title: 'Услуги',
      categories,
      services,
      selectedCategoryId,
      q,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/services/:id` — карточка услуги со списком мастеров, оказывающих её.
 */
exports.detailPage = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    const service = await Service.findById(id);
    if (!service || !service.is_active) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    const masters = await Master.findByService(service.id);
    res.render('services/detail', {
      title: service.name,
      service,
      masters,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/services` — JSON-список активных услуг (с опциональным фильтром
 * `category_id`).
 */
exports.apiList = async (req, res, next) => {
  try {
    const categoryId = parseCategoryId(req.query.category_id);
    const q = req.query.q || '';
    const services = await Service.list({ activeOnly: true, categoryId, q });
    res.json({ services });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/services/categories` — JSON-список категорий.
 */
exports.apiCategories = async (req, res, next) => {
  try {
    const categories = await ServiceCategory.list();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/services/:id` — карточка услуги в JSON. 404 при отсутствии.
 */
exports.apiServiceById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    const service = await Service.findById(id);
    if (!service || !service.is_active) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    res.json({ service });
  } catch (err) {
    next(err);
  }
};

/**
 * GET `/api/services/:id/masters` — список активных мастеров, оказывающих
 * услугу. Предварительно убеждаемся, что услуга существует и активна, чтобы
 * отдать 404 осмысленно вместо пустого массива.
 */
exports.apiMastersOfService = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    const service = await Service.findById(id);
    if (!service || !service.is_active) {
      return next(new NotFoundError('Услуга не найдена'));
    }
    const masters = await Master.findByService(id);
    res.json({ masters });
  } catch (err) {
    next(err);
  }
};