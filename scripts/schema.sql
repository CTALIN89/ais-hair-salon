-- =============================================================================
-- АС "Салон-парикмахерская HAIR SALON" — схема БД (MySQL 8)
-- Скрипт идемпотентен: может выполняться повторно (DROP IF EXISTS → CREATE).
-- Разделение statements: по символу ';'. DELIMITER/триггеры/процедуры не используются.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- DROP секций в обратном топологическом порядке
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS visit_history_v;

DROP TABLE IF EXISTS archived_appointments;
DROP TABLE IF EXISTS archives;
DROP TABLE IF EXISTS report_items;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS appointment_status_history;
DROP TABLE IF EXISTS appointment_time_slots;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS time_slots;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS master_services;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS service_categories;
DROP TABLE IF EXISTS masters;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

-- -----------------------------------------------------------------------------
-- 1. roles — справочник ролей (admin, master, client). Заполняется в seed.js.
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. permissions — расширяемый справочник прав.
-- -----------------------------------------------------------------------------
CREATE TABLE permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. role_permissions — связь ролей и разрешений (N:M). CASCADE по обеим сторонам.
-- -----------------------------------------------------------------------------
CREATE TABLE role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. users — единая таблица учётных записей. role_id → roles.id RESTRICT.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    role_id INT NOT NULL,
    login VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    email VARCHAR(128) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. clients — профиль клиента (1:0..1 с users). PK = user_id.
