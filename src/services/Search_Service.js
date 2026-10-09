'use strict';

function buildIlikeFilter(query, fields, startIndex = 1) {
  const trimmed = (query == null ? '' : String(query)).trim();
  if (!trimmed || !fields || fields.length === 0) {
    return { where: '', params: [], nextIndex: startIndex };
  }
  // Экранирование спецсимволов LIKE: \, %, _.
  const escaped = trimmed.replace(/[\\%_]/g, (c) => '\\' + c);
  const like = `%${escaped}%`;
  const clauses = fields.map((f) => `LOWER(${f}) LIKE LOWER(?)`);
  return {
    where: ` AND (${clauses.join(' OR ')}) `,
    params: fields.map(() => like),
    nextIndex: startIndex + fields.length,
  };
}

function validateQuery(q) {
  if (q === undefined || q === null || q === '') return '';
  if (typeof q !== 'string') {
    const err = new Error('Параметр q должен быть строкой');
    err.code = 'invalid_query';
    err.httpStatus = 400;
    throw err;
  }
  const trimmed = q.trim();
  if (trimmed.length > 200) {
    const err = new Error('Параметр q не должен превышать 200 символов');
    err.code = 'invalid_query';
    err.httpStatus = 400;
    throw err;
  }
  return trimmed;
}

module.exports = { buildIlikeFilter, validateQuery };