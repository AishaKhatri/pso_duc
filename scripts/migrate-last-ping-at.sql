-- Migration: add `last_ping_at` to nozzles + history tables, and prepare for
-- the new tri-state `nozzles.status` semantics.
--
-- After this runs:
--   nozzles.status =
--     1  = device + dispenser MB both OK (msg_type=0 with message="1")
--     0  = device online but MB silent (msg_type=0 with message="0")
--     2  = no recent ping (offline detector after 10 min of silence)
--
-- The status column itself stays TINYINT — no constraint change needed.
-- Idempotent.

-- ---------------------------------------------------------------------------
-- nozzles
-- ---------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzles'
    AND column_name = 'last_ping_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE nozzles ADD COLUMN `last_ping_at` TIMESTAMP NULL DEFAULT NULL AFTER `status`',
  'SELECT ''nozzles.last_ping_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- nozzle_history
-- ---------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzle_history'
    AND column_name = 'last_ping_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE nozzle_history ADD COLUMN `last_ping_at` TIMESTAMP NULL DEFAULT NULL AFTER `status`',
  'SELECT ''nozzle_history.last_ping_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- nozzle_history_archive
-- ---------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzle_history_archive'
    AND column_name = 'last_ping_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE nozzle_history_archive ADD COLUMN `last_ping_at` TIMESTAMP NULL DEFAULT NULL AFTER `status`',
  'SELECT ''nozzle_history_archive.last_ping_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
