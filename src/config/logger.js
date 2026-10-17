'use strict';

const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');

const logDir = path.join(__dirname, '..', '..', 'logs');

const logger = winston.createLogger({
  // level: process.env.LOG_LEVEL || 'info', // Переменная LOG_LEVEL закомментирована
  level: 'info', // Установлен уровень по умолчанию
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'salon-app' },
  transports: [
    // Ошибки — в error.log
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
    }),
    // Все логи — в combined.log
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
  ],
});

// В dev — также выводить в консоль
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

module.exports = logger;