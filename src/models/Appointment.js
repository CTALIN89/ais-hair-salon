'use strict';

const db = require('../config/db');
const TimeSlot = require('./TimeSlot');
const Service = require('./Service');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  SlotUnavailableError,
  InvalidTransitionError,
} = require('../errors');
const { isPositiveInt, isNonNegativeNumber } = require('../utils/validators');
const { buildIlikeFilter, validateQuery } = require('../services/Search_Service');

const APPOINTMENT_SEARCH_FIELDS = [
  'cu.full_name',
  'mu.full_name',
  's.name',
  "TO_CHAR(a.start_at, 'YYYY-MM-DD HH24:MI')",
  'a.status',
];

const ALLOWED_TRANSITIONS = Object.freeze({
  Created:     Object.freeze(['Confirmed', 'Cancelled', 'Rescheduled']),
  Confirmed:   Object.freeze(['InService', 'Cancelled', 'Rescheduled', 'Created']),
  InService:   Object.freeze(['Completed', 'Cancelled', 'Confirmed']),
  Rescheduled: Object.freeze(['Confirmed', 'Cancelled', 'Created']),
  Completed:   Object.freeze(['Archived', 'InService']),
  Cancelled:   Object.freeze(['Archived', 'Created']),
  Archived:    Object.freeze([]),
});

const ACTIVE_STATUSES = Object.freeze(['Created', 'Confirmed', 'InService', 'Rescheduled']);
const HISTORY_STATUSES = Object.freeze(['Completed', 'Cancelled', 'Archived']);

function readRoleCode(user) {
  if (!user) return null;
  if (user.role && typeof user.role === 'object' && user.role.code) return String(user.role.code);
  if (user.role_code) return String(user.role_code);
  if (typeof user.role === 'string') return user.role;
  return null;
}

function assertTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidTransitionError(`Недопустимый переход статуса: ${from} → ${to}`, { from, to });
  }
}

function assertRoleCanTransition(byUser, appointment, from, to) {
  const role = readRoleCode(byUser);
  if (!role || !byUser || byUser.id == null) throw new ForbiddenError('Недостаточно прав для смены статуса записи');
  if (role === 'admin') return;

  const isMasterSelf = role === 'master' && byUser.id === appointment.master_id;
  const isClientSelf = role === 'client' && byUser.id === appointment.client_id;
  const key = `${from}->${to}`;

  switch (key) {
    case 'Created->Confirmed':
    case 'Rescheduled->Confirmed':
    case 'Confirmed->InService':
    case 'InService->Completed':
      if (!isMasterSelf) throw new ForbiddenError('Этот переход доступен только назначенному мастеру');
      return;
    case 'Created->Cancelled':
    case 'Created->Rescheduled':
    case 'Confirmed->Cancelled':
    case 'Confirmed->Rescheduled':
    case 'InService->Cancelled':
    case 'Rescheduled->Cancelled':
      if (!isClientSelf && !isMasterSelf) throw new ForbiddenError('Отмену или перенос может выполнить владелец записи или мастер');
      return;
    default:
      throw new ForbiddenError('Переход запрещён для текущей роли');
  }
}

async function loadSlotIds(conn, appointmentId) {
  const [rows] = await conn.query(`SELECT time_slot_id FROM appointment_time_slots WHERE appointment_id = ?`, [appointmentId]);
  return rows.map((r) => r.time_slot_id);
}

