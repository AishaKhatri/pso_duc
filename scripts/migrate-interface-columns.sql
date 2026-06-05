-- Migration: replace the IR/keypad lock model with a single per-dispenser
-- `interface` + `interface_lock_status` pair, and drop per-nozzle keypad
-- columns.
--
-- Run on the central DB after deploying the new server build. Idempotent
-- where possible — uses INFORMATION_SCHEMA guards so re-running is safe.

-- ---------------------------------------------------------------------------
-- dispensers
-- ---------------------------------------------------------------------------

-- Add `interface_type` (defaults to 'ir' for existing rows so the NOT NULL
-- constraint holds; real value will be overwritten on next registration).
-- Column is named `interface_type` rather than `interface` because INTERFACE
-- is a MySQL reserved word and a JS strict-mode reserved identifier.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispensers'
    AND column_name = 'interface_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE dispensers ADD COLUMN interface_type ENUM(''ir'',''keypad'') NOT NULL DEFAULT ''ir'' AFTER connected_at',
  'SELECT ''dispensers.interface_type already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add `interface_lock_status` defaulted to 1 (unlocked) for ALL existing rows.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispensers'
    AND column_name = 'interface_lock_status'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE dispensers ADD COLUMN interface_lock_status TINYINT NOT NULL DEFAULT 1 AFTER interface_type',
  'SELECT ''dispensers.interface_lock_status already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the old ir_lock_status column.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispensers'
    AND column_name = 'ir_lock_status'
);
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE dispensers DROP COLUMN ir_lock_status',
  'SELECT ''dispensers.ir_lock_status already dropped''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- nozzles, nozzle_history, nozzle_history_archive: drop keypad_lock_status
-- ---------------------------------------------------------------------------

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzles'
    AND column_name = 'keypad_lock_status'
);
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE nozzles DROP COLUMN keypad_lock_status',
  'SELECT ''nozzles.keypad_lock_status already dropped''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzle_history'
    AND column_name = 'keypad_lock_status'
);
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE nozzle_history DROP COLUMN keypad_lock_status',
  'SELECT ''nozzle_history.keypad_lock_status already dropped''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzle_history_archive'
    AND column_name = 'keypad_lock_status'
);
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE nozzle_history_archive DROP COLUMN keypad_lock_status',
  'SELECT ''nozzle_history_archive.keypad_lock_status already dropped''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
