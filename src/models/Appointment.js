'use strict';

const { pool, withTransaction } = require('../config/db');
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
  "DATE_FORMAT(a.start_at, '%Y-%m-%d %H:%i')",
  'a.status',
];

const ALLOWED_TRANSITIONS = Object.freeze({
  // Прямые переходы 
  Created:     Object.freeze(['Confirmed', 'Cancelled', 'Rescheduled']),
  Confirmed:   Object.freeze(['InService', 'Cancelled', 'Rescheduled', 'Created']),
  InService:   Object.freeze(['Completed', 'Cancelled', 'Confirmed']),
  Rescheduled: Object.freeze(['Confirmed', 'Cancelled', 'Created']),
  // Терминальные «бумажные» состояния — откат к рабочим возможен только админу.
  Completed:   Object.freeze(['Archived', 'InService']),
  Cancelled:   Object.freeze(['Archived', 'Created']),
  Archived:    Object.freeze([]),
});

// Множества статусов для фильтров listForClient/listForMaster. 
const ACTIVE_STATUSES = Object.freeze([
  'Created', 'Confirmed', 'InService', 'Rescheduled',
]);
const HISTORY_STATUSES = Object.freeze([
  'Completed', 'Cancelled', 'Archived',
]);

function readRoleCode(user) {
  if (!user) return null;
  if (user.role && typeof user.role === 'object' && user.role.code) {
    return String(user.role.code);
  }
  if (user.role_code) return String(user.role_code);
  if (typeof user.role === 'string') return user.role;
  return null;
}

function assertTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidTransitionError(
      `Недопустимый переход статуса: ${from} → ${to}`,
      { from, to }
    );
  }
}

function assertRoleCanTransition(byUser, appointment, from, to) {
  const role = readRoleCode(byUser);
  if (!role || !byUser || byUser.id == null) {
    throw new ForbiddenError('Недостаточно прав для смены статуса записи');
  }
  // Администратор может выполнить любой переход
  if (role === 'admin') return;

  const isMasterSelf =
    role === 'master' && byUser.id === appointment.master_id;
  const isClientSelf =
    role === 'client' && byUser.id === appointment.client_id;

  // Маппинг переходов → допустимые роли. 
  const key = `${from}->${to}`;
  switch (key) {
    // --- Действия мастера над собственными записями -----------------------
    case 'Created->Confirmed':
    case 'Rescheduled->Confirmed':
    case 'Confirmed->InService':
    case 'InService->Completed':
      if (!isMasterSelf) {
        throw new ForbiddenError(
          'Этот переход доступен только назначенному мастеру или администратору'
        );
      }
      return;

    // --- Отмена и перенос: клиент-владелец ИЛИ назначенный мастер ---------
    case 'Created->Cancelled':
    case 'Created->Rescheduled':
    case 'Confirmed->Cancelled':
    case 'Confirmed->Rescheduled':
    case 'InService->Cancelled':
    case 'Rescheduled->Cancelled':
      if (!isClientSelf && !isMasterSelf) {
        throw new ForbiddenError(
          'Отмену или перенос может выполнить владелец записи или администратор'
        );
      }
      return;

    case 'Completed->Archived':
    case 'Cancelled->Archived':
      // Архивация — исключительно админская операция.
      throw new ForbiddenError('Архивация доступна только администратору');

    default:
      // Любой другой переход (включая обратные) — только для админа
      throw new ForbiddenError('Переход запрещён для текущей роли');
  }
}

async function loadSlotIds(conn, appointmentId) {
  const [rows] = await conn.query(
    `SELECT time_slot_id FROM appointment_time_slots WHERE appointment_id = ?`,
    [appointmentId]
  );
  return rows.map((r) => r.time_slot_id);
}

async function insertHistory(conn, appointmentId, fromStatus, toStatus, changedBy, comment) {
  await conn.query(
    `INSERT INTO appointment_status_history
       (appointment_id, from_status, to_status, changed_by, comment)
     VALUES (?, ?, ?, ?, ?)`,
    [appointmentId, fromStatus, toStatus, changedBy, comment ?? null]
  );
}