-- -----------------------------------------------------------------------------
CREATE TABLE clients (
    user_id INT NOT NULL PRIMARY KEY,
    birth_date DATE NULL,
    notes TEXT NULL,
    CONSTRAINT fk_clients_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. masters — профиль мастера (1:0..1 с users). PK = user_id.
-- -----------------------------------------------------------------------------
CREATE TABLE masters (
    user_id INT NOT NULL PRIMARY KEY,
    specialization VARCHAR(128) NULL,
    bio TEXT NULL,
    photo_url VARCHAR(512) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT fk_masters_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. service_categories — категории услуг.
-- -----------------------------------------------------------------------------
CREATE TABLE service_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. services — прайс-лист услуг. CHECK: duration_min > 0 и кратно 15.
-- -----------------------------------------------------------------------------
CREATE TABLE services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    duration_min INT NOT NULL,
    base_price DECIMAL(10,2) NOT NULL,
    image_url VARCHAR(512) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT chk_services_duration
        CHECK (duration_min > 0 AND duration_min % 15 = 0),
    CONSTRAINT chk_services_price
        CHECK (base_price >= 0),
    CONSTRAINT fk_services_category
        FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. master_services — связь мастеров и услуг (N:M). CASCADE/CASCADE.
--    master_id → masters.user_id.
-- -----------------------------------------------------------------------------
CREATE TABLE master_services (
    master_id INT NOT NULL,
    service_id INT NOT NULL,
    PRIMARY KEY (master_id, service_id),
    CONSTRAINT fk_master_services_master
        FOREIGN KEY (master_id) REFERENCES masters(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_master_services_service
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. schedules — рабочие дни мастеров. UNIQUE(master_id, work_date).
--     master_id → masters.user_id CASCADE; created_by → users.id RESTRICT.
-- -----------------------------------------------------------------------------
CREATE TABLE schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    master_id INT NOT NULL,
    work_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_min INT NOT NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_schedules_master_date (master_id, work_date),
    CONSTRAINT chk_schedules_slot_min
        CHECK (slot_min > 0 AND slot_min % 15 = 0),
    CONSTRAINT fk_schedules_master
        FOREIGN KEY (master_id) REFERENCES masters(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_schedules_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. time_slots — материализованные слоты. status ENUM('free','busy').
--     schedule_id → schedules.id CASCADE; master_id → masters.user_id CASCADE.
--     Индекс (master_id, slot_start) — поиск свободных слотов.
-- -----------------------------------------------------------------------------
CREATE TABLE time_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id INT NOT NULL,
    master_id INT NOT NULL,
    slot_date DATE NOT NULL,
    slot_start DATETIME NOT NULL,
    slot_end DATETIME NOT NULL,
    status ENUM('free','busy') NOT NULL DEFAULT 'free',
    CONSTRAINT fk_time_slots_schedule
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_time_slots_master
        FOREIGN KEY (master_id) REFERENCES masters(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_time_slots_master_start (master_id, slot_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. appointments — записи клиентов. 
--     client_id → users.id RESTRICT; master_id → users.id RESTRICT;
--     service_id → services.id RESTRICT.
--     Индексы (client_id, start_at), (master_id, start_at).
-- -----------------------------------------------------------------------------
CREATE TABLE appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    master_id INT NOT NULL,
    service_id INT NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    status ENUM('Created','Confirmed','InService','Completed','Cancelled','Rescheduled','Archived')
        NOT NULL DEFAULT 'Created',
    base_price DECIMAL(10,2) NOT NULL,
    actual_price DECIMAL(10,2) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_appointments_client
        FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_appointments_master
        FOREIGN KEY (master_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_appointments_service
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_appointments_client_start (client_id, start_at),
    INDEX idx_appointments_master_start (master_id, start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. appointment_time_slots — N:M связь записи и слотов (один appointment может
--     занимать несколько подряд идущих слотов). CASCADE с обеих сторон.
-- -----------------------------------------------------------------------------
CREATE TABLE appointment_time_slots (
    appointment_id INT NOT NULL,
    time_slot_id INT NOT NULL,
    PRIMARY KEY (appointment_id, time_slot_id),
    CONSTRAINT fk_ats_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ats_time_slot
        FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. appointment_status_history — журнал переходов state machine.
--     appointment_id CASCADE; changed_by → users.id RESTRICT.
-- -----------------------------------------------------------------------------
CREATE TABLE appointment_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    changed_by INT NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comment VARCHAR(255) NULL,
    CONSTRAINT fk_ash_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ash_changed_by
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_ash_appointment (appointment_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 15. reports — метаданные сформированных отчётов.
--     created_by → users.id RESTRICT; client_id → users.id NULL (SET NULL).
-- -----------------------------------------------------------------------------
CREATE TABLE reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('revenue','master_load','client_history') NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    client_id INT NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12,2) NULL,
    CONSTRAINT chk_reports_period
        CHECK (date_from <= date_to),
    CONSTRAINT fk_reports_client
        FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_reports_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 16. report_items — строки отчётов. report_id CASCADE.
-- -----------------------------------------------------------------------------
CREATE TABLE report_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    report_id INT NOT NULL,
    label VARCHAR(255) NOT NULL,
    value_num DECIMAL(12,2) NULL,
    value_text VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_report_items_report
        FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 17. archives — периоды архивации. UNIQUE(date_from, date_to).
--     created_by → users.id RESTRICT.
-- -----------------------------------------------------------------------------
CREATE TABLE archives (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_archives_period (date_from, date_to),
    CONSTRAINT chk_archives_period
        CHECK (date_from <= date_to),
    CONSTRAINT fk_archives_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 18. archived_appointments — снимки записей. payload JSON NOT NULL.
--     archive_id → archives.id CASCADE. На source_appointment_id FK не ставим:
--     исходные appointments в итоге маркируются 'Archived' (мягкая архивация),
--     но могут быть удалены администратором независимо.
-- -----------------------------------------------------------------------------
CREATE TABLE archived_appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    archive_id INT NOT NULL,
    source_appointment_id BIGINT NOT NULL,
    client_id INT NOT NULL,
    master_id INT NOT NULL,
    service_id INT NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    status_before VARCHAR(32) NOT NULL,
    actual_price DECIMAL(10,2) NULL,
    payload JSON NOT NULL,
    CONSTRAINT fk_archived_appointments_archive
        FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_archived_appointments_source (source_appointment_id),
    INDEX idx_archived_appointments_archive (archive_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- VIEW visit_history_v — история посещений (Completed/Cancelled/Archived).
-- -----------------------------------------------------------------------------
CREATE VIEW visit_history_v AS
SELECT
    id,
    client_id,
    master_id,
    service_id,
    start_at,
    end_at,
    status,
    actual_price
FROM appointments
WHERE status IN ('Completed', 'Cancelled', 'Archived');