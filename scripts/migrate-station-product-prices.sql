-- Migration: add product-price columns to stations + nozzles.
--
-- stations.{price_pmg, price_hsd, price_hobc, prices_updated_at}
--   Populated by the super-admin Prices upload page from the PSO price-change
--   Excel files. Per-product price, per customer_code. NULL = no price filed
--   yet for that station/product.
--
-- nozzles.actual_price
--   Materialized copy of the station's price for that nozzle's product. Kept
--   in sync on (a) price-file upload (UPDATE nozzles JOIN stations) and (b)
--   nozzle config save. Differs from nozzles.price_per_liter, which is the
--   live price the dispenser is currently using; the gap is the operator
--   action item ("device price doesn't match the filed price").
--
-- Idempotent.

-- stations.price_pmg
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'stations'
    AND column_name = 'price_pmg'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE stations ADD COLUMN price_pmg DECIMAL(10,2) DEFAULT NULL AFTER division',
  'SELECT ''stations.price_pmg already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stations.price_hsd
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'stations'
    AND column_name = 'price_hsd'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE stations ADD COLUMN price_hsd DECIMAL(10,2) DEFAULT NULL AFTER price_pmg',
  'SELECT ''stations.price_hsd already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stations.price_hobc
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'stations'
    AND column_name = 'price_hobc'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE stations ADD COLUMN price_hobc DECIMAL(10,2) DEFAULT NULL AFTER price_hsd',
  'SELECT ''stations.price_hobc already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stations.prices_updated_at
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'stations'
    AND column_name = 'prices_updated_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE stations ADD COLUMN prices_updated_at TIMESTAMP NULL DEFAULT NULL AFTER price_hobc',
  'SELECT ''stations.prices_updated_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- nozzles.actual_price
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = DATABASE() AND table_name = 'nozzles'
    AND column_name = 'actual_price'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE nozzles ADD COLUMN actual_price DECIMAL(10,2) DEFAULT NULL AFTER price_per_liter',
  'SELECT ''nozzles.actual_price already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
