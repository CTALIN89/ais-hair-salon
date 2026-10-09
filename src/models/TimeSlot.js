'use strict';

const db = require('../config/db');
const { SlotUnavailableError, NotFoundError } = require('../errors');

// Модель доступа к таблице `time_slots`. 
 
function parseMysqlDateTime(s) {
  const [datePart, timePart = '00:00:00'] = String(s).split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, se = 0] = timePart.split(':').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, se || 0);
}

function minutesBetween(startStr, endStr) {
  const a = parseMysqlDateTime(startStr);
  const b = parseMysqlDateTime(endStr);
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

async function listForMasterOnDate(masterId, date) {
  const [rows] = await db.query(
    `SELECT id, schedule_id, master_id, slot_date, slot_start, slot_end, status
       FROM time_slots
      WHERE master_id = ? AND slot_date = ?
      ORDER BY slot_start`,
    [masterId, date]
  );
  return rows;
}

async function freeForService(masterId, date, durationMin) {
  if (!Number.isFinite(durationMin) || durationMin <= 0) return [];

  const slots = await listForMasterOnDate(masterId, date);
  if (slots.length === 0) return [];

  const result = [];

  for (let i = 0; i < slots.length; i++) {
    const startSlot = slots[i];
    if (startSlot.status !== 'free') continue;

    const stepMin = minutesBetween(startSlot.slot_start, startSlot.slot_end);
    if (stepMin <= 0) continue;

    const required = Math.ceil(durationMin / stepMin);

    // Набираем цепочку подряд идущих free-слотов длины required.
    let ok = true;
    let lastEnd = startSlot.slot_end;
    for (let k = 1; k < required; k++) {
      const next = slots[i + k];
      if (
        !next ||
        next.status !== 'free' ||
        next.slot_start !== lastEnd
      ) {
        ok = false;
        break;
      }
      lastEnd = next.slot_end;
    }
    if (!ok) continue;

    result.push({
      id: startSlot.id,
      slot_start: startSlot.slot_start,
      slot_end_effective: lastEnd,
      duration_min: required * stepMin,
    });
  }

  return result;
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT id, schedule_id, master_id, slot_date, slot_start, slot_end, status
       FROM time_slots
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getChainStartingAt(startSlotId, durationMin) {
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;

  const start = await findById(startSlotId);
  if (!start) return null;
  if (start.status !== 'free') return null;

  const stepMin = minutesBetween(start.slot_start, start.slot_end);
  if (stepMin <= 0) return null;
  const required = Math.ceil(durationMin / stepMin);

  // Берём с запасом: required слотов, начиная со стартового (slot_start >= start).
  const [rows] = await db.query(
    `SELECT id, slot_start, slot_end, status
       FROM time_slots
      WHERE master_id = ? AND slot_date = ? AND slot_start >= ?
      ORDER BY slot_start
      LIMIT ?`,
    [start.master_id, start.slot_date, start.slot_start, required]
  );

  if (rows.length < required) return null;

  const ids = [];
  let lastEnd = null;
  let total = 0;
  for (let k = 0; k < required; k++) {
    const cur = rows[k];
    if (cur.status !== 'free') return null;
    if (lastEnd !== null && cur.slot_start !== lastEnd) return null;
    ids.push(cur.id);
    total += minutesBetween(cur.slot_start, cur.slot_end);
    lastEnd = cur.slot_end;
  }

  if (total < durationMin) return null;
  return { ids, total_min: total };
}

async function setStatus(ids, status) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  if (status !== 'free' && status !== 'busy') {
    throw new Error(`Unsupported time_slot status: ${status}`);
  }
  const [res] = await db.query(
    `UPDATE time_slots SET status = ? WHERE id IN (?)`,
    [status, ids]
  );
  return res.affectedRows || 0;
}

async function lockForUpdate(conn, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const [rows] = await conn.query(
    `SELECT id, status FROM time_slots WHERE id IN (?) FOR UPDATE`,
    [ids]
  );
  return rows;
}

module.exports = {
  listForMasterOnDate,
  freeForService,
  findById,
  getChainStartingAt,
  setStatus,
  lockForUpdate,
};