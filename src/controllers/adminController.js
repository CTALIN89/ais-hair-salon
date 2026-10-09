'use strict';

//Контроллер административной панели.
 
const db = require('../config/db');
const User = require('../models/User');
const Client = require('../models/Client');
const Master = require('../models/Master');
const ServiceCategory = require('../models/ServiceCategory');
const Service = require('../models/Service');
const Schedule = require('../models/Schedule');
const Report = require('../models/Report');
const Archive = require('../models/Archive');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  AppError,
} = require('../errors');
const {
  isPositiveInt,
  normalizeString,
  validateEmail,
  validatePhone,
  validatePassword,
  isIsoDate,
  isSlotStep15,
} = require('../utils/validators');

const _roleCache = new Map();
async function getRoleIdByCode(code) {
  if (_roleCache.has(code)) return _roleCache.get(code);
  const [rows] = await db.query(
    'SELECT id FROM roles WHERE code = ? LIMIT 1',
    [code]
  );
  if (!rows.length) {
    throw new AppError(`Role "${code}" not found`, {
      status: 500,
      code: 'role_missing',
    });
  }
  _roleCache.set(code, rows[0].id);
  return rows[0].id;
}

async function assertNotLastActiveAdmin(userIdAffected) {
  const [rows] = await db.query(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'admin' AND u.is_active = 1`
  );
  // Если активных админов несколько (>1) — операция безопасна.
  if (rows.length > 1) return;
  // Активных админов 0 или 1. Если единственный активный админ — это и есть
  // тот, кого собираемся трогать, — блокируем.
  if (rows.length === 1 && rows[0].id === Number(userIdAffected)) {
    throw new ConflictError(
      'Нельзя оставить систему без активного администратора',
      { code: 'last_active_admin' }
    );
  }
}

// Читает пользователей с ролью — плоская выборка для admin-дашборда.
 async function listUsersWithRoles() {
  const [rows] = await db.query(
    `SELECT u.id, u.login, u.full_name, u.email, u.phone, u.is_active,
            r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      ORDER BY r.code, u.login`
  );
  return rows.map((r) => ({
    ...r,
    is_active: r.is_active === 1 || r.is_active === true,
  }));
}

//Возвращает список связей master_services в виде массива
async function listMasterServices() {
  const [rows] = await db.query(
    `SELECT ms.master_id, ms.service_id,
            mu.full_name AS master_name,
            s.name       AS service_name
       FROM master_services ms
       JOIN users    mu ON mu.id = ms.master_id
       JOIN services s  ON s.id = ms.service_id
      ORDER BY mu.full_name, s.name`
  );
  return rows;
}

async function dashboard(req, res, next) {
  try {
    const [categories, services, masters, users] = await Promise.all([
      ServiceCategory.list(),
      Service.list({ activeOnly: false }),
      Master.list({ activeOnly: false }),
      listUsersWithRoles(),
    ]);

    const clientsCount = users.filter((u) => u.role_code === 'client').length;

    const stats = {
      categories: categories.length,
      services: services.length,
      masters: masters.length,
      users: users.length,
      clients: clientsCount,
    };

    res.render('admin/dashboard', {
      title: 'Панель администратора',
      stats,
      users,
      services,
      masters,
      categories,
    });
  } catch (err) {
    next(err);
  }
}

async function servicesPage(req, res, next) {
  try {
    const [categories, services, masters, masterServices] = await Promise.all([
      ServiceCategory.list(),
      Service.list({ activeOnly: false }),
      Master.list({ activeOnly: false }),
      listMasterServices(),
    ]);

    res.render('admin/services', {
      title: 'Управление услугами',
      categories,
      services,
      masters,
      masterServices,
    });
  } catch (err) {
    next(err);
  }
}

async function reportsPage(req, res, next) {
  try {
    const [reports, clientsRows] = await Promise.all([
      Report.list(),
      db.query(
        `SELECT u.id, u.full_name
           FROM users u
           JOIN clients c ON c.user_id = u.id
          WHERE u.is_active = 1
          ORDER BY u.full_name`
      ).then((r) => r[0]),
    ]);
    res.render('admin/reports', {
      title: 'Отчёты',
      reports,
      clients: clientsRows,
      generated: null,
    });
  } catch (err) {
    next(err);
  }
}

async function apiCreateCategory(req, res, next) {
  try {
    const body = req.body || {};
    const name = normalizeString(body.name, { maxLen: 128 });
    if (!name) {
      throw new ValidationError('Укажите название категории', {
        errors: [{ field: 'name', message: 'Обязательное поле' }],
      });
    }
    const sort_order = body.sort_order === undefined || body.sort_order === null
      ? 0
      : Number(body.sort_order);
    if (!Number.isInteger(sort_order)) {
      throw new ValidationError('sort_order должен быть целым числом', {
        errors: [{ field: 'sort_order', message: 'Некорректное значение' }],
      });
    }
    const category = await ServiceCategory.create({ name, sort_order });
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
}

async function apiUpdateCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id категории');
    }
    const existing = await ServiceCategory.findById(id);
    if (!existing) throw new NotFoundError('Категория не найдена');

    const patch = {};
    if (req.body && req.body.name !== undefined) patch.name = req.body.name;
    if (req.body && req.body.sort_order !== undefined) {
      const n = Number(req.body.sort_order);
      if (!Number.isInteger(n)) {
        throw new ValidationError('sort_order должен быть целым числом');
      }
      patch.sort_order = n;
    }
    const category = await ServiceCategory.update(id, patch);
    if (!category) throw new NotFoundError('Категория не найдена');
    res.json({ category });
  } catch (err) {
    next(err);
  }
}

async function apiDeleteCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id категории');
    }
    const removed = await ServiceCategory.remove(id);
    if (!removed) throw new NotFoundError('Категория не найдена');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiCreateService(req, res, next) {
  try {
    const body = req.body || {};
    const payload = {
      category_id: body.category_id !== undefined ? Number(body.category_id) : undefined,
      name: body.name,
      description: body.description,
      duration_min: body.duration_min !== undefined ? Number(body.duration_min) : undefined,
      base_price: body.base_price !== undefined ? Number(body.base_price) : undefined,
    };
    const service = await Service.create(payload);
    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
}

async function apiUpdateService(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id услуги');
    }
    const body = req.body || {};
    const patch = {};
    if (body.category_id !== undefined) patch.category_id = Number(body.category_id);
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.duration_min !== undefined) patch.duration_min = Number(body.duration_min);
    if (body.base_price !== undefined) patch.base_price = Number(body.base_price);
    if (body.is_active !== undefined) patch.is_active = !!body.is_active;

    const service = await Service.update(id, patch);
    res.json({ service });
  } catch (err) {
    next(err);
  }
}

async function apiDeleteService(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id услуги');
    }
    const ok = await Service.deactivate(id);
    if (!ok) throw new NotFoundError('Услуга не найдена');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiAttachMasterService(req, res, next) {
  try {
    const masterId = Number(req.params.id);
    const serviceId = Number(req.body && req.body.service_id);
    if (!isPositiveInt(masterId) || !isPositiveInt(serviceId)) {
      throw new ValidationError('masterId и service_id должны быть положительными целыми');
    }
    const link = await Master.attachService(masterId, serviceId);
    res.status(201).json({ link });
  } catch (err) {
    next(err);
  }
}

async function apiDetachMasterService(req, res, next) {
  try {
    const masterId = Number(req.params.id);
    const serviceId = Number(req.params.serviceId);
    if (!isPositiveInt(masterId) || !isPositiveInt(serviceId)) {
      throw new ValidationError('masterId и serviceId должны быть положительными целыми');
    }
    const ok = await Master.detachService(masterId, serviceId);
    if (!ok) throw new NotFoundError('Привязка мастера к услуге не найдена');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiCreateUser(req, res, next) {
  try {
    const body = req.body || {};

    const login = normalizeString(body.login, { maxLen: 64 }) || '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = typeof body.role === 'string' ? body.role : '';
    const full_name = normalizeString(body.full_name, { maxLen: 128 }) || '';
    const email = normalizeString(body.email, { maxLen: 128 }) || '';
    const phone = normalizeString(body.phone, { maxLen: 32 }) || '';

    const errors = [];
    if (!login || login.length < 3) {
      errors.push({ field: 'login', message: 'Логин должен быть от 3 до 64 символов' });
    }
    if (!validatePassword(password)) {
      errors.push({ field: 'password', message: 'Пароль 8..128 символов без пробелов' });
    }
    if (!['admin', 'master', 'client'].includes(role)) {
      errors.push({ field: 'role', message: 'Роль должна быть admin, master или client' });
    }
    if (!full_name || full_name.length < 2) {
      errors.push({ field: 'full_name', message: 'Укажите корректное ФИО' });
    }
    if (!validateEmail(email)) {
      errors.push({ field: 'email', message: 'Некорректный email' });
    }
    if (!validatePhone(phone)) {
      errors.push({ field: 'phone', message: 'Некорректный номер телефона' });
    }

    let specialization = null;
    let bio = null;
    let photo_url = null;
    if (role === 'master') {
      specialization = normalizeString(body.specialization, { maxLen: 128 });
      if (!specialization) {
        errors.push({
          field: 'specialization',
          message: 'Для мастера обязательна специализация',
        });
      }
      bio = body.bio !== undefined
        ? (normalizeString(body.bio, { maxLen: 2000 }) || null)
        : null;
      photo_url = body.photo_url !== undefined
        ? (normalizeString(body.photo_url, { maxLen: 512 }) || null)
        : null;
    }

    let birth_date = null;
    if (role === 'client' && body.birth_date) {
      if (!isIsoDate(body.birth_date)) {
        errors.push({
          field: 'birth_date',
          message: 'Некорректная дата рождения (ожидается YYYY-MM-DD)',
        });
      } else {
        birth_date = body.birth_date;
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Ошибка валидации данных пользователя', { errors });
    }

    const role_id = await getRoleIdByCode(role);
    const user = await User.create({
      login,
      password,
      role_id,
      full_name,
      email,
      phone,
    });

    if (role === 'master') {
      await Master.create(user.id, { specialization, bio, photo_url });
    } else if (role === 'client') {
      await Client.create(user.id, { birth_date, notes: null });
    }

    res.status(201).json({ user: User.publicView(user) });
  } catch (err) {
    next(err);
  }
}

async function apiDeactivateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id пользователя');
    }
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('Пользователь не найден');
    // Не даём заблокировать единственного активного админа.
    if (user.role.code === 'admin') {
      await assertNotLastActiveAdmin(id);
    }
    await User.deactivate(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiActivateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id пользователя');
    }
    const user = await User.findById(id);
    if (!user) throw new NotFoundError('Пользователь не найден');
    await User.activate(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiSetUserRole(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id пользователя');
    }

    const role = req.body && typeof req.body.role === 'string' ? req.body.role : '';
    if (!['admin', 'master', 'client'].includes(role)) {
      throw new ValidationError('Роль должна быть admin, master или client', {
        errors: [{ field: 'role', message: 'Некорректная роль' }],
      });
    }

    const user = await User.findById(id);
    if (!user) throw new NotFoundError('Пользователь не найден');

    // Не даём админу случайно снять с себя роль admin — иначе риск заблокировать
    // доступ к панели.
    if (
      req.session && req.session.user && req.session.user.id === id
      && user.role.code === 'admin' && role !== 'admin'
    ) {
      throw new ConflictError('Нельзя снять роль admin с собственной учётной записи', {
        code: 'self_role_change_forbidden',
      });
    }

    // Дополнительный предохранитель: даже если это не текущий пользователь,
    // нельзя снять admin-роль с последнего активного администратора.
    if (user.role.code === 'admin' && role !== 'admin') {
      await assertNotLastActiveAdmin(id);
    }

    // Если уже нужная роль — просто возвращаем текущего пользователя.
    if (user.role.code === role) {
      return res.json({ user: User.publicView(user) });
    }

    const newRoleId = await getRoleIdByCode(role);

    // Создаём недостающий профиль, если он требуется для новой роли.
    if (role === 'master') {
      const existing = await Master.findById(id);
      if (!existing) {
        const specialization = normalizeString(
          req.body && req.body.specialization,
          { maxLen: 128 }
        );
        if (!specialization) {
          throw new ValidationError('Для роли master нужна специализация', {
            errors: [{ field: 'specialization', message: 'Обязательное поле' }],
          });
        }
        const bio = req.body && req.body.bio !== undefined
          ? (normalizeString(req.body.bio, { maxLen: 2000 }) || null)
          : null;
        await Master.create(id, { specialization, bio });
      }
    } else if (role === 'client') {
      const existing = await Client.findByUserId(id);
      if (!existing) {
        let birth_date = null;
        if (req.body && req.body.birth_date) {
          if (!isIsoDate(req.body.birth_date)) {
            throw new ValidationError('Некорректная дата рождения (YYYY-MM-DD)', {
              errors: [{ field: 'birth_date', message: 'Неверный формат' }],
            });
          }
          birth_date = req.body.birth_date;
        }
        await Client.create(id, { birth_date, notes: null });
      }
    }

    await User.setRole(id, newRoleId);
    const updated = await User.findById(id);
    res.json({ user: User.publicView(updated) });
  } catch (err) {
    next(err);
  }
}

async function apiCreateSchedule(req, res, next) {
  try {
    const masterId = Number(req.params.id);
    if (!isPositiveInt(masterId)) {
      throw new ValidationError('Некорректный id мастера');
    }
    const body = req.body || {};

    // Schedule.create сам валидирует date, start, end, slot_min; выполняем
    // минимальное преобразование slot_min к числу и передаём остальное как есть.
    const slotMin = body.slot_min !== undefined ? Number(body.slot_min) : undefined;
    if (!isSlotStep15(slotMin)) {
      throw new ValidationError('slot_min должен быть положительным и кратным 15 минутам', {
        errors: [{ field: 'slot_min', message: 'Некорректный шаг' }],
      });
    }

    const schedule = await Schedule.create(masterId, {
      date: body.date,
      start: body.start_time,
      end: body.end_time,
      slot_min: slotMin,
      created_by: req.session.user.id,
    });
    res.status(201).json({ schedule });
  } catch (err) {
    next(err);
  }
}

async function apiDeleteSchedule(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id расписания');
    }
    await Schedule.remove(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function apiBuildReport(req, res, next) {
  try {
    const body = req.body || {};
    const type = typeof body.type === 'string' ? body.type : '';
    const from = body.date_from;
    const to = body.date_to;

    const errors = {};
    if (!['revenue', 'master_load', 'client_history'].includes(type)) {
      errors.type = 'invalid';
    }
    if (!isIsoDate(from)) errors.date_from = 'invalid';
    if (!isIsoDate(to)) errors.date_to = 'invalid';
    if (!errors.date_from && !errors.date_to && from > to) {
      errors.period = 'from_after_to';
    }
    let clientId = null;
    if (type === 'client_history') {
      const cid = Number(body.client_id);
      if (!isPositiveInt(cid)) errors.client_id = 'required';
      else clientId = cid;
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError('Ошибка валидации параметров отчёта', errors);
    }

    let data;
    if (type === 'revenue') {
      data = await Report.buildRevenue({ from, to });
    } else if (type === 'master_load') {
      data = await Report.buildMasterLoad({ from, to });
    } else {
      data = await Report.buildClientHistory({ clientId, from, to });
    }

    const report = await Report.persist(data, req.session.user.id);
    res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
}

async function apiGetReport(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id отчёта');
    }
    const report = await Report.findById(id);
    if (!report) throw new NotFoundError('Отчёт не найден');
    res.json({ report });
  } catch (err) {
    next(err);
  }
}

async function apiExportReport(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id отчёта');
    }
    const format = (req.query && req.query.format ? String(req.query.format) : 'csv').toLowerCase();
    if (format !== 'csv') {
      throw new ValidationError('Поддерживается только format=csv', { format: 'unsupported' });
    }
    const report = await Report.findById(id);
    if (!report) throw new NotFoundError('Отчёт не найден');

    const csv = Report.toCsv(report);
    res
      .type('text/csv; charset=utf-8')
      .attachment(`report-${id}.csv`)
      .send(csv);
  } catch (err) {
    next(err);
  }
}

async function apiCreateArchive(req, res, next) {
  try {
    const body = req.body || {};
    const archive = await Archive.create({
      from: body.date_from,
      to: body.date_to,
      createdBy: req.session.user.id,
    });
    res.status(201).json({ archive });
  } catch (err) {
    next(err);
  }
}

async function apiGetArchive(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      throw new ValidationError('Некорректный id архива');
    }
    const archive = await Archive.findById(id);
    if (!archive) throw new NotFoundError('Архив не найден');
    res.json({ archive });
  } catch (err) {
    next(err);
  }
}

async function apiListArchives(req, res, next) {
  try {
    const archives = await Archive.list();
    res.json({ archives });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  // Страницы
  dashboard,
  servicesPage,
  reportsPage,
  usersPage,
  clientsPage,
  mastersPage,
  categoriesPage,
  schedulesPage,
  appointmentsPage,
  // Категории
  apiCreateCategory,
  apiUpdateCategory,
  apiDeleteCategory,
  apiListCategories,
  // Услуги
  apiCreateService,
  apiUpdateService,
  apiDeleteService,
  apiListServices,
  // Привязка мастер ↔ услуга
  apiAttachMasterService,
  apiDetachMasterService,
  // Пользователи
  apiCreateUser,
  apiDeactivateUser,
  apiActivateUser,
  apiSetUserRole,
  apiUpdateUser,
  apiDeleteUser,
  apiListUsers,
  // Клиенты
  apiListClients,
  apiUpdateClient,
  apiDeleteClient,
  // Мастера
  apiListMasters,
  apiUpdateMaster,
  apiDeleteMaster,
  // Записи
  apiListAppointments,
  apiCreateAppointment,
  apiUpdateAppointment,
  apiDeleteAppointment,
  // Расписания
  apiCreateSchedule,
  apiDeleteSchedule,
  apiListSchedules,
  // Отчёты
  apiBuildReport,
  apiGetReport,
  apiExportReport,
  // Архивы
  apiCreateArchive,
  apiGetArchive,
  apiListArchives,
};

const Appointment = require('../models/Appointment');

// --- Страницы админ-CRUD ---------------------------------------------------

async function usersPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const [users, roles] = await Promise.all([
      User.list({ q }),
      db.query('SELECT id, code, name FROM roles ORDER BY code').then((r) => r[0]),
    ]);
    res.render('admin/users', { title: 'Пользователи', users, roles, q });
  } catch (err) { next(err); }
}

async function clientsPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const clients = await Client.list({ q });
    res.render('admin/clients', { title: 'Клиенты', clients, q });
  } catch (err) { next(err); }
}

async function mastersPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const masters = await Master.list({ q, activeOnly: false });
    res.render('admin/masters', { title: 'Мастера', masters, q });
  } catch (err) { next(err); }
}

async function categoriesPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const categories = await ServiceCategory.list({ q });
    res.render('admin/categories', { title: 'Категории услуг', categories, q });
  } catch (err) { next(err); }
}

async function schedulesPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const [schedules, masters] = await Promise.all([
      Schedule.listAll({ q }),
      Master.list({ activeOnly: false }),
    ]);
    res.render('admin/schedules', {
      title: 'Расписания', schedules, masters, q,
    });
  } catch (err) { next(err); }
}

async function appointmentsPage(req, res, next) {
  try {
    const q = req.query.q || '';
    const appointments = await Appointment.listAll({ q });
    res.render('admin/appointments', {
      title: 'Записи', appointments, q,
    });
  } catch (err) { next(err); }
}

// --- Listing API endpoints with q filter ----------------------------------

async function apiListUsers(req, res, next) {
  try {
    const users = await User.list({ q: req.query.q });
    res.json({ users });
  } catch (err) { next(err); }
}

async function apiListClients(req, res, next) {
  try {
    const clients = await Client.list({ q: req.query.q });
    res.json({ clients });
  } catch (err) { next(err); }
}

async function apiListMasters(req, res, next) {
  try {
    const masters = await Master.list({ q: req.query.q, activeOnly: false });
    res.json({ masters });
  } catch (err) { next(err); }
}

async function apiListCategories(req, res, next) {
  try {
    const categories = await ServiceCategory.list({ q: req.query.q });
    res.json({ categories });
  } catch (err) { next(err); }
}

async function apiListServices(req, res, next) {
  try {
    const services = await Service.list({ q: req.query.q, activeOnly: false });
    res.json({ services });
  } catch (err) { next(err); }
}

async function apiListSchedules(req, res, next) {
  try {
    const schedules = await Schedule.listAll({ q: req.query.q });
    res.json({ schedules });
  } catch (err) { next(err); }
}

async function apiListAppointments(req, res, next) {
  try {
    const appointments = await Appointment.listAll({ q: req.query.q });
    res.json({ appointments });
  } catch (err) { next(err); }
}

// --- Generic update/delete для пользователей (last-admin guard в модели) --

async function apiUpdateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id пользователя');
    const user = await User.update(id, req.body || {});
    if (!user) throw new NotFoundError('Пользователь не найден');
    res.json({ user: User.publicView(user) });
  } catch (err) { next(err); }
}

async function apiDeleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id пользователя');
    await User.remove(id);
    res.status(204).end();
  } catch (err) { next(err); }
}

// --- Клиенты CRUD ---------------------------------------------------------

async function apiUpdateClient(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id клиента');
    const body = req.body || {};
    // Обновляем поля users (full_name, email, phone)
    const userPatch = {};
    if (body.full_name !== undefined) userPatch.full_name = body.full_name;
    if (body.email     !== undefined) userPatch.email     = body.email;
    if (body.phone     !== undefined) userPatch.phone     = body.phone;
    if (Object.keys(userPatch).length > 0) {
      await User.update(id, userPatch);
    }
    // И поля clients (birth_date, notes)
    if (body.birth_date !== undefined || body.notes !== undefined) {
      await Client.updateProfile(id, body);
    }
    const client = await Client.findByUserId(id);
    if (!client) throw new NotFoundError('Клиент не найден');
    res.json({ client });
  } catch (err) { next(err); }
}

async function apiDeleteClient(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id клиента');
    await User.remove(id);
    res.status(204).end();
  } catch (err) { next(err); }
}

// --- Мастера CRUD ---------------------------------------------------------

async function apiUpdateMaster(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id мастера');
    const body = req.body || {};
    const userPatch = {};
    if (body.full_name !== undefined) userPatch.full_name = body.full_name;
    if (body.email     !== undefined) userPatch.email     = body.email;
    if (body.phone     !== undefined) userPatch.phone     = body.phone;
    if (Object.keys(userPatch).length > 0) {
      await User.update(id, userPatch);
    }
    if (body.specialization !== undefined || body.bio !== undefined || body.photo_url !== undefined) {
      await Master.updateProfile(id, body);
    }
    if (body.is_active !== undefined) {
      await Master.setActive(id, !!body.is_active);
    }
    const master = await Master.findById(id);
    if (!master) throw new NotFoundError('Мастер не найден');
    res.json({ master });
  } catch (err) { next(err); }
}

async function apiDeleteMaster(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id мастера');
    await Master.setActive(id, false);
    res.status(204).end();
  } catch (err) { next(err); }
}

// --- Записи CRUD ----------------------------------------------------------

async function apiCreateAppointment(req, res, next) {
  try {
    const body = req.body || {};
    const clientId = Number(body.client_id);
    const masterId = Number(body.master_id);
    const serviceId = Number(body.service_id);
    const timeSlotId = Number(body.time_slot_id);
    if (![clientId, masterId, serviceId, timeSlotId].every(isPositiveInt)) {
      throw new ValidationError('Все поля обязательны');
    }
    const appointment = await Appointment.create({ clientId, masterId, serviceId, timeSlotId });
    res.status(201).json({ appointment });
  } catch (err) { next(err); }
}

async function apiUpdateAppointment(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id записи');
    const body = req.body || {};
    // Поддерживаем смену статуса напрямую (через setStatusForce) и перенос
    // (через reschedule, если передан time_slot_id).
    if (body.time_slot_id !== undefined) {
      const newSlotId = Number(body.time_slot_id);
      if (!isPositiveInt(newSlotId)) throw new ValidationError('Некорректный time_slot_id');
      const appointment = await Appointment.reschedule(id, req.session.user, newSlotId, {
        comment: body.comment || null,
      });
      return res.json({ appointment });
    }
    if (body.status !== undefined) {
      const appointment = await Appointment.setStatusForce(id, req.session.user, body.status, {
        comment: body.comment || null,
        actualPrice: body.actual_price,
      });
      return res.json({ appointment });
    }
    const fresh = await Appointment.findById(id);
    if (!fresh) throw new NotFoundError('Запись не найдена');
    res.json({ appointment: fresh });
  } catch (err) { next(err); }
}

async function apiDeleteAppointment(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) throw new ValidationError('Некорректный id записи');
    await Appointment.remove(id);
    res.status(204).end();
  } catch (err) { next(err); }
}