'use strict';

const db = require('../config/db');
const {
  ValidationError,
  NotFoundError,
} = require('../errors');
const {
  isSlotStep15,
  isNonNegativeNumber,
  isPositiveInt,
  normalizeString,
} = require('../utils/validators');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

// Поля для поиска по сущности Service 
const SERVICE_SEARCH_FIELDS = ['s.name', 's.description', 'c.name'];

// Максимальная длина описания услуги. БД хранит как TEXT, но для UX и защиты
// от злонамеренных больших payload нормализуем до разумного предела.
const DESCRIPTION_MAX_LEN = 2000;
const NAME_MAX_LEN = 128;

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: row.is_active === 1 || row.is_active === true,
  };
}

async function list({ activeOnly = true, categoryId = null, q = '' } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (activeOnly) {
    where.push('s.is_active = 1');
  }
  if (categoryId != null) {
    where.push('s.category_id = ?');
    params.push(categoryId);
  }
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, SERVICE_SEARCH_FIELDS);

  const [rows] = await db.query(
    `SELECT s.id,
            s.category_id,
            s.name,
            s.description,
            s.duration_min,
            s.base_price,
            s.image_url,
            s.is_active,
            c.name AS category_name
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
      WHERE ${where.join(' AND ')} ${filter.where}
      ORDER BY c.sort_order, s.name`,
    [...params, ...filter.params]
  );
  return rows.map(mapRow);
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT s.id,
            s.category_id,
            s.name,
            s.description,
            s.duration_min,
            s.base_price,
            s.image_url,
            s.is_active,
            c.name AS category_name
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
      WHERE s.id = ?
      LIMIT 1`,
    [id]
  );
  return mapRow(rows[0]);
}

function validatePatch(patch, { required = false } = {}) {
  const errors = [];
  const values = {};

  const hasName = patch.name !== undefined;
  if (required || hasName) {
    const normalized = normalizeString(patch.name, { maxLen: NAME_MAX_LEN });
    if (!normalized) {
      errors.push({ field: 'name', message: 'Укажите название услуги' });
    } else {
      values.name = normalized;
    }
  }

  const hasCategory = patch.category_id !== undefined;
  if (required || hasCategory) {
    const categoryId = Number(patch.category_id);
    if (!isPositiveInt(categoryId)) {
      errors.push({ field: 'category_id', message: 'Некорректная категория' });
    } else {
      values.category_id = categoryId;
    }
  }

  const hasDuration = patch.duration_min !== undefined;
  if (required || hasDuration) {
    const duration = Number(patch.duration_min);
    if (!isSlotStep15(duration)) {
      errors.push({
        field: 'duration_min',
        message: 'Длительность должна быть положительной и кратной 15 минутам',
      });
    } else {
      values.duration_min = duration;
    }
  }

  const hasPrice = patch.base_price !== undefined;
  if (required || hasPrice) {
    const price = Number(patch.base_price);
    if (!isNonNegativeNumber(price)) {
      errors.push({
        field: 'base_price',
        message: 'Цена должна быть неотрицательным числом',
      });
    } else {
      values.base_price = price;
    }
  }

  // description опционален в create тоже
  if (patch.description !== undefined) {
    if (patch.description === null) {
      values.description = null;
    } else {
      const normalized = normalizeString(patch.description, {
        maxLen: DESCRIPTION_MAX_LEN,
      });
      // пустая строка после trim → храним NULL вместо пустоты
      values.description = normalized && normalized.length > 0 ? normalized : null;
    }
  }

  if (patch.image_url !== undefined) {
    if (patch.image_url === null) {
      values.image_url = null;
    } else {
      const url = normalizeString(patch.image_url, { maxLen: 512 });
      values.image_url = url && url.length > 0 ? url : null;
    }
  }

  if (patch.is_active !== undefined) {
    values.is_active = patch.is_active ? 1 : 0;
  }

  return { errors, values };
}

async function assertCategoryExists(categoryId) {
  const [rows] = await db.query(
    `SELECT id FROM service_categories WHERE id = ? LIMIT 1`,
    [categoryId]
  );
  if (rows.length === 0) {
    throw new NotFoundError('Категория не найдена');
  }
}

async function create(data = {}) {
  const { errors, values } = validatePatch(data, { required: true });
  if (errors.length > 0) {
    throw new ValidationError('Некорректные данные услуги', { errors });
  }

  await assertCategoryExists(values.category_id);

  const [res] = await db.query(
    `INSERT INTO services
       (category_id, name, description, duration_min, base_price, image_url, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      values.category_id,
      values.name,
      values.description !== undefined ? values.description : null,
      values.duration_min,
      values.base_price,
      values.image_url !== undefined ? values.image_url : null,
    ]
  );
  return findById(res.insertId);
}

async function update(id, patch = {}) {
  const existing = await findById(id);
  if (!existing) {
    throw new NotFoundError('Услуга не найдена');
  }

  const { errors, values } = validatePatch(patch, { required: false });
  if (errors.length > 0) {
    throw new ValidationError('Некорректные данные услуги', { errors });
  }

  // Пустой patch — просто вернуть текущее состояние.
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return existing;
  }

  if (values.category_id !== undefined) {
    await assertCategoryExists(values.category_id);
  }

  const sets = keys.map((k) => `${k} = ?`);
  const params = keys.map((k) => values[k]);
  params.push(id);

  await db.query(
    `UPDATE services SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
  return findById(id);
}

async function deactivate(id) {
  const [res] = await db.query(
    `UPDATE services SET is_active = 0 WHERE id = ?`,
    [id]
  );
  return res.affectedRows > 0;
}

module.exports = {
  list,
  findById,
  create,
  update,
  deactivate,
  remove: deactivate,
};