async function insertHistory(conn, appointmentId, fromStatus, toStatus, changedBy, comment) {
  await conn.query(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by, comment) VALUES (?, ?, ?, ?, ?)`,
    [appointmentId, fromStatus, toStatus, changedBy, comment ?? null]
  );
}

async function computeChainRange(conn, slotIds) {
  const [rows] = await conn.query(
    `SELECT MIN(slot_start) AS start_at, MAX(slot_end) AS end_at FROM time_slots WHERE id IN (?)`,
    [slotIds]
  );
  return rows[0];
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at, a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name AS service_name, s.duration_min AS service_duration_min,
            mu.full_name AS master_name, cu.full_name AS client_name, cu.phone AS client_phone
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users mu ON mu.id = a.master_id
       JOIN users cu ON cu.id = a.client_id
      WHERE a.id = ? LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const [slotRows] = await db.query(`SELECT time_slot_id FROM appointment_time_slots WHERE appointment_id = ? ORDER BY time_slot_id`, [id]);
  return { ...rows[0], slot_ids: slotRows.map((r) => r.time_slot_id) };
}

async function create({ clientId, masterId, serviceId, timeSlotId }) {
  if (!isPositiveInt(clientId) || !isPositiveInt(masterId) || !isPositiveInt(serviceId) || !isPositiveInt(timeSlotId)) {
    throw new ValidationError('Все поля обязательны и должны быть положительными целыми');
  }

  const service = await Service.findById(serviceId);
  if (!service) throw new NotFoundError('Услуга не найдена');
  if (!service.is_active) throw new ValidationError('Услуга неактивна');

  const startSlot = await TimeSlot.findById(timeSlotId);
  if (!startSlot) throw new SlotUnavailableError('Выбранный слот не найден');
  if (startSlot.master_id !== Number(masterId)) throw new SlotUnavailableError('Слот принадлежит другому мастеру');

  const chain = await TimeSlot.getChainStartingAt(timeSlotId, service.duration_min);
  if (!chain) throw new SlotUnavailableError('Недостаточно свободных слотов для услуги');

  return db.withTransaction(async (conn) => {
    const locked = await TimeSlot.lockForUpdate(conn, chain.ids);
    if (locked.length !== chain.ids.length || locked.some((row) => row.status !== 'free')) {
      throw new SlotUnavailableError('Выбранные слоты уже заняты');
    }

    const [linkRows] = await conn.query(`SELECT 1 FROM master_services WHERE master_id = ? AND service_id = ? LIMIT 1`, [masterId, serviceId]);
    if (linkRows.length === 0) throw new ValidationError('Мастер не оказывает эту услугу');

    const range = await computeChainRange(conn, chain.ids);

    const [insert] = await conn.query(
      `INSERT INTO appointments (client_id, master_id, service_id, start_at, end_at, status, base_price) VALUES (?, ?, ?, ?, ?, 'Created', ?) RETURNING id`,
      [clientId, masterId, serviceId, range.start_at, range.end_at, service.base_price]
    );
    const appointmentId = insert[0].id;

    const valueRows = chain.ids.map((sid) => [appointmentId, sid]);
    await conn.query(`INSERT INTO appointment_time_slots (appointment_id, time_slot_id) VALUES ?`, [valueRows]);
    await conn.query(`UPDATE time_slots SET status = 'busy' WHERE id IN (?)`, [chain.ids]);
    await insertHistory(conn, appointmentId, null, 'Created', clientId, null);

    return appointmentId;
  }).then((id) => findById(id));
}

function statusFilter(status) {
  if (status === 'active') return { where: ` AND a.status IN (?) `, params: [ACTIVE_STATUSES.slice()], order: ' ORDER BY a.start_at ASC ' };
  if (status === 'history') return { where: ` AND a.status IN (?) `, params: [HISTORY_STATUSES.slice()], order: ' ORDER BY a.start_at DESC ' };
  return { where: '', params: [], order: ' ORDER BY a.start_at DESC ' };
}

async function listForClient(clientId, { status } = {}) {
  if (!isPositiveInt(clientId)) throw new ValidationError('clientId обязателен');
  const f = statusFilter(status);
  const [rows] = await db.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at, a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name AS service_name, s.duration_min AS service_duration_min, mu.full_name AS master_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users mu ON mu.id = a.master_id
      WHERE a.client_id = ? ${f.where} ${f.order}`,
    [clientId, ...f.params]
  );
  return rows;
}

