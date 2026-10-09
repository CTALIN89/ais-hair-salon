'use strict';

/**
 * Идемпотентный seed демо-данных для АС «Салон-парикмахерская HAIR SALON».
 * Предусловия: schema.sql уже применён. Скрипт
 * очищает все 18 таблиц и наполняет их минимальным набором данных, необходимых
 * для ручной проверки сценариев документа и прохождения demo-учёток README:
 *
 *   admin    / admin123    — администратор
 *   ivanov   / master123   — мастер (Иванов)
 *   petrova  / master123   — мастер (Петрова)
 *   client1  / client123   — клиент (Сидоров)
 *   client2  / client123   — клиент (Кузнецова)
 *
 * Состав данных:
 *   - 3 роли: admin, master, client;
 *   - 5 пользователей + 2 clients + 2 masters;
 *   - 5 категории услуг и 9 услуг с валидными duration_min (кратно 15);
 *   - master_services: по 5 услуг на каждого мастера;
 *   - schedules + time_slots: 14 дней вперёд от сегодняшней даты,
 *     10:00–18:00, slot_min = 30 → 16 слотов/день × 14 × 2 = 448 слотов.
 *
 * Параметры подключения — через src/config (читает .env). Запросы —
 * параметризованные, без multipleStatements. TRUNCATE выполняется до начала
 * транзакции (в MySQL TRUNCATE делает неявный commit).
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const config = require('../src/config');

// Property 21 design.md — cost ≥ 10. Используем 12 как разумный compromise
// (достаточно для требования и не слишком медленно на seed).
const BCRYPT_COST = 12;

// Все 18 таблиц схемы в порядке, безопасном при FOREIGN_KEY_CHECKS=0.
const ALL_TABLES = [
  'archived_appointments',
  'archives',
  'report_items',
  'reports',
  'appointment_status_history',
  'appointment_time_slots',
  'appointments',
  'time_slots',
  'schedules',
  'master_services',
  'services',
  'service_categories',
  'masters',
  'clients',
  'role_permissions',
  'permissions',
  'users',
  'roles',
];

// ---------------------------------------------------------------------------
// Вспомогательные функции форматирования дат (берём локальное время хоста).
// ---------------------------------------------------------------------------

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(dateStr, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateStr} ${hh}:${mm}:00`;
}

// ---------------------------------------------------------------------------
// Очистка всех таблиц.
// ---------------------------------------------------------------------------

async function truncateAll(conn) {
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of ALL_TABLES) {
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}

// ---------------------------------------------------------------------------
// Секции сида.
// ---------------------------------------------------------------------------

async function seedRoles(conn) {
  await conn.query(
    'INSERT INTO roles (code, name) VALUES (?, ?), (?, ?), (?, ?)',
    ['admin', 'Администратор', 'master', 'Мастер', 'client', 'Клиент']
  );

  const [rows] = await conn.query('SELECT id, code FROM roles');
  const byCode = {};
  for (const row of rows) {
    byCode[row.code] = row.id;
  }
  return byCode;
}

async function seedUsers(conn, roles) {
  // Фиксированный набор учёток из README. Пароли — bcrypt (cost 12).
  const USERS = [
    {
      login: 'admin',
      password: 'admin123',
      role_id: roles.admin,
      full_name: 'Администратор',
      email: 'admin@salon.local',
      phone: '+79378955555',
    },
    {
      login: 'ivanov',
      password: 'master123',
      role_id: roles.master,
      full_name: 'Иванов Алекссандр Сергеевич',
      email: 'ivanov@salon.local',
      phone: '+79378722222',
    },
    {
      login: 'petrova',
      password: 'master123',
      role_id: roles.master,
      full_name: 'Петрова Ксения Викторовна',
      email: 'petrova@salon.local',
      phone: '+79378712222',
    },
    {
      login: 'client1',
      password: 'client123',
      role_id: roles.client,
      full_name: 'Калинин Михаил',
      email: 'client1@salon.local',
      phone: '+79378925313',
    },
    {
      login: 'client2',
      password: 'client123',
      role_id: roles.client,
      full_name: 'Симонова Надежда',
      email: 'client2@salon.local',
      phone: '+79378458744',
    },
  ];

  const ids = {};
  for (const u of USERS) {
    const passwordHash = bcrypt.hashSync(u.password, BCRYPT_COST);
    const [res] = await conn.query(
      'INSERT INTO users (role_id, login, password_hash, full_name, email, phone, is_active) '
        + 'VALUES (?, ?, ?, ?, ?, ?, 1)',
      [u.role_id, u.login, passwordHash, u.full_name, u.email, u.phone]
    );
    ids[u.login] = res.insertId;
  }
  return ids;
}

async function seedProfiles(conn, userIds) {
  // clients — два клиента без даты рождения/заметок.
  await conn.query(
    'INSERT INTO clients (user_id, birth_date, notes) VALUES (?, NULL, NULL), (?, NULL, NULL)',
    [userIds.client1, userIds.client2]
  );

  // masters — Иванов (парикмахер-универсал), Петрова (колорист-стилист).
  await conn.query(
    'INSERT INTO masters (user_id, specialization, bio, photo_url, is_active) '
      + 'VALUES (?, ?, NULL, ?, 1), (?, ?, NULL, ?, 1)',
    [
      userIds.ivanov, 'Парикмахер-универсал',
      'img/master_ivanov.jpg',
      userIds.petrova, 'Колорист-стилист',
      'img/master_petrova.jpg',
    ]
  );
}

async function seedCatalog(conn) {
  // 5 категории с возрастающим sort_order.
  const CATEGORIES = [
    { name: 'Стрижки',     sort_order: 10 },
    { name: 'Окрашивание', sort_order: 20 },
    { name: 'Укладки',     sort_order: 30 },
    { name: 'Уход',        sort_order: 40 },
    { name: 'Бритьё и борода', sort_order: 50 },
  ];
  const catIds = {};
  for (const c of CATEGORIES) {
    const [res] = await conn.query(
      'INSERT INTO service_categories (name, sort_order) VALUES (?, ?)',
      [c.name, c.sort_order]
    );
    catIds[c.name] = res.insertId;
  }

  // 9 услуг — все duration_min > 0 и кратны 15 (соответствует CHECK-констрейнту).
  const SERVICES = [
    { category: 'Стрижки',     name: 'Мужская стрижка',        duration_min: 45,  base_price: 1500, image_url: 'img/men.jpg' },
    { category: 'Стрижки',     name: 'Женская стрижка',        duration_min: 60,  base_price: 2500, image_url: 'img/girl.jpg' },
    { category: 'Стрижки',     name: 'Детская стрижка',        duration_min: 30,  base_price: 1000, image_url: 'img/kids.jpg' },
    { category: 'Окрашивание', name: 'Окрашивание в один тон', duration_min: 120, base_price: 4500, image_url: 'img/one ton.jpg' },
    { category: 'Окрашивание', name: 'Мелирование',            duration_min: 150, base_price: 6000, image_url: 'img/melirovan.jpg' },
    { category: 'Укладки',     name: 'Укладка повседневная',   duration_min: 45,  base_price: 2000, image_url: 'img/everyday.jpg' },
    { category: 'Укладки',     name: 'Свадебная причёска',     duration_min: 90,  base_price: 5000, image_url: 'img/cvadba.jpg' },
    { category: 'Уход',        name: 'Восстановление волос',   duration_min: 60,  base_price: 3000, image_url: 'img/new.jpg' },
    { category: 'Бритьё и борода', name: 'Моделирование бороды',  duration_min: 45, base_price: 2000, image_url: 'img/borod.jpg' },
  ];
  const svcIds = {};
  for (const s of SERVICES) {
    const [res] = await conn.query(
      'INSERT INTO services (category_id, name, description, duration_min, base_price, image_url, is_active) '
        + 'VALUES (?, ?, NULL, ?, ?, ?, 1)',
      [catIds[s.category], s.name, s.duration_min, s.base_price, s.image_url]
    );
    svcIds[s.name] = res.insertId;
  }
  return { catIds, svcIds };
}

async function seedMasterServices(conn, userIds, svcIds) {
   const LINKS = [
    {
      master: 'ivanov',
      services: [
        'Мужская стрижка',
        'Детская стрижка',
        'Укладка повседневная',
        'Восстановление волос',
        'Моделирование бороды',
      ],
    },
    {
      master: 'petrova',
      services: [
        'Женская стрижка',
        'Окрашивание в один тон',
        'Мелирование',
        'Свадебная причёска',
        'Восстановление волос',
      ],
    },
  ];

  for (const link of LINKS) {
    const masterId = userIds[link.master];
    for (const serviceName of link.services) {
      await conn.query(
        'INSERT INTO master_services (master_id, service_id) VALUES (?, ?)',
        [masterId, svcIds[serviceName]]
      );
    }
  }
}

async function seedSchedules(conn, userIds) {
  const masters = [userIds.ivanov, userIds.petrova];
  const createdBy = userIds.admin;

  // Единые параметры рабочего дня: 10:00–18:00, шаг 30 минут.
  const START_HOUR = 10;
  const END_HOUR = 18;
  const SLOT_MIN = 30;
  const DAYS_AHEAD = 14;

  const startTime = `${String(START_HOUR).padStart(2, '0')}:00:00`;
  const endTime = `${String(END_HOUR).padStart(2, '0')}:00:00`;

  // База — сегодняшняя дата без времени (локальное время процесса).
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const slotsPerDay = totalMinutes / SLOT_MIN;

  for (const masterId of masters) {
    for (let dayOffset = 0; dayOffset < DAYS_AHEAD; dayOffset++) {
      const date = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + dayOffset
      );
      const dateStr = formatDate(date);

      const [schRes] = await conn.query(
        'INSERT INTO schedules (master_id, work_date, start_time, end_time, slot_min, created_by) '
          + 'VALUES (?, ?, ?, ?, ?, ?)',
        [masterId, dateStr, startTime, endTime, SLOT_MIN, createdBy]
      );
      const scheduleId = schRes.insertId;

      for (let i = 0; i < slotsPerDay; i++) {
        const startTotal = START_HOUR * 60 + i * SLOT_MIN;
        const endTotal = startTotal + SLOT_MIN;
        const sH = Math.floor(startTotal / 60);
        const sM = startTotal % 60;
        const eH = Math.floor(endTotal / 60);
        const eM = endTotal % 60;

        await conn.query(
          'INSERT INTO time_slots '
            + '(schedule_id, master_id, slot_date, slot_start, slot_end, status) '
            + 'VALUES (?, ?, ?, ?, ?, ?)',
          [
            scheduleId,
            masterId,
            dateStr,
            formatDateTime(dateStr, sH, sM),
            formatDateTime(dateStr, eH, eM),
            'free',
          ]
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Главный runner: TRUNCATE (вне транзакции, т.к. DDL-like auto-commit),
// затем BEGIN → INSERT → COMMIT с откатом на ошибке.
// ---------------------------------------------------------------------------

async function run() {
  const { host, port, user, password, database } = config.db;

  if (!database) {
    throw new Error('DB_NAME is not set in environment (.env)');
  }

  console.log(`Connecting to MySQL at ${host}:${port}, database \`${database}\``);

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  try {
    console.log('Clearing tables...');
    await truncateAll(conn);

    await conn.beginTransaction();
    try {
      console.log('Seeding roles...');
      const roles = await seedRoles(conn);

      console.log('Seeding users...');
      const userIds = await seedUsers(conn, roles);
      await seedProfiles(conn, userIds);

      console.log('Seeding categories & services...');
      const { svcIds } = await seedCatalog(conn);

      console.log('Seeding master_services...');
      await seedMasterServices(conn, userIds, svcIds);

      console.log('Generating schedules for 14 days...');
      await seedSchedules(conn, userIds);

      await conn.commit();
      console.log('Done');
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      throw err;
    }
  } finally {
    await conn.end();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err && err.message ? err.message : err);
    process.exit(1);
  });