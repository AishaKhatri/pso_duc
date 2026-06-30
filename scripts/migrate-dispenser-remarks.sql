-- Migration: operator remarks/comments for dispensers, with full history.
--
-- dispenser_remarks (append-only history / archive)
--   One row per remark ever added, so a dispenser's timeline is preserved —
--   e.g. "declared faulty (with the issue), later fixed (with what was done)".
--   Keyed by the dispenser `address` (D-prefixed), matching how errors/resets
--   and the device-status popup identify a dispenser. Records who added it
--   (username + user id), from which IP, and when. No FK to dispensers: history
--   is retained even if a dispenser is later removed.
--
-- dispensers.{remark, remark_at}
--   Denormalized snapshot of the LATEST remark + when it was added, kept in sync
--   on every add. Lets the dispenser list (/api/dispensers[-full], polled every
--   ~10s) render the current remark inline without a per-row
--   greatest-n-per-group lookup. The author + IP are NOT mirrored here — they
--   live in dispenser_remarks and show up in the history view.
--   Only admin / super_admin can write (enforced in the API); everyone reads.
--
-- Idempotent.

-- Self-heal: an earlier version of this migration created dispenser_remarks
-- keyed by (customer_code, dispenser_id). If such a stale table exists (no
-- `address` column), drop it so the current address-keyed shape is created
-- below. Safe — the feature shipped with this schema, so no real remark data
-- predates the address key.
SET @stale := (
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
    WHERE table_schema = DATABASE() AND table_name = 'dispenser_remarks') = 1
  AND
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = DATABASE() AND table_name = 'dispenser_remarks'
      AND column_name = 'address') = 0
);
SET @sql := IF(@stale, 'DROP TABLE `dispenser_remarks`', 'SELECT ''dispenser_remarks shape OK''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `dispenser_remarks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `address` varchar(9) NOT NULL,
  `customer_code` varchar(8) DEFAULT NULL,
  `remark` text NOT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_ip` varchar(64) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dispenser_remarks_lookup` (`address`,`created_at`),
  KEY `idx_dispenser_remarks_customer` (`customer_code`)
) ENGINE=InnoDB;

-- Add customer_code to an existing (address-keyed) table that predates it.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispenser_remarks'
    AND column_name = 'customer_code'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE dispenser_remarks ADD COLUMN customer_code VARCHAR(8) DEFAULT NULL AFTER address, ADD KEY idx_dispenser_remarks_customer (customer_code)',
  'SELECT ''dispenser_remarks.customer_code already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dispensers.remark
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispensers'
    AND column_name = 'remark'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE dispensers ADD COLUMN remark TEXT DEFAULT NULL AFTER created_at',
  'SELECT ''dispensers.remark already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dispensers.remark_at (when the latest remark was added)
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'dispensers'
    AND column_name = 'remark_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE dispensers ADD COLUMN remark_at TIMESTAMP NULL DEFAULT NULL AFTER remark',
  'SELECT ''dispensers.remark_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