async function listForMaster(masterId, { status } = {}) {
  if (!isPositiveInt(masterId)) throw new ValidationError('masterId обязателен');
  const f = statusFilter(status);
  const [rows] = await db.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at, a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name AS service_name, s.duration_min AS service_duration_min, cu.full_name AS client_name, cu.phone AS client_phone
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users cu ON cu.id = a.client_id
      WHERE a.master_id = ? ${f.where} ${f.order}`,
    [masterId, ...f.params]
  );
  return rows;
}

async function cancel(id, byUser, { comment = null } = {}) {
  if (!isPositiveInt(Number(id))) throw new ValidationError('id записи обязателен');
  await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT id, client_id, master_id, status FROM appointments WHERE id = ? FOR UPDATE`, [id]);
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];
    assertTransition(appointment.status, 'Cancelled');
    assertRoleCanTransition(byUser, appointment, appointment.status, 'Cancelled');

    const slotIds = await loadSlotIds(conn, id);
    if (slotIds.length > 0) await conn.query(`UPDATE time_slots SET status = 'free' WHERE id IN (?)`, [slotIds]);
    await conn.query(`UPDATE appointments SET status = 'Cancelled' WHERE id = ?`, [id]);
    await insertHistory(conn, id, appointment.status, 'Cancelled', byUser.id, comment);
  });
  return findById(id);
}

async function reschedule(id, byUser, newTimeSlotId, { comment = null } = {}) {
  if (!isPositiveInt(Number(id))) throw new ValidationError('id записи обязателен');
  if (!isPositiveInt(Number(newTimeSlotId))) throw new ValidationError('Не указан новый слот');
  await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT id, client_id, master_id, service_id, status FROM appointments WHERE id = ? FOR UPDATE`, [id]);
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];
    assertTransition(appointment.status, 'Rescheduled');
    assertRoleCanTransition(byUser, appointment, appointment.status, 'Rescheduled');

    const service = await Service.findById(appointment.service_id);
    if (!service) throw new NotFoundError('Услуга не найдена');

    const newStart = await TimeSlot.findById(newTimeSlotId);
    if (!newStart) throw new SlotUnavailableError('Новый слот не найден');
    if (newStart.master_id !== appointment.master_id) throw new SlotUnavailableError('Новый слот принадлежит другому мастеру');

    const chain = await TimeSlot.getChainStartingAt(newTimeSlotId, service.duration_min);
    if (!chain) throw new SlotUnavailableError('Недостаточно свободных слотов для переноса');

    const oldIds = await loadSlotIds(conn, id);
    if (oldIds.length > 0) {
      await conn.query(`UPDATE time_slots SET status = 'free' WHERE id IN (?)`, [oldIds]);
      await conn.query(`DELETE FROM appointment_time_slots WHERE appointment_id = ?`, [id]);
    }

    const locked = await TimeSlot.lockForUpdate(conn, chain.ids);
    if (locked.length !== chain.ids.length || locked.some((row) => row.status !== 'free')) {
      throw new SlotUnavailableError('Выбранные слоты уже заняты');
    }

    const range = await computeChainRange(conn, chain.ids);
    const valueRows = chain.ids.map((sid) => [id, sid]);
    await conn.query(`INSERT INTO appointment_time_slots (appointment_id, time_slot_id) VALUES ?`, [valueRows]);
    await conn.query(`UPDATE time_slots SET status = 'busy' WHERE id IN (?)`, [chain.ids]);
    await conn.query(`UPDATE appointments SET start_at = ?, end_at = ?, status = 'Rescheduled', updated_at = NOW() WHERE id = ?`, [range.start_at, range.end_at, id]);
    await insertHistory(conn, id, appointment.status, 'Rescheduled', byUser.id, comment);
  });
  return findById(id);
}

async function setStatus(id, byUser, newStatus, { actualPrice, comment = null } = {}) {
  if (!isPositiveInt(Number(id))) throw new ValidationError('id записи обязателен');
  if (typeof newStatus !== 'string') throw new ValidationError('Целевой статус обязателен');
  if (newStatus === 'Rescheduled') throw new ValidationError('Для переноса используйте операцию reschedule');

  await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT id, client_id, master_id, service_id, status, base_price FROM appointments WHERE id = ? FOR UPDATE`, [id]);
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];
    assertTransition(appointment.status, newStatus);
    assertRoleCanTransition(byUser, appointment, appointment.status, newStatus);

    const sets = ['status = ?'];
    const params = [newStatus];
    if (newStatus === 'Completed') {
      const price = Number(actualPrice);
      if (!isNonNegativeNumber(price)) throw new ValidationError('Некорректная фактическая стоимость');
      sets.push('actual_price = ?');
      params.push(price);
    }
    if (newStatus === 'Cancelled') {
      const slotIds = await loadSlotIds(conn, id);
      if (slotIds.length > 0) await conn.query(`UPDATE time_slots SET status = 'free' WHERE id IN (?)`, [slotIds]);
    }
    params.push(id);
    await conn.query(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, params);
    await insertHistory(conn, id, appointment.status, newStatus, byUser.id, comment);
  });
  return findById(id);
}

