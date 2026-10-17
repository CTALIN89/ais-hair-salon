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
  query: (text, params) => pool.query(text, params),
  end: () => pool.end()
};