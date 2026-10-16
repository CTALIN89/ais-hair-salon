'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const indexRoutes = require('./routes/index');
const apiRoutes = require('./routes/api');

const app = express();

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Парсеры тела запроса
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Статика из public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Сессии 
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

// Локали для Pug: текущий пользователь и путь
app.use((req, res, next) => {
  res.locals.user = (req.session && req.session.user) || null;
  res.locals.path = req.path;
  next();
});

// Роутеры
app.use('/', indexRoutes);
app.use('/api', apiRoutes);

// Health Check для мониторинга
app.get('/health', async (req, res) => {
  const db = require('./config/db');
  const startTime = Date.now();
  
  try {
    await db.query('SELECT 1');
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: 'connected',
        responseTimeMs: responseTime,
      },
      version: require('../package.json').version,
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: {
        status: 'disconnected',
        error: err.message,
      },
    });
  }
});

// 404: для /api — JSON, иначе — Pug-страница 
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'NotFound', message: 'Ресурс не найден' });
  }
  res.status(404).render('errors/404', { title: 'Не найдено' });
});

// Глобальный обработчик ошибок 
app.use((err, req, res, _next) => {
  console.error('[error]', err && err.stack ? err.stack : err);

  // AppError хранит код в err.httpStatus
  const status = Number(err && (err.httpStatus || err.status)) || 500;

  if (req.path.startsWith('/api')) {
    const body = {
      error: err && err.code ? err.code : 'internal_error',
      message: err && err.message && status < 500
        ? err.message
        : 'Внутренняя ошибка сервера',
    };
    if (err && err.details !== undefined) {
      body.details = err.details;
    }
    return res.status(status).json(body);
  }

  // Для HTML-страниц: 404 рендерим «красивой» страницей, 403 — своей, остальное - 500.
  if (status === 404) {
    return res.status(404).render('errors/404', { title: 'Не найдено' });
  }
  if (status === 403) {
    return res.status(403).render('errors/403', { title: 'Доступ запрещён' });
  }
  // Не раскрываем стек и текст исключения; шаблон 500 использует только фиксированные формулировки.
  return res.status(status >= 500 ? 500 : status).render('errors/500', {
    title: 'Ошибка',
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Salon app listening on http://localhost:${config.port}`);
  });
}

module.exports = app;