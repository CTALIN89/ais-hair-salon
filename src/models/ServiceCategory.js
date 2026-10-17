'use strict';

const db = require('../config/db');
const { ConflictError } = require('../errors');
const { normalizeString } = require('../utils/validators');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

const CATEGORY_SEARCH_FIELDS = ['c.name'];

async function list({ q = '' } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, CATEGORY_SEARCH_FIELDS);
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.sort_order,
            COUNT(s.id) AS services_count
       FROM service_categories c
       LEFT JOIN services s ON s.category_id = c.id
      WHERE 1 = 1 ${filter.where}
      GROUP BY c.id, c.name, c.sort_order
      ORDER BY c.sort_order, c.name`,
    filter.params
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sort_order: r.sort_order,
    services_count: Number(r.services_count) || 0,
  }));
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT id, name, sort_order
       FROM service_categories
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function create({ name, sort_order = 0 } = {}) {
  const normalized = normalizeString(name, { maxLen: 128 });
  if (!normalized) {
    throw new Error('name is required');
  }
  if (!Number.isInteger(sort_order)) {
    throw new Error('sort_order must be an integer');
  }

  try {
    // ИСПРАВЛЕНИЕ: Используем RETURNING id для получения ID в PostgreSQL
    const [rows] = await db.query(
      `INSERT INTO service_categories (name, sort_order) VALUES (?, ?) RETURNING id`,
      [normalized, sort_order]
    );
    return findById(rows[0].id);
  } catch (err) {
    if (err && (err.code === '23505' || err.code === 'ER_DUP_ENTRY')) {
      throw new ConflictError('Категория с таким названием уже существует', {
        code: 'duplicate_category',
      });
    }
    throw err;
  }
}

async function update(id, patch = {}) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) {
    const normalized = normalizeString(patch.name, { maxLen: 128 });
    if (!normalized) {
      throw new Error('name must not be empty');
    }
    sets.push('name = ?');
    params.push(normalized);
  }
  if (patch.sort_order !== undefined) {
    if (!Number.isInteger(patch.sort_order)) {
      throw new Error('sort_order must be an integer');
    }
    sets.push('sort_order = ?');
    params.push(patch.sort_order);
  }

  if (sets.length === 0) {
    return findById(id);
  }

  params.push(id);
  try {
    await db.query(
      `UPDATE service_categories SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  } catch (err) {
    if (err && (err.code === '23505' || err.code === 'ER_DUP_ENTRY')) {
      throw new ConflictError('Категория с таким названием уже существует', {
        code: 'duplicate_category',
      });
    }
    throw err;
  }
  return findById(id);
}

async function remove(id) {
  try {
    const [res] = await db.query(
      `DELETE FROM service_categories WHERE id = ?`,
      [id]
    );
    const affected = res.rowCount !== undefined ? res.rowCount : res.affectedRows;
    return affected > 0;
  } catch (err) {
    // ИСПРАВЛЕНИЕ: код ошибки нарушения внешнего ключа в PostgreSQL - 23503
    if (err && (err.code === '23503' || err.code === 'ER_ROW_IS_REFERENCED_2')) {
      throw new ConflictError('Нельзя удалить категорию с услугами', {
        code: 'category_in_use',
      });
    }
    throw err;
  }
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove,
};