async function listAll({ q = '' } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, APPOINTMENT_SEARCH_FIELDS);
  const [rows] = await db.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at, a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name AS service_name, s.duration_min AS service_duration_min, cu.full_name AS client_name, mu.full_name AS master_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users cu ON cu.id = a.client_id
       JOIN users mu ON mu.id = a.master_id
      WHERE 1 = 1 ${filter.where}
      ORDER BY a.start_at DESC`,
    filter.params
  );
  return rows;
}

async function setStatusForce(id, byUser, newStatus, { comment = null, actualPrice } = {}) {
  if (!isPositiveInt(Number(id))) throw new ValidationError('id записи обязателен');
  const allTargets = ['Created', 'Confirmed', 'InService', 'Completed', 'Cancelled', 'Rescheduled'];
  if (!allTargets.includes(newStatus)) throw new ValidationError('Недопустимое значение статуса');
  const role = readRoleCode(byUser);
  if (!role) throw new ForbiddenError('Не указана роль пользователя');

  let result = null;
  await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT id, client_id, master_id, service_id, status, base_price FROM appointments WHERE id = ? FOR UPDATE`, [id]);
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];

    if (role === 'admin') { /* ok */ }
    else if (role === 'master') {
      if (Number(appointment.master_id) !== Number(byUser.id)) throw new ForbiddenError('Нет доступа к чужой записи');
    } else if (role === 'client') {
      if (Number(appointment.client_id) !== Number(byUser.id)) throw new ForbiddenError('Нет доступа к чужой записи');
      if (newStatus !== 'Cancelled') throw new ForbiddenError('Клиент может только отменять свои записи');
      if (!['Created', 'Confirmed', 'Rescheduled'].includes(appointment.status)) throw new ForbiddenError('Запись в этом статусе не может быть отменена клиентом');
    } else throw new ForbiddenError('Недостаточно прав');

    if (appointment.status === newStatus) { result = { id: appointment.id, status: appointment.status, idempotent: true }; return; }

    if (newStatus === 'Cancelled') {
      const slotIds = await loadSlotIds(conn, id);
      if (slotIds.length > 0) await conn.query(`UPDATE time_slots SET status = 'free' WHERE id IN (?)`, [slotIds]);
    }

    const sets = ['status = ?', 'updated_at = NOW()'];
    const params = [newStatus];
    if (newStatus === 'Completed' && actualPrice !== undefined) {
      const price = Number(actualPrice);
      if (isNonNegativeNumber(price)) { sets.push('actual_price = ?'); params.push(price); }
    }
    params.push(id);
    await conn.query(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, params);
    await insertHistory(conn, id, appointment.status, newStatus, byUser.id, comment);
  });

  if (result && result.idempotent) { const fresh = await findById(id); return { ...fresh, idempotent: true }; }
  return findById(id);
}

async function removeAppointment(id) {
  if (!isPositiveInt(Number(id))) throw new ValidationError('id записи обязателен');
  await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT id FROM appointments WHERE id = ? FOR UPDATE`, [id]);
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const slotIds = await loadSlotIds(conn, id);
    if (slotIds.length > 0) await conn.query(`UPDATE time_slots SET status = 'free' WHERE id IN (?)`, [slotIds]);
    await conn.query(`DELETE FROM appointments WHERE id = ?`, [id]);
  });
}

module.exports = {
  ALLOWED_TRANSITIONS,
  create, findById, listForClient, listForMaster, listAll,
  cancel, reschedule, setStatus, setStatusForce, remove: removeAppointment,
};