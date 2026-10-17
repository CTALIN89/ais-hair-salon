'use strict';

const db = require('../config/db');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
} = require('../errors');
const {
  isIsoDate,
  isPositiveInt,
  isSlotStep15,
} = require('../utils/validators');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

function parseTime(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] !== undefined ? Number(m[3]) : 0;
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) return null;
  if (!Number.isInteger(se) || se < 0 || se > 59) return null;
  return { h, m: mi };
}

function toMinutes(t) { return t.h * 60 + t.m; }

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDateTime(date, min) {
  return `${date} ${formatMinutes(min)}:00`;
}

function validateCreate(masterId, input) {
  const details = {};
  if (!isPositiveInt(masterId)) details.master_id = 'invalid';
  const { date, start, end, slot_min: slotMin, created_by: createdBy } = input || {};
  if (!isIsoDate(date)) details.date = 'invalid';
  const startParsed = parseTime(start);
  if (!startParsed) details.start = 'invalid';
  const endParsed = parseTime(end);
  if (!endParsed) details.end = 'invalid';
  if (!isSlotStep15(slotMin)) details.slot_min = 'invalid';
  if (!isPositiveInt(createdBy)) details.created_by = 'invalid';

  if (startParsed && endParsed && isSlotStep15(slotMin)) {
    const startMin = toMinutes(startParsed);
    const endMin = toMinutes(endParsed);
    if (!(startMin < endMin)) details.range = 'start_must_be_before_end';
    else if ((endMin - startMin) % slotMin !== 0) details.range = 'duration_not_multiple_of_slot_min';
  }

  if (Object.keys(details).length > 0) {
    throw new ValidationError('Некорректные параметры расписания', details);
  }

  return {
    masterId, date,
    startMin: toMinutes(startParsed),
    endMin: toMinutes(endParsed),
    startTime: `${formatMinutes(toMinutes(startParsed))}:00`,
    endTime: `${formatMinutes(toMinutes(endParsed))}:00`,
    slotMin, createdBy,
  };
}

async function create(masterId, input) {
  const v = validateCreate(Number(masterId), input);

  return db.withTransaction(async (conn) => {
    const [existing] = await conn.query(
      `SELECT id FROM schedules WHERE master_id = ? AND work_date = ? FOR UPDATE`,
      [v.masterId, v.date]
    );
    if (existing.length > 0) {
      throw new ConflictError('Расписание на эту дату уже существует', { code: 'schedule_exists' });
    }

    const [schRes] = await conn.query(
      `INSERT INTO schedules (master_id, work_date, start_time, end_time, slot_min, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [v.masterId, v.date, v.startTime, v.endTime, v.slotMin, v.createdBy]
    );
    const scheduleId = schRes[0].id;

    const count = (v.endMin - v.startMin) / v.slotMin;
    const rows = new Array(count);
    for (let k = 0; k < count; k++) {
      const a = v.startMin + k * v.slotMin;
      const b = a + v.slotMin;
      rows[k] = [scheduleId, v.masterId, v.date, formatDateTime(v.date, a), formatDateTime(v.date, b), 'free'];
    }

    if (rows.length > 0) {
      await conn.query(
        `INSERT INTO time_slots (schedule_id, master_id, slot_date, slot_start, slot_end, status) VALUES ?`,
        [rows]
      );
    }

    return {
      id: scheduleId, master_id: v.masterId, work_date: v.date,
      start_time: v.startTime, end_time: v.endTime, slot_min: v.slotMin,
      created_by: v.createdBy, slots_created: rows.length,
    };
  });
}

async function listByMaster(masterId, filters = {}) {
  const { from, to } = filters || {};
  const where = ['s.master_id = ?'];
  const params = [masterId];

  if (from !== undefined && from !== null) {
    if (!isIsoDate(from)) throw new ValidationError('Некорректная дата `from`', { from: 'invalid' });
    where.push('s.work_date >= ?'); params.push(from);
  }
  if (to !== undefined && to !== null) {
    if (!isIsoDate(to)) throw new ValidationError('Некорректная дата `to`', { to: 'invalid' });
    where.push('s.work_date <= ?'); params.push(to);
  }

  const [rows] = await db.query(
    `SELECT s.id, s.master_id, s.work_date, s.start_time, s.end_time, s.slot_min, s.created_by,
            COALESCE(agg.total, 0) AS slots_total,
            COALESCE(agg.free_cnt, 0) AS slots_free,
            COALESCE(agg.busy_cnt, 0) AS slots_busy
       FROM schedules s
       LEFT JOIN (
         SELECT schedule_id, COUNT(*) AS total,
                SUM(CASE WHEN status = 'free' THEN 1 ELSE 0 END) AS free_cnt,
                SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) AS busy_cnt
           FROM time_slots GROUP BY schedule_id
       ) agg ON agg.schedule_id = s.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.work_date`,
    params
  );
  return rows.map((r) => ({
    ...r,
    slots_total: Number(r.slots_total) || 0,
    slots_free: Number(r.slots_free) || 0,
    slots_busy: Number(r.slots_busy) || 0,
  }));
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT id, master_id, work_date, start_time, end_time, slot_min, created_by FROM schedules WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function remove(scheduleId) {
  return db.withTransaction(async (conn) => {
    const [schedules] = await conn.query(`SELECT id FROM schedules WHERE id = ? FOR UPDATE`, [scheduleId]);
    if (schedules.length === 0) throw new NotFoundError('Расписание не найдено');

    const [active] = await conn.query(
      `SELECT DISTINCT a.id FROM appointments a
         JOIN appointment_time_slots ats ON ats.appointment_id = a.id
         JOIN time_slots ts ON ts.id = ats.time_slot_id
        WHERE ts.schedule_id = ? AND a.status IN ('Created', 'Confirmed', 'InService', 'Rescheduled')`,
      [scheduleId]
    );
    if (active.length > 0) {
      throw new ConflictError('Нельзя удалить расписание с активными записями', {
        code: 'schedule_in_use', details: { appointments: active.map((r) => r.id) },
      });
    }
    await conn.query(`DELETE FROM schedules WHERE id = ?`, [scheduleId]);
    return { id: scheduleId };
  });
}

async function listAll({ q = '' } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, ['u.full_name', 's.work_date::text']);
  
  const [rows] = await db.query(
    `SELECT s.id, s.master_id, s.work_date, s.start_time, s.end_time, s.slot_min, s.created_by,
            u.full_name AS master_name,
            COALESCE(agg.total, 0) AS slots_total,
            COALESCE(agg.free_cnt, 0) AS slots_free,
            COALESCE(agg.busy_cnt, 0) AS slots_busy
       FROM schedules s
       JOIN users u ON u.id = s.master_id
       LEFT JOIN (
         SELECT schedule_id, COUNT(*) AS total,
                SUM(CASE WHEN status = 'free' THEN 1 ELSE 0 END) AS free_cnt,
                SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) AS busy_cnt
           FROM time_slots GROUP BY schedule_id
       ) agg ON agg.schedule_id = s.id
      WHERE 1 = 1 ${filter.where}
      ORDER BY s.work_date DESC, u.full_name`,
    filter.params
  );
  return rows.map((r) => ({
    ...r,
    slots_total: Number(r.slots_total) || 0,
    slots_free: Number(r.slots_free) || 0,
    slots_busy: Number(r.slots_busy) || 0,
  }));
}

module.exports = { create, listByMaster, listAll, findById, remove };