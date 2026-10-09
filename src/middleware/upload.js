'use strict';
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
};
const MAX_BYTES = 5 * 1024 * 1024;

function makeUpload(subdir) {
  const dest = path.join(__dirname, '..', '..', 'public', 'uploads', subdir);
  fs.mkdirSync(dest, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        const err = new Error('Допустимы только изображения формата JPEG, PNG или WebP');
        err.code = 'invalid_image_format';
        err.httpStatus = 400;
        return cb(err);
      }
      cb(null, true);
    },
  });
}

const uploadServiceImage = makeUpload('services').single('image');
const uploadMasterPhoto  = makeUpload('masters').single('photo');

module.exports = {
  uploadServiceImage,
  uploadMasterPhoto,
  ALLOWED_MIME,
  MAX_BYTES,
  EXT_BY_MIME,
  makeUpload, // экспорт для тестов
};