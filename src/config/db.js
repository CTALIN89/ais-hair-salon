'use strict';

const mysql = require('mysql2/promise');
const config = require('./index');

// Пул соединений MySQL. Используется во всех моделях и скриптах
// через `require('../config/db')`.
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password || '',
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4_unicode_ci',
});

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

// Экспортируем пул "через делегирующий объект", а не сам PromisePool.
const db = {
  pool,
  withTransaction,
  query: pool.query.bind(pool),
  execute: pool.execute.bind(pool),
  getConnection: pool.getConnection.bind(pool),
  end: pool.end.bind(pool),
};

module.exports = db;