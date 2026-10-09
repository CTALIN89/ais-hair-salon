'use strict';

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { ConflictError, NotFoundError, ValidationError } = require('../errors');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

// Количество раундов bcrypt для хэширования паролей.
const BCRYPT_COST = 12;

// Поля для поиска по сущности User.
const USER_SEARCH_FIELDS = [
  'u.login',
  'u.full_name',
  'u.email',
  'u.phone',
  'r.code',
];

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    login: row.login,
    role_id: row.role_id,
    role: {
      id: row.role_id,
      code: row.role_code,
      name: row.role_name,
    },
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
    password_hash: row.password_hash,
  };
}

async function findByLogin(login) {
  const [rows] = await db.query(
    `SELECT u.id, u.login, u.role_id, u.full_name, u.email, u.phone,
            u.is_active, u.created_at, u.password_hash,
            r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.login = ?
      LIMIT 1`,
    [login]
  );
  return mapRow(rows[0]);
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT u.id, u.login, u.role_id, u.full_name, u.email, u.phone,
            u.is_active, u.created_at, u.password_hash,
            r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
      LIMIT 1`,
    [id]
  );
  return mapRow(rows[0]);
}

async function create({ login, password, role_id, full_name, email, phone }) {
  // Проверка дубликатов одним запросом по всем трём уникальным столбцам.
  const [dupRows] = await db.query(
    `SELECT login, email, phone
       FROM users
      WHERE login = ? OR email = ? OR phone = ?`,
    [login, email, phone]
  );

  if (dupRows.length > 0) {
    const duplicate = [];
    for (const row of dupRows) {
      if (row.login === login && !duplicate.includes('login')) duplicate.push('login');
      if (row.email === email && !duplicate.includes('email')) duplicate.push('email');
      if (row.phone === phone && !duplicate.includes('phone')) duplicate.push('phone');
    }
    throw new ConflictError('Логин, email или телефон уже заняты', {
      code: 'duplicate_user',
      details: { duplicate },
    });
  }

  const password_hash = bcrypt.hashSync(password, BCRYPT_COST);

  const [res] = await db.query(
    `INSERT INTO users (login, password_hash, role_id, full_name, email, phone, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [login, password_hash, role_id, full_name, email, phone]
  );

  return findById(res.insertId);
}

async function isLastActiveAdmin(id) {
  const [rows] = await db.query(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'admin' AND u.is_active = 1`
  );
  return rows.length === 1 && Number(rows[0].id) === Number(id);
}

async function deactivate(id) {
  if (await isLastActiveAdmin(id)) {
    throw new ConflictError(
      'Невозможно деактивировать единственного активного администратора',
      { code: 'last_active_admin' }
    );
  }
  await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
}

async function remove(id) {
  if (await isLastActiveAdmin(id)) {
    throw new ConflictError(
      'Невозможно удалить единственного активного администратора',
      { code: 'last_active_admin' }
    );
  }
  await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
}

async function activate(id) {
  await db.query('UPDATE users SET is_active = 1 WHERE id = ?', [id]);
}

async function setRole(id, role_id) {
  // Определяем code целевой роли — guard срабатывает, только если назначаем
  // роль, отличную от admin.
  const [roleRows] = await db.query('SELECT code FROM roles WHERE id = ? LIMIT 1', [role_id]);
  if (roleRows.length === 0) {
    throw new NotFoundError('Роль не найдена');
  }
  const targetCode = roleRows[0].code;
  if (targetCode !== 'admin' && (await isLastActiveAdmin(id))) {
    throw new ConflictError(
      'Невозможно снять роль администратора с последнего активного администратора',
      { code: 'last_active_admin' }
    );
  }
  await db.query('UPDATE users SET role_id = ? WHERE id = ?', [role_id, id]);
}

async function list({ q } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, USER_SEARCH_FIELDS);
  const sql = `
    SELECT u.id, u.login, u.role_id, u.full_name, u.email, u.phone,
           u.is_active, u.created_at,
           r.code AS role_code, r.name AS role_name,
           (
             r.code = 'admin' AND u.is_active = 1 AND
             NOT EXISTS (
               SELECT 1 FROM users u2
                 JOIN roles r2 ON r2.id = u2.role_id
               WHERE r2.code = 'admin' AND u2.is_active = 1 AND u2.id <> u.id
             )
           ) AS is_last_active_admin
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE 1 = 1 ${filter.where}
     ORDER BY u.full_name`;
  const [rows] = await db.query(sql, filter.params);
  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    role_id: row.role_id,
    role_code: row.role_code,
    role_name: row.role_name,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    is_active: row.is_active === 1 || row.is_active === true,
    is_last_active_admin: row.is_last_active_admin === 1 || row.is_last_active_admin === true,
    created_at: row.created_at,
  }));
}

async function update(id, patch = {}) {
  const sets = [];
  const params = [];
  if (patch.full_name !== undefined) { sets.push('full_name = ?'); params.push(String(patch.full_name).trim().slice(0, 128)); }
  if (patch.email     !== undefined) { sets.push('email = ?');     params.push(String(patch.email).trim().slice(0, 128)); }
  if (patch.phone     !== undefined) { sets.push('phone = ?');     params.push(String(patch.phone).trim().slice(0, 32)); }
  if (patch.password) {
    if (typeof patch.password !== 'string' || patch.password.length < 6) {
      throw new ValidationError('Пароль должен содержать не менее 6 символов', { fields: { password: 'invalid' } });
    }
    sets.push('password_hash = ?');
    params.push(bcrypt.hashSync(patch.password, BCRYPT_COST));
  }
  if (sets.length > 0) {
    params.push(id);
    try {
      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        throw new ConflictError('Логин, email или телефон уже заняты', { code: 'duplicate_user' });
      }
      throw err;
    }
  }
  // Смена роли — отдельный путь, чтобы пройти через guard.
  if (patch.role_id !== undefined) {
    await setRole(id, Number(patch.role_id));
  }
  return findById(id);
}

function verifyPassword(user, password) {
  if (!user || !user.password_hash || typeof password !== 'string') return false;
  return bcrypt.compareSync(password, user.password_hash);
}

function publicView(user) {
  if (!user) return null;
  const { password_hash: _ignored, ...safe } = user;
  return safe;
}

module.exports = {
  findByLogin,
  findById,
  create,
  update,
  list,
  deactivate,
  remove,
  activate,
  setRole,
  isLastActiveAdmin,
  verifyPassword,
  publicView,
};