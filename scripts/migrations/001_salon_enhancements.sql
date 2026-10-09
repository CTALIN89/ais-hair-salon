-- ----- 1. service_categories.sort_order INT NOT NULL DEFAULT 0 ---------------
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE service_categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name   = 'service_categories'
    AND column_name  = 'sort_order'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----- 2. services.image_url VARCHAR(512) NULL --------------------------------
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE services ADD COLUMN image_url VARCHAR(512) NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name   = 'services'
    AND column_name  = 'image_url'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----- 3. masters.photo_url VARCHAR(512) NULL ---------------------------------
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE masters ADD COLUMN photo_url VARCHAR(512) NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name   = 'masters'
    AND column_name  = 'photo_url'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----- 4. appointment_status_history (CREATE TABLE IF NOT EXISTS) -------------
CREATE TABLE IF NOT EXISTS appointment_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    changed_by INT NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comment VARCHAR(255) NULL,
    CONSTRAINT fk_ash_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ash_changed_by
        FOREIGN KEY (changed_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_ash_appointment (appointment_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;