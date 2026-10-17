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

const DESCRIPTION_MAX_LEN = 2000;
const NAME_MAX_LEN = 128;

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    // В PostgreSQL драйвер pg возвращает true/false, это проверка на всякий случай
    is_active: row.is_active === true || row.is_active === 1, 
  };
}

async function list({ activeOnly = true, categoryId = null, q = '' } = {}) {
  const where = ['1 = 1'];
  const params = [];
  
  if (activeOnly) {
    // ИСПРАВЛЕНИЕ: 1 заменено на TRUE
    where.push('s.is_active = TRUE'); 
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

  if (patch.description !== undefined) {
    if (patch.description === null) {
      values.description = null;
    } else {
      const normalized = normalizeString(patch.description, {
        maxLen: DESCRIPTION_MAX_LEN,
      });
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
    // ИСПРАВЛЕНИЕ: true/false вместо 1/0
    values.is_active = patch.is_active ? true : false; 
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

  // ИСПРАВЛЕНИЕ: 1 заменено на TRUE, добавлено RETURNING id (так как в PostgreSQL нет insertId)
  const [rows] = await db.query(
    `INSERT INTO services
       (category_id, name, description, duration_min, base_price, image_url, is_active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)
     RETURNING id`,
    [
      values.category_id,
      values.name,
      values.description !== undefined ? values.description : null,
      values.duration_min,
      values.base_price,
      values.image_url !== undefined ? values.image_url : null,
    ]
  );
  
  // Возвращаем по ID первой вставленной строки
  return findById(rows[0].id); 
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
  // ИСПРАВЛЕНИЕ: 0 заменено на FALSE
  const [rows] = await db.query(
    `UPDATE services SET is_active = FALSE WHERE id = ?`,
    [id]
  );
  
  // В PostgreSQL количество обновленных строк находится в rowCount. 
  // Но если ваш db.query адаптирован под mysql2, то он может возвращать [rows, fields].
  // Поэтому используем безопасную проверку.
  const affected = rows.rowCount !== undefined ? rows.rowCount : (rows.affectedRows || 0);
  return affected > 0;
}

module.exports = {
  list,
  findById,
  create,
  update,
  deactivate,
  remove: deactivate,
};