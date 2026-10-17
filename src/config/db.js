'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

// Функция для замены '?' на '$1', '$2' и т.д. для PostgreSQL
function formatQuery(text, params) {
  let index = 0;
  const formattedText = text.replace(/\?/g, () => `$${++index}`);
  return { text: formattedText, values: params };
}

module.exports = {
  pool,
  withTransaction,
  // Обертка, которая адаптирует старый синтаксис MySQL под PostgreSQL
  query: async (text, params) => {
    const formatted = formatQuery(text, params);
    const res = await pool.query(formatted.text, formatted.values);
    return [res.rows, res.fields]; 
  },
  end: () => pool.end()
};