'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function formatQuery(text, params) {
  let index = 0;
  const formattedText = text.replace(/\?/g, () => `$${++index}`);
  return { text: formattedText, values: params || [] };
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Обертка для клиента транзакции, чтобы conn.query возвращал [rows, fields]
    const clientWrapper = {
      query: async (text, params) => {
        const formatted = formatQuery(text, params);
        const res = await client.query(formatted.text, formatted.values);
        return [res.rows, res.fields];
      }
    };

    const result = await fn(clientWrapper);
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
  query: async (text, params) => {
    const formatted = formatQuery(text, params);
    const res = await pool.query(formatted.text, formatted.values);
    return [res.rows, res.fields]; 
  },
  end: () => pool.end()
};