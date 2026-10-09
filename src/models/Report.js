'use strict';

// Модель отчётов администратора. 
 
const { pool, withTransaction } = require('../config/db');
const { ValidationError } = require('../errors');
const { isIsoDate, isPositiveInt } = require('../utils/validators');

function validatePeriod(from, to) {
  const details = {};
  if (!isIsoDate(from)) details.date_from = 'invalid';
  if (!isIsoDate(to)) details.date_to = 'invalid';
  if (Object.keys(details).length > 0) {
    throw new ValidationError('Некорректный период отчёта', details);
  }
  if (from > to) {
    throw new ValidationError('Дата "с" должна быть не позже даты "по"', {
      period: 'from_after_to',
    });
  }
  return { from: String(from), to: String(to) };
}

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function buildRevenue({ from, to } = {}) {
  const period = validatePeriod(from, to);

  const [rows] = await pool.query(
    `SELECT c.id AS category_id,
            c.name AS category_name,
            COUNT(a.id) AS cnt,
            COALESCE(SUM(a.actual_price), 0) AS revenue
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN service_categories c ON c.id = s.category_id
      WHERE a.status = 'Completed'
        AND DATE(a.start_at) BETWEEN ? AND ?
      GROUP BY c.id, c.name
      ORDER BY c.sort_order, c.name`,
    [period.from, period.to]
  );

  const items = rows.map((r, i) => ({
    label: String(r.category_name),
    value_num: toNumber(r.revenue),
    value_text: `${Number(r.cnt) || 0} записей`,
    sort_order: i,
  }));
  const total_amount = items.reduce((s, it) => s + it.value_num, 0);

  return {
    type: 'revenue',
    date_from: period.from,
    date_to: period.to,
    client_id: null,
    total_amount,
    items,
  };
}

async function buildMasterLoad({ from, to } = {}) {
  const period = validatePeriod(from, to);

  const [rows] = await pool.query(
    `SELECT mu.id AS master_id,
            mu.full_name AS master_name,
            COUNT(a.id) AS cnt,
            COALESCE(SUM(TIMESTAMPDIFF(MINUTE, a.start_at, a.end_at)), 0) AS total_min,
            COALESCE(SUM(a.actual_price), 0) AS revenue
       FROM users mu
       JOIN masters m ON m.user_id = mu.id
       LEFT JOIN appointments a ON a.master_id = mu.id
            AND a.status = 'Completed'
            AND DATE(a.start_at) BETWEEN ? AND ?
      GROUP BY mu.id, mu.full_name
      ORDER BY mu.full_name`,
    [period.from, period.to]
  );

  const items = rows.map((r, i) => {
    const cnt = Number(r.cnt) || 0;
    const totalMin = Number(r.total_min) || 0;
    return {
      label: String(r.master_name),
      value_num: toNumber(r.revenue),
      value_text: `${cnt} записей, ${totalMin} мин`,
      sort_order: i,
    };
  });
  const total_amount = items.reduce((s, it) => s + it.value_num, 0);

  return {
    type: 'master_load',
    date_from: period.from,
    date_to: period.to,
    client_id: null,
    total_amount,
    items,
  };
}

async function buildClientHistory({ clientId, from, to } = {}) {
  const cid = Number(clientId);
  if (!isPositiveInt(cid)) {
    throw new ValidationError('Некорректный идентификатор клиента', {
      client_id: 'invalid',
    });
  }
  const period = validatePeriod(from, to);

  const [rows] = await pool.query(
    `SELECT a.id, a.start_at, a.status, a.actual_price, a.base_price,
            s.name AS service_name,
            mu.full_name AS master_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users mu ON mu.id = a.master_id
      WHERE a.client_id = ?
        AND DATE(a.start_at) BETWEEN ? AND ?
      ORDER BY a.start_at DESC`,
    [cid, period.from, period.to]
  );

  const items = rows.map((r, i) => {
    const price = r.actual_price === null || r.actual_price === undefined
      ? 0
      : toNumber(r.actual_price);
    return {
      label: `${r.start_at} ${r.service_name}`,
      value_num: price,
      value_text: `${r.master_name} / ${r.status}`,
      sort_order: i,
    };
  });

  // Итоговая сумма — только по завершённым записям.
  const total_amount = rows.reduce((s, r) => {
    if (r.status === 'Completed') return s + toNumber(r.actual_price);
    return s;
  }, 0);

  return {
    type: 'client_history',
    date_from: period.from,
    date_to: period.to,
    client_id: cid,
    total_amount,
    items,
  };
}

