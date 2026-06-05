-- Migration: convert child FK constraints to ON UPDATE CASCADE so that
-- changing a parent's identifier (most importantly `dispensers.dispenser_id`)
-- propagates to child rows automatically.
--
-- Tables affected: nozzles, nozzle_history, transactions.
-- Idempotent: only drops a constraint if it exists, only re-creates if it does
-- not.

-- ---------------------------------------------------------------------------
-- nozzles_ibfk_1: nozzles -> dispensers(customer_code, dispenser_id)
-- ---------------------------------------------------------------------------
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE constraint_schema = DATABASE() AND table_name = 'nozzles'
    AND constraint_name = 'nozzles_ibfk_1'
);
SET @sql := IF(@fk_exists > 0,
  'ALTER TABLE nozzles DROP FOREIGN KEY nozzles_ibfk_1',
  'SELECT ''nozzles_ibfk_1 not present, skipping drop''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE nozzles
  ADD CONSTRAINT nozzles_ibfk_1
  FOREIGN KEY (customer_code, dispenser_id)
  REFERENCES dispensers (customer_code, dispenser_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- nozzle_history_ibfk_1: nozzle_history -> nozzles
-- ---------------------------------------------------------------------------
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE constraint_schema = DATABASE() AND table_name = 'nozzle_history'
    AND constraint_name = 'nozzle_history_ibfk_1'
);
SET @sql := IF(@fk_exists > 0,
  'ALTER TABLE nozzle_history DROP FOREIGN KEY nozzle_history_ibfk_1',
  'SELECT ''nozzle_history_ibfk_1 not present, skipping drop''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE nozzle_history
  ADD CONSTRAINT nozzle_history_ibfk_1
  FOREIGN KEY (customer_code, dispenser_id, nozzle_id)
  REFERENCES nozzles (customer_code, dispenser_id, nozzle_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- transactions_ibfk_1: transactions -> nozzles
-- ---------------------------------------------------------------------------
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE constraint_schema = DATABASE() AND table_name = 'transactions'
    AND constraint_name = 'transactions_ibfk_1'
);
SET @sql := IF(@fk_exists > 0,
  'ALTER TABLE transactions DROP FOREIGN KEY transactions_ibfk_1',
  'SELECT ''transactions_ibfk_1 not present, skipping drop''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_ibfk_1
  FOREIGN KEY (customer_code, dispenser_id, nozzle_id)
  REFERENCES nozzles (customer_code, dispenser_id, nozzle_id)
  ON DELETE CASCADE ON UPDATE CASCADE;
