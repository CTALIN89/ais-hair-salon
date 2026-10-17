'use strict';

// Загружаем переменные окружения из .env до чтения process.env.*
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  
  // Блок db закомментирован, так как проект переведен на PostgreSQL (Supabase).
  // Подключение к новой базе данных настраивается через DATABASE_URL в src/config/db.js
  /*
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  */
};