'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../config/db');
const { ValidationError, NotFoundError } = require('../errors');
const { isPositiveInt } = require('../utils/validators');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function safeUnlink(absPath) {
  try {
    fs.unlinkSync(absPath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.warn('[media] file already missing on unlink:', absPath);
      return false;
    }
    throw err;
  }
}

function resolvePublicPath(relUrl) {
  if (!relUrl) return null;
  // Убираем ведущий слеш, чтобы path.join не считал URL абсолютным.
  const stripped = relUrl.replace(/^\/+/, '');
  return path.join(PUBLIC_DIR, stripped);
}

function normalizeMulterError(err) {
  if (!err) return null;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new ValidationError('Размер файла превышает 5 МБ', {
        code: 'image_too_large',
      });
    }
    return new ValidationError('Ошибка загрузки файла: ' + err.code, {
      code: 'multer_error',
    });
  }
  if (err.code === 'invalid_image_format') {
    return new ValidationError('Допустимы только изображения формата JPEG, PNG или WebP', {
      code: 'invalid_image_format',
    });
  }
  return err;
}

async function uploadImageGeneric({ subdir, urlField, table, idField }, req, res, next) {
  try {
    if (!req.file) {
      // Это случай fileFilter-rejection до сохранения; multer не выкинул error
      // (например, multipart без поля), а просто не приложил файл.
      return next(new ValidationError('Файл не загружен', {
        code: 'image_missing',
      }));
    }

    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      // Удаляем уже сохранённый файл, прежде чем отвечать ошибкой.
      safeUnlink(req.file.path);
      return next(new ValidationError('Некорректный идентификатор сущности'));
    }

    // Проверяем, что сущность существует.
    const [rows] = await db.query(
      `SELECT ${idField} AS id, ${urlField} AS old_url FROM ${table} WHERE ${idField} = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      safeUnlink(req.file.path);
      return next(new NotFoundError('Сущность не найдена'));
    }
    const oldUrl = rows[0].old_url;

    const newUrl = `/uploads/${subdir}/${path.basename(req.file.path)}`;

    await db.query(
      `UPDATE ${table} SET ${urlField} = ? WHERE ${idField} = ?`,
      [newUrl, id]
    );

    // После коммита (db.query без транзакции уже зафиксирован) удаляем старый файл.
    if (oldUrl && oldUrl !== newUrl) {
      const oldAbs = resolvePublicPath(oldUrl);
      if (oldAbs) safeUnlink(oldAbs);
    }

    res.json({ id, [urlField]: newUrl });
  } catch (err) {
    // При любой ошибке после сохранения файла — удалить его, чтобы не оставлять мусор.
    if (req.file && req.file.path) {
      try { safeUnlink(req.file.path); } catch (_) { /* ignore */ }
    }
    next(err);
  }
}

/**
 * Базовая логика удаления изображения.
 */
async function deleteImageGeneric({ urlField, table, idField }, req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      return next(new ValidationError('Некорректный идентификатор сущности'));
    }
    const [rows] = await db.query(
      `SELECT ${idField} AS id, ${urlField} AS old_url FROM ${table} WHERE ${idField} = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return next(new NotFoundError('Сущность не найдена'));
    const oldUrl = rows[0].old_url;

    await db.query(
      `UPDATE ${table} SET ${urlField} = NULL WHERE ${idField} = ?`,
      [id]
    );

    if (oldUrl) {
      const abs = resolvePublicPath(oldUrl);
      if (abs) safeUnlink(abs);
    }

    res.json({ id, [urlField]: null });
  } catch (err) {
    next(err);
  }
}

async function uploadServiceImage(req, res, next) {
  return uploadImageGeneric(
    { subdir: 'services', urlField: 'image_url', table: 'services', idField: 'id' },
    req, res, next
  );
}
async function deleteServiceImage(req, res, next) {
  return deleteImageGeneric(
    { urlField: 'image_url', table: 'services', idField: 'id' },
    req, res, next
  );
}
async function uploadMasterPhoto(req, res, next) {
  return uploadImageGeneric(
    { subdir: 'masters', urlField: 'photo_url', table: 'masters', idField: 'user_id' },
    req, res, next
  );
}
async function deleteMasterPhoto(req, res, next) {
  return deleteImageGeneric(
    { urlField: 'photo_url', table: 'masters', idField: 'user_id' },
    req, res, next
  );
}

module.exports = {
  uploadServiceImage,
  deleteServiceImage,
  uploadMasterPhoto,
  deleteMasterPhoto,
  normalizeMulterError,
};