async function persist(report, createdBy) {
  if (!report || typeof report !== 'object') {
    throw new ValidationError('report обязателен');
  }
  if (!['revenue', 'master_load', 'client_history'].includes(report.type)) {
    throw new ValidationError('Некорректный тип отчёта', { type: 'invalid' });
  }
  if (!isIsoDate(report.date_from) || !isIsoDate(report.date_to)) {
    throw new ValidationError('Некорректный период отчёта');
  }
  const author = Number(createdBy);
  if (!isPositiveInt(author)) {
    throw new ValidationError('Некорректный createdBy');
  }
  const clientId = report.client_id === null || report.client_id === undefined
    ? null
    : Number(report.client_id);
  if (clientId !== null && !isPositiveInt(clientId)) {
    throw new ValidationError('Некорректный client_id');
  }

  const insertId = await withTransaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO reports
         (type, date_from, date_to, client_id, created_by, total_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        report.type,
        report.date_from,
        report.date_to,
        clientId,
        author,
        report.total_amount !== undefined && report.total_amount !== null
          ? Number(report.total_amount)
          : null,
      ]
    );
    const reportId = res.insertId;

    const items = Array.isArray(report.items) ? report.items : [];
    if (items.length > 0) {
      const rows = items.map((it, i) => [
        reportId,
        String(it.label == null ? '' : it.label).slice(0, 255),
        it.value_num === null || it.value_num === undefined ? null : Number(it.value_num),
        it.value_text === null || it.value_text === undefined
          ? null
          : String(it.value_text).slice(0, 255),
        Number.isInteger(it.sort_order) ? it.sort_order : i,
      ]);
      await conn.query(
        `INSERT INTO report_items
           (report_id, label, value_num, value_text, sort_order)
         VALUES ?`,
        [rows]
      );
    }
    return reportId;
  });

  return findById(insertId);
}

async function findById(id) {
  const reportId = Number(id);
  if (!isPositiveInt(reportId)) return null;

  const [rows] = await pool.query(
    `SELECT id, type, date_from, date_to, client_id, created_by,
            created_at, total_amount
       FROM reports
      WHERE id = ?
      LIMIT 1`,
    [reportId]
  );
  if (!rows.length) return null;
  const r = rows[0];

  const [items] = await pool.query(
    `SELECT id, label, value_num, value_text, sort_order
       FROM report_items
      WHERE report_id = ?
      ORDER BY sort_order, id`,
    [reportId]
  );

  return {
    id: r.id,
    type: r.type,
    date_from: r.date_from,
    date_to: r.date_to,
    client_id: r.client_id,
    created_by: r.created_by,
    created_at: r.created_at,
    total_amount: r.total_amount === null || r.total_amount === undefined
      ? null
      : Number(r.total_amount),
    items: items.map((it) => ({
      id: it.id,
      label: it.label,
      value_num: it.value_num === null || it.value_num === undefined
        ? null
        : Number(it.value_num),
      value_text: it.value_text,
      sort_order: it.sort_order,
    })),
  };
}

async function list() {
  const [rows] = await pool.query(
    `SELECT r.id, r.type, r.date_from, r.date_to, r.client_id,
            r.created_by, r.created_at, r.total_amount,
            u.full_name AS creator_name
       FROM reports r
       JOIN users u ON u.id = r.created_by
      ORDER BY r.created_at DESC
      LIMIT 100`
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    date_from: r.date_from,
    date_to: r.date_to,
    client_id: r.client_id,
    created_by: r.created_by,
    created_at: r.created_at,
    total_amount: r.total_amount === null || r.total_amount === undefined
      ? null
      : Number(r.total_amount),
    creator_name: r.creator_name,
  }));
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(report) {
  if (!report || typeof report !== 'object') {
    throw new ValidationError('report обязателен для экспорта');
  }
  const items = Array.isArray(report.items) ? report.items : [];

  const lines = [];
  // Метаданные
  lines.push([
    csvEscape('type'), csvEscape(report.type || ''),
    csvEscape('from'), csvEscape(report.date_from || ''),
    csvEscape('to'), csvEscape(report.date_to || ''),
  ].join(','));
  // Заголовок
  lines.push(['label', 'value_num', 'value_text', 'sort_order'].join(','));
  // Строки
  for (const it of items) {
    lines.push([
      csvEscape(it.label),
      csvEscape(it.value_num === null || it.value_num === undefined ? '' : it.value_num),
      csvEscape(it.value_text == null ? '' : it.value_text),
      csvEscape(it.sort_order == null ? '' : it.sort_order),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  buildRevenue,
  buildMasterLoad,
  buildClientHistory,
  persist,
  findById,
  list,
  toCsv,
};