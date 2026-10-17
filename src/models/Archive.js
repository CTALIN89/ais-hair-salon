'use strict';

const db = require('../config/db');
const { ValidationError, ConflictError } = require('../errors');
const { isIsoDate, isPositiveInt } = require('../utils/validators');

async function create({ from, to, createdBy } = {}) {
  const errors = {};
  if (!isIsoDate(from)) errors.date_from = 'invalid';
  if (!isIsoDate(to)) errors.date_to = 'invalid';
  const author = Number(createdBy);
  if (!isPositiveInt(author)) errors.created_by = 'invalid';
  if (!errors.date_from && !errors.date_to && from > to) errors.period = 'from_after_to';
  if (Object.keys(errors).length > 0) throw new ValidationError('Некорректные параметры архивации', errors);

  const archiveId = await db.withTransaction(async (conn) => {
    const [overlaps] = await conn.query(
      `SELECT id, date_from, date_to FROM archives WHERE NOT (date_to < ? OR date_from > ?) FOR UPDATE`,
      [from, to]
    );
    if (overlaps.length > 0) {
      throw new ConflictError('Период пересекается с существующим архивом', { code: 'archive_period_overlap', details: { overlaps } });
    }

    const [appointments] = await conn.query(
      `SELECT id, client_id, master_id, service_id, start_at, end_at, status, actual_price, base_price, created_at, updated_at
         FROM appointments
        WHERE status IN ('Completed', 'Cancelled')
          AND start_at::date BETWEEN ? AND ?
        FOR UPDATE`,
      [from, to]
    );

    const [ins] = await conn.query(
      `INSERT INTO archives (date_from, date_to, created_by) VALUES (?, ?, ?) RETURNING id`,
      [from, to, author]
    );
    const newArchiveId = ins[0].id;

    if (appointments.length > 0) {
      const rows = appointments.map((a) => [
        newArchiveId, a.id, a.client_id, a.master_id, a.service_id,
        a.start_at, a.end_at, String(a.status),
        a.actual_price === null || a.actual_price === undefined ? null : Number(a.actual_price),
        JSON.stringify(a)
      ]);
      await conn.query(
        `INSERT INTO archived_appointments (archive_id, source_appointment_id, client_id, master_id, service_id, start_at, end_at, status_before, actual_price, payload) VALUES ?`,
        [rows]
      );

      const ids = appointments.map((a) => a.id);
      await conn.query(`UPDATE appointments SET status = 'Archived' WHERE id IN (?)`, [ids]);
    }
    return newArchiveId;
  });

  return findById(archiveId);
}

async function findById(id) {
  const archiveId = Number(id);
  if (!isPositiveInt(archiveId)) return null;

  const [rows] = await db.query(
    `SELECT a.id, a.date_from, a.date_to, a.created_by, a.created_at, u.full_name AS creator_name
       FROM archives a JOIN users u ON u.id = a.created_by WHERE a.id = ? LIMIT 1`,
    [archiveId]
  );
  if (!rows.length) return null;
  const r = rows[0];

  const [items] = await db.query(
    `SELECT id, archive_id, source_appointment_id, client_id, master_id, service_id, start_at, end_at, status_before, actual_price, payload
       FROM archived_appointments WHERE archive_id = ? ORDER BY start_at, id`,
    [archiveId]
  );

  return {
    id: r.id, date_from: r.date_from, date_to: r.date_to, created_by: r.created_by, creator_name: r.creator_name, created_at: r.created_at,
    items: items.map((it) => ({
      ...it,
      source_appointment_id: it.source_appointment_id === null || it.source_appointment_id === undefined ? null : Number(it.source_appointment_id),
      actual_price: it.actual_price === null || it.actual_price === undefined ? null : Number(it.actual_price),
    })),
  };
}

async function list() {
  const [rows] = await db.query(
    `SELECT a.id, a.date_from, a.date_to, a.created_by, a.created_at, u.full_name AS creator_name, COUNT(aa.id) AS items_count
       FROM archives a
       JOIN users u ON u.id = a.created_by
       LEFT JOIN archived_appointments aa ON aa.archive_id = a.id
      GROUP BY a.id, a.date_from, a.date_to, a.created_by, a.created_at, u.full_name
      ORDER BY a.created_at DESC LIMIT 100`
  );
  return rows.map((r) => ({
    ...r,
    items_count: Number(r.items_count) || 0,
  }));
}

module.exports = { create, findById, list };