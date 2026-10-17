'use strict';

const db = require('../config/db');
const { ConflictError } = require('../errors');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

const MASTER_SEARCH_FIELDS = [
  'u.full_name',
  'u.email',
  'u.phone',
  'm.specialization',
  'm.bio',
];

async function list({ activeOnly = true, q = '' } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, MASTER_SEARCH_FIELDS);
  // ИСПРАВЛЕНИЕ: 1 заменено на TRUE
  const where = activeOnly
    ? 'u.is_active = TRUE AND m.is_active = TRUE'
    : 'u.is_active = TRUE';
  const [rows] = await db.query(
    `SELECT m.user_id       AS id,
            u.full_name,
            u.email,
            u.phone,
            m.specialization,
            m.bio,
            m.photo_url,
            m.is_active
       FROM masters m
       JOIN users u ON u.id = m.user_id
      WHERE ${where} ${filter.where}
      ORDER BY u.full_name`,
    filter.params
  );
  return rows.map((row) => ({
    ...row,
    is_active: row.is_active === true || row.is_active === 1,
  }));
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT m.user_id       AS id,
            u.full_name,
            u.email,
            u.phone,
            m.specialization,
            m.bio,
            m.photo_url,
            m.is_active,
            u.is_active     AS user_is_active
       FROM masters m
       JOIN users u ON u.id = m.user_id
      WHERE m.user_id = ?
      LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    is_active: rows[0].is_active === true || rows[0].is_active === 1,
    user_is_active:
      rows[0].user_is_active === true || rows[0].user_is_active === 1,
  };
}

async function findByService(serviceId) {
  const [rows] = await db.query(
    `SELECT m.user_id       AS id,
            u.full_name,
            m.specialization,
            m.bio,
            m.photo_url,
            m.is_active
       FROM masters m
       JOIN users u ON u.id = m.user_id
       JOIN master_services ms ON ms.master_id = m.user_id
      WHERE ms.service_id = ?
        AND u.is_active = TRUE
        AND m.is_active = TRUE
      ORDER BY u.full_name`,
    [serviceId]
  );
  return rows.map((row) => ({
    ...row,
    is_active: row.is_active === true || row.is_active === 1,
  }));
}

async function create(userId, { specialization = null, bio = null, photo_url = null } = {}) {
  await db.query(
    `INSERT INTO masters (user_id, specialization, bio, photo_url) VALUES (?, ?, ?, ?)`,
    [userId, specialization, bio, photo_url]
  );
  return { user_id: userId, specialization, bio, photo_url, is_active: true };
}

async function updateProfile(userId, patch = {}) {
  const sets = [];
  const params = [];
  if (patch.specialization !== undefined) {
    sets.push('specialization = ?');
    params.push(patch.specialization === null ? null : String(patch.specialization).slice(0, 128));
  }
  if (patch.bio !== undefined) {
    sets.push('bio = ?');
    params.push(patch.bio === null ? null : String(patch.bio).slice(0, 2000));
  }
  if (patch.photo_url !== undefined) {
    sets.push('photo_url = ?');
    params.push(patch.photo_url === null ? null : String(patch.photo_url).slice(0, 512));
  }
  if (sets.length === 0) return false;
  params.push(userId);
  const [res] = await db.query(
    `UPDATE masters SET ${sets.join(', ')} WHERE user_id = ?`,
    params
  );
  const affected = res.rowCount !== undefined ? res.rowCount : res.affectedRows;
  return affected > 0;
}

async function attachService(masterId, serviceId) {
  const [exists] = await db.query(
    `SELECT 1 FROM master_services WHERE master_id = ? AND service_id = ? LIMIT 1`,
    [masterId, serviceId]
  );
  if (exists.length > 0) {
    throw new ConflictError('Мастер уже оказывает эту услугу', {
      code: 'duplicate_master_service',
    });
  }

  try {
    await db.query(
      `INSERT INTO master_services (master_id, service_id) VALUES (?, ?)`,
      [masterId, serviceId]
    );
  } catch (err) {
    // ИСПРАВЛЕНИЕ: код ошибки дубликата в PostgreSQL - 23505
    if (err && (err.code === '23505' || err.code === 'ER_DUP_ENTRY')) {
      throw new ConflictError('Мастер уже оказывает эту услугу', {
        code: 'duplicate_master_service',
      });
    }
    throw err;
  }

  return { master_id: masterId, service_id: serviceId };
}

async function detachService(masterId, serviceId) {
  const [res] = await db.query(
    `DELETE FROM master_services WHERE master_id = ? AND service_id = ?`,
    [masterId, serviceId]
  );
  const affected = res.rowCount !== undefined ? res.rowCount : res.affectedRows;
  return affected > 0;
}

async function listServices(masterId) {
  const [rows] = await db.query(
    `SELECT s.id,
            s.category_id,
            s.name,
            s.description,
            s.duration_min,
            s.base_price,
            s.is_active
       FROM services s
       JOIN master_services ms ON ms.service_id = s.id
      WHERE ms.master_id = ?
        AND s.is_active = TRUE
      ORDER BY s.name`,
    [masterId]
  );
  return rows;
}

async function setActive(id, isActive) {
  // ИСПРАВЛЕНИЕ: true/false вместо 1/0
  await db.query(
    `UPDATE masters SET is_active = ? WHERE user_id = ?`,
    [isActive ? true : false, id]
  );
}

module.exports = {
  list,
  findById,
  findByService,
  create,
  updateProfile,
  attachService,
  detachService,
  listServices,
  setActive,
};