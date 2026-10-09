'use strict';

// scripts/migrate.js

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const config = require('../src/config');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function applyMigrations(conn) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const name of files) {
    const filePath = path.join(MIGRATIONS_DIR, name);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`Applying migration: ${name}`);
    await conn.query('START TRANSACTION;');
    try {
      await conn.query(sql);
      await conn.query('COMMIT;');
    } catch (err) {
      // ROLLBACK не должен затирать исходную ошибку — глотаем его внутреннюю.
      try {
        await conn.query('ROLLBACK;');
      } catch (_rollbackErr) {
        // ignore
      }
      const wrapped = new Error(
        `Migration ${name} failed: ${err && err.message ? err.message : err}`
      );
      wrapped.cause = err;
      throw wrapped;
    }
    applied += 1;
  }

  console.log(`Applied ${applied} migrations`);
}

async function run() {
  const { host, port, user, password, database } = config.db;

  if (!database) {
    throw new Error('DB_NAME is not set in environment (.env)');
  }

  console.log(`Connecting to MySQL at ${host}:${port}`);

  // Шаг 1: соединение без выбранной БД — чтобы иметь право создать её.
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
  });

  try {
    // Шаг 2: создать БД, если её ещё нет.
    console.log(`Ensuring database \`${database}\` exists`);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` `
        + `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );

    // Шаг 3: переключиться на целевую БД.
    await conn.changeUser({ database });

    // Шаг 4: применить schema.sql одним батчем.
    // FOREIGN_KEY_CHECKS отключаем на время DROP/CREATE — в противном случае
    // старые таблицы (в т.ч. оставшиеся от прежних схем) могут держать FK на
    // наши таблицы и DROP упадёт.
    console.log('Applying schema.sql');
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
    try {
      await conn.query(sql);
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1;');
    }

    // Отчёт: сколько таблиц оказалось в БД после миграции.
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ?;',
      [database]
    );
    const tableCount = rows && rows[0] ? rows[0].cnt : 0;
    console.log(`Done. ${tableCount} tables created`);

    // Шаг 5: применить инкрементальные миграции из scripts/migrations/.
    // Файлы выполняются в лексикографическом порядке, каждый — в отдельной
    // транзакции. Все миграции идемпотентны (IF NOT EXISTS), поэтому
    // повторный запуск безопасен.
    await applyMigrations(conn);
  } finally {
    await conn.end();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err && err.message ? err.message : err);
    process.exit(1);
  });