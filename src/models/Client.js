'use strict';

const db = require('../config/db');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

const CLIENT_SEARCH_FIELDS = [
  'u.full_name',
  'u.email',
  'u.phone',
  'u.login',
];

async function create(userId, { birth_date = null, notes = null } = {}) {
  await db.query(
    `INSERT INTO clients (user_id, birth_date, notes) VALUES (?, ?, ?)`,
    [userId, birth_date, notes]
  );
  return { user_id: userId, birth_date, notes };
}

async function findByUserId(userId) {
  const [rows] = await db.query(
    `SELECT c.user_id,
            c.birth_date,
            c.notes,
            u.full_name,
            u.email,
            u.phone,
            u.is_active,
            u.created_at
       FROM clients c
       JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ?
      LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    is_active: rows[0].is_active === true || rows[0].is_active === 1,
  };
}

async function list({ q = '', activeOnly = false } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, CLIENT_SEARCH_FIELDS);
  // ИСПРАВЛЕНИЕ: 1 заменено на TRUE
  const where = activeOnly ? 'u.is_active = TRUE' : '1 = 1';
  const [rows] = await db.query(
    `SELECT c.user_id AS id,
            u.full_name,
            u.email,
            u.phone,
            u.login,
            u.is_active,
            u.created_at,
            c.birth_date,
            c.notes
       FROM clients c
       JOIN users u ON u.id = c.user_id
      WHERE ${where} ${filter.where}
      ORDER BY u.full_name`,
    filter.params
  );
  return rows.map((r) => ({
    ...r,
    is_active: r.is_active === true || r.is_active === 1,
  }));
}

async function updateProfile(userId, patch = {}) {
  const sets = [];
  const params = [];
  if (patch.birth_date !== undefined) {
    sets.push('birth_date = ?');
    params.push(patch.birth_date || null);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    params.push(patch.notes === null ? null : String(patch.notes).slice(0, 2000));
  }
  if (sets.length === 0) return false;
  params.push(userId);
  const [res] = await db.query(
    `UPDATE clients SET ${sets.join(', ')} WHERE user_id = ?`,
    params
  );
  // ИСПРАВЛЕНИЕ: безопасная проверка для PostgreSQL (rowCount) и MySQL (affectedRows)
  const affected = res.rowCount !== undefined ? res.rowCount : res.affectedRows;
  return affected > 0;
}

module.exports = {
  create,
  findByUserId,
  list,
  updateProfile,
};