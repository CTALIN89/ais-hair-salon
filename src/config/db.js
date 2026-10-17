'use strict';
const { Pool } = require('pg');

// Пул соединений PostgreSQL для Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Обязательно для Supabase
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  withTransaction,
  // Обертка для совместимости с mysql2:
  // Возвращает массив [rows, fields], чтобы старый код с const [rows] = ... не падал
  query: async (text, params) => {
    const res = await pool.query(text, params);
    return [res.rows, res.fields]; 
  },
  end: () => pool.end()
};