async function computeChainRange(conn, slotIds) {
  const [rows] = await conn.query(
    `SELECT MIN(slot_start) AS start_at, MAX(slot_end) AS end_at
       FROM time_slots
      WHERE id IN (?)`,
    [slotIds]
  );
  return rows[0];
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT a.id,
            a.client_id,
            a.master_id,
            a.service_id,
            a.start_at,
            a.end_at,
            a.status,
            a.base_price,
            a.actual_price,
            a.created_at,
            a.updated_at,
            s.name           AS service_name,
            s.duration_min   AS service_duration_min,
            mu.full_name     AS master_name,
            cu.full_name     AS client_name,
            cu.phone         AS client_phone
       FROM appointments a
       JOIN services s  ON s.id = a.service_id
       JOIN users    mu ON mu.id = a.master_id
       JOIN users    cu ON cu.id = a.client_id
      WHERE a.id = ?
      LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;

  const [slotRows] = await pool.query(
    `SELECT time_slot_id FROM appointment_time_slots WHERE appointment_id = ? ORDER BY time_slot_id`,
    [id]
  );
  return {
    ...rows[0],
    slot_ids: slotRows.map((r) => r.time_slot_id),
  };
}

async function create({ clientId, masterId, serviceId, timeSlotId }) {
  if (!isPositiveInt(clientId) ||
      !isPositiveInt(masterId) ||
      !isPositiveInt(serviceId) ||
      !isPositiveInt(timeSlotId)) {
    throw new ValidationError(
      'clientId, masterId, serviceId и timeSlotId обязательны и должны быть положительными целыми'
    );
  }

  // 1. Загружаем услугу — даёт и `duration_min`, и `is_active`, и `base_price`.
  const service = await Service.findById(serviceId);
  if (!service) {
    throw new NotFoundError('Услуга не найдена');
  }
  if (!service.is_active) {
    throw new ValidationError('Услуга неактивна');
  }

  // 2. Стартовый слот должен принадлежать указанному мастеру.
  const startSlot = await TimeSlot.findById(timeSlotId);
  if (!startSlot) {
    throw new SlotUnavailableError('Выбранный слот не найден');
  }
  if (startSlot.master_id !== Number(masterId)) {
    throw new SlotUnavailableError('Слот принадлежит другому мастеру');
  }

  // 3. Предварительно собираем цепочку слотов необходимой длительности.
  //    Повторная проверка под блокировкой — ниже, внутри транзакции.
  const chain = await TimeSlot.getChainStartingAt(timeSlotId, service.duration_min);
  if (!chain) {
    throw new SlotUnavailableError('Недостаточно свободных слотов для услуги');
  }

  return withTransaction(async (conn) => {
    // 3a. Блокируем цепочку и перепроверяем, что все слоты ещё `free`.
    const locked = await TimeSlot.lockForUpdate(conn, chain.ids);
    if (locked.length !== chain.ids.length ||
        locked.some((row) => row.status !== 'free')) {
      throw new SlotUnavailableError('Выбранные слоты уже заняты');
    }

    // 3b. Мастер должен оказывать услугу.
    const [linkRows] = await conn.query(
      `SELECT 1 FROM master_services WHERE master_id = ? AND service_id = ? LIMIT 1`,
      [masterId, serviceId]
    );
    if (linkRows.length === 0) {
      throw new ValidationError('Мастер не оказывает эту услугу');
    }

    // 3c. Вычисляем реальные start_at / end_at по цепочке.
    const range = await computeChainRange(conn, chain.ids);

    // 4. Вставляем запись и связи со слотами.
    const [insert] = await conn.query(
      `INSERT INTO appointments
         (client_id, master_id, service_id, start_at, end_at, status, base_price)
       VALUES (?, ?, ?, ?, ?, 'Created', ?)`,
      [clientId, masterId, serviceId, range.start_at, range.end_at, service.base_price]
    );
    const appointmentId = insert.insertId;

    // Массовая вставка в appointment_time_slots — mysql2 принимает двумерный массив.
    const valueRows = chain.ids.map((sid) => [appointmentId, sid]);
    await conn.query(
      `INSERT INTO appointment_time_slots (appointment_id, time_slot_id) VALUES ?`,
      [valueRows]
    );

    // 5. Помечаем слоты занятыми (через conn, а не TimeSlot.setStatus,
    //    чтобы изменения были частью той же транзакции).
    await conn.query(
      `UPDATE time_slots SET status = 'busy' WHERE id IN (?)`,
      [chain.ids]
    );

    // 6. Запись в историю: null → Created. changed_by — клиент, инициировавший создание.
    await insertHistory(conn, appointmentId, null, 'Created', clientId, null);

    return appointmentId;
  }).then((id) => findById(id));
}

function statusFilter(status) {
  if (status === 'active') {
    return {
      where: ` AND a.status IN (?) `,
      params: [ACTIVE_STATUSES.slice()],
      order: ' ORDER BY a.start_at ASC ',
    };
  }
  if (status === 'history') {
    return {
      where: ` AND a.status IN (?) `,
      params: [HISTORY_STATUSES.slice()],
      order: ' ORDER BY a.start_at DESC ',
    };
  }
  return { where: '', params: [], order: ' ORDER BY a.start_at DESC ' };
}

async function listForClient(clientId, { status } = {}) {
  if (!isPositiveInt(clientId)) {
    throw new ValidationError('clientId обязателен');
  }
  const f = statusFilter(status);
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
            a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name         AS service_name,
            s.duration_min AS service_duration_min,
            mu.full_name   AS master_name
       FROM appointments a
       JOIN services s  ON s.id = a.service_id
       JOIN users    mu ON mu.id = a.master_id
      WHERE a.client_id = ? ${f.where}
      ${f.order}`,
    [clientId, ...f.params]
  );
  return rows;
}

async function listForMaster(masterId, { status } = {}) {
  if (!isPositiveInt(masterId)) {
    throw new ValidationError('masterId обязателен');
  }
  const f = statusFilter(status);
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
            a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name         AS service_name,
            s.duration_min AS service_duration_min,
            cu.full_name   AS client_name,
            cu.phone       AS client_phone
       FROM appointments a
       JOIN services s  ON s.id = a.service_id
       JOIN users    cu ON cu.id = a.client_id
      WHERE a.master_id = ? ${f.where}
      ${f.order}`,
    [masterId, ...f.params]
  );
  return rows;
}

async function listByMaster(masterId, { from, to } = {}) {
  if (!isPositiveInt(masterId)) {
    throw new ValidationError('masterId обязателен');
  }
  const conds = ['a.master_id = ?'];
  const params = [masterId];
  if (from) { conds.push('a.start_at >= ?'); params.push(from); }
  if (to)   { conds.push('a.start_at <= ?'); params.push(to); }
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
            a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name         AS service_name,
            s.duration_min AS service_duration_min,
            cu.full_name   AS client_name,
            mu.full_name   AS master_name
       FROM appointments a
       JOIN services s  ON s.id = a.service_id
       JOIN users    cu ON cu.id = a.client_id
       JOIN users    mu ON mu.id = a.master_id
      WHERE ${conds.join(' AND ')}
      ORDER BY a.start_at ASC`,
    params
  );
  return rows;
}

async function cancel(id, byUser, { comment = null } = {}) {
  if (!isPositiveInt(Number(id))) {
    throw new ValidationError('id записи обязателен');
  }

  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, client_id, master_id, status FROM appointments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];

    assertTransition(appointment.status, 'Cancelled');
    assertRoleCanTransition(byUser, appointment, appointment.status, 'Cancelled');

    // Освобождаем слоты, если они были заняты.
    const slotIds = await loadSlotIds(conn, id);
    if (slotIds.length > 0) {
      await conn.query(
        `UPDATE time_slots SET status = 'free' WHERE id IN (?)`,
        [slotIds]
      );
    }

    await conn.query(
      `UPDATE appointments SET status = 'Cancelled' WHERE id = ?`,
      [id]
    );
    await insertHistory(conn, id, appointment.status, 'Cancelled', byUser.id, comment);
  });

  return findById(id);
}

async function reschedule(id, byUser, newTimeSlotId, { comment = null } = {}) {
  if (!isPositiveInt(Number(id))) {
    throw new ValidationError('id записи обязателен');
  }
  if (!isPositiveInt(Number(newTimeSlotId))) {
    throw new ValidationError('Не указан новый слот');
  }

  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, client_id, master_id, service_id, status
         FROM appointments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];

    assertTransition(appointment.status, 'Rescheduled');
    assertRoleCanTransition(byUser, appointment, appointment.status, 'Rescheduled');

    // Загружаем услугу для расчёта длительности. Service.findById работает
    // в обход conn: он читает пул. 
    const service = await Service.findById(appointment.service_id);
    if (!service) throw new NotFoundError('Услуга не найдена');

    // Проверяем, что новый слот принадлежит тому же мастеру.
    const newStart = await TimeSlot.findById(newTimeSlotId);
    if (!newStart) throw new SlotUnavailableError('Новый слот не найден');
    if (newStart.master_id !== appointment.master_id) {
      throw new SlotUnavailableError('Новый слот принадлежит другому мастеру');
    }

    const chain = await TimeSlot.getChainStartingAt(newTimeSlotId, service.duration_min);
    if (!chain) {
      throw new SlotUnavailableError('Недостаточно свободных слотов для переноса');
    }

    // Освобождаем старую цепочку и удаляем её из связи.
    const oldIds = await loadSlotIds(conn, id);
    if (oldIds.length > 0) {
      await conn.query(
        `UPDATE time_slots SET status = 'free' WHERE id IN (?)`,
        [oldIds]
      );
      await conn.query(
        `DELETE FROM appointment_time_slots WHERE appointment_id = ?`,
        [id]
      );
    }

    // Блокируем новую цепочку и проверяем статусы.
    const locked = await TimeSlot.lockForUpdate(conn, chain.ids);
    if (locked.length !== chain.ids.length ||
        locked.some((row) => row.status !== 'free')) {
      throw new SlotUnavailableError('Выбранные слоты уже заняты');
    }

    const range = await computeChainRange(conn, chain.ids);

    const valueRows = chain.ids.map((sid) => [id, sid]);
    await conn.query(
      `INSERT INTO appointment_time_slots (appointment_id, time_slot_id) VALUES ?`,
      [valueRows]
    );
    await conn.query(
      `UPDATE time_slots SET status = 'busy' WHERE id IN (?)`,
      [chain.ids]
    );

    await conn.query(
      `UPDATE appointments
          SET start_at = ?, end_at = ?, status = 'Rescheduled', updated_at = NOW()
        WHERE id = ?`,
      [range.start_at, range.end_at, id]
    );

    await insertHistory(
      conn, id, appointment.status, 'Rescheduled', byUser.id, comment
    );
  });

  return findById(id);
}

async function setStatus(id, byUser, newStatus, { actualPrice, comment = null } = {}) {
  if (!isPositiveInt(Number(id))) {
    throw new ValidationError('id записи обязателен');
  }
  if (typeof newStatus !== 'string') {
    throw new ValidationError('Целевой статус обязателен');
  }

  // Rescheduled здесь не поддерживаем — требуется newTimeSlotId.
  if (newStatus === 'Rescheduled') {
    throw new ValidationError(
      'Для переноса используйте операцию reschedule с указанием нового слота'
    );
  }

  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, client_id, master_id, service_id, status, base_price
         FROM appointments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];

    assertTransition(appointment.status, newStatus);
    assertRoleCanTransition(byUser, appointment, appointment.status, newStatus);

    // Completed требует фактической цены
    const sets = ['status = ?'];
    const params = [newStatus];
    if (newStatus === 'Completed') {
      const price = Number(actualPrice);
      if (!isNonNegativeNumber(price)) {
        throw new ValidationError('Некорректная фактическая стоимость');
      }
      sets.push('actual_price = ?');
      params.push(price);
    }

    // Cancelled — освобождаем слоты. Через `cancel()` удобнее, но поддержим
    // и этот путь ради симметрии API.
    if (newStatus === 'Cancelled') {
      const slotIds = await loadSlotIds(conn, id);
      if (slotIds.length > 0) {
        await conn.query(
          `UPDATE time_slots SET status = 'free' WHERE id IN (?)`,
          [slotIds]
        );
      }
    }

    // Confirmed / InService / Completed / Archived — не трогаем слоты:
    params.push(id);
    await conn.query(
      `UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    await insertHistory(conn, id, appointment.status, newStatus, byUser.id, comment);
  });

  return findById(id);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  create,
  findById,
  listForClient,
  listForMaster,
  listByMaster,
  listAll,
  cancel,
  reschedule,
  setStatus,
  setStatusForce,
  remove: removeAppointment,
};

async function listAll({ q = '' } = {}) {
  const trimmed = validateQuery(q);
  const filter = buildIlikeFilter(trimmed, APPOINTMENT_SEARCH_FIELDS);
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.master_id, a.service_id, a.start_at, a.end_at,
            a.status, a.base_price, a.actual_price, a.created_at, a.updated_at,
            s.name         AS service_name,
            s.duration_min AS service_duration_min,
            cu.full_name   AS client_name,
            mu.full_name   AS master_name
       FROM appointments a
       JOIN services s  ON s.id = a.service_id
       JOIN users    cu ON cu.id = a.client_id
       JOIN users    mu ON mu.id = a.master_id
      WHERE 1 = 1 ${filter.where}
      ORDER BY a.start_at DESC`,
    filter.params
  );
  return rows;
}

async function setStatusForce(id, byUser, newStatus, { comment = null, actualPrice } = {}) {
  if (!isPositiveInt(Number(id))) {
    throw new ValidationError('id записи обязателен');
  }
  const allTargets = ['Created', 'Confirmed', 'InService', 'Completed', 'Cancelled', 'Rescheduled'];
  if (typeof newStatus !== 'string' || !allTargets.includes(newStatus)) {
    throw new ValidationError('Недопустимое значение статуса', { code: 'invalid_status_value' });
  }

  const role = readRoleCode(byUser);
  if (!role) throw new ForbiddenError('Не указана роль пользователя');

  let result = null;
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, client_id, master_id, service_id, status, base_price
         FROM appointments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const appointment = rows[0];

    // Проверка прав по ролям.
    if (role === 'admin') {
      // ok — любая запись
    } else if (role === 'master') {
      if (Number(appointment.master_id) !== Number(byUser.id)) {
        throw new ForbiddenError('Нет доступа к чужой записи', {
          code: 'forbidden_appointment_owner',
        });
      }
    } else if (role === 'client') {
      if (Number(appointment.client_id) !== Number(byUser.id)) {
        throw new ForbiddenError('Нет доступа к чужой записи', {
          code: 'forbidden_appointment_owner',
        });
      }
      if (newStatus !== 'Cancelled') {
        throw new ForbiddenError('Клиент может только отменять свои записи', {
          code: 'forbidden_status_for_client',
        });
      }
      if (!['Created', 'Confirmed', 'Rescheduled'].includes(appointment.status)) {
        throw new ForbiddenError(
          'Запись в этом статусе не может быть отменена клиентом',
          { code: 'forbidden_status_for_client' }
        );
      }
    } else {
      throw new ForbiddenError('Недостаточно прав');
    }

    // Идемпотентность: статус не меняется.
    if (appointment.status === newStatus) {
      result = { id: appointment.id, status: appointment.status, idempotent: true };
      return;
    }

    // Освобождаем слоты при переходе в Cancelled.
    if (newStatus === 'Cancelled') {
      const slotIds = await loadSlotIds(conn, id);
      if (slotIds.length > 0) {
        await conn.query(
          `UPDATE time_slots SET status = 'free' WHERE id IN (?)`,
          [slotIds]
        );
      }
    }

    const sets = ['status = ?', 'updated_at = NOW()'];
    const params = [newStatus];
    if (newStatus === 'Completed' && actualPrice !== undefined) {
      const price = Number(actualPrice);
      if (isNonNegativeNumber(price)) {
        sets.push('actual_price = ?');
        params.push(price);
      }
    }
    params.push(id);
    await conn.query(
      `UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    await insertHistory(conn, id, appointment.status, newStatus, byUser.id, comment);
  });

  if (result && result.idempotent) {
    const fresh = await findById(id);
    return { ...fresh, idempotent: true };
  }
  return findById(id);
}

async function removeAppointment(id) {
  if (!isPositiveInt(Number(id))) {
    throw new ValidationError('id записи обязателен');
  }
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id FROM appointments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Запись не найдена');
    const slotIds = await loadSlotIds(conn, id);
    if (slotIds.length > 0) {
      await conn.query(
        `UPDATE time_slots SET status = 'free' WHERE id IN (?)`,
        [slotIds]
      );
    }
    await conn.query(`DELETE FROM appointments WHERE id = ?`, [id]);
  });
}