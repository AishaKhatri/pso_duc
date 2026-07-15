-- Migration: add the prices_archive audit table.
--
-- Append-only log of every price change made from the super-admin Prices page,
-- whether by PSO price-file upload or by manual entry. One row per
-- (station, product) whose price was written, capturing who set it and to what:
--   customer_code, station_id, city, district  — station identity at write time
--   updated_by_id / updated_by                 — the signed-in user
--   source                                     — 'upload' | 'manual'
--   product, price                             — what was set
--   created_at                                 — when
--
-- Rows are inserted inside the same transaction as the stations price UPDATE
-- (see /api/admin/upload-prices and /api/admin/prices/manual), so the audit
-- trail commits atomically with the change it records. Never updated or deleted.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `prices_archive` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `station_id` varchar(255) DEFAULT NULL,
  `city` varchar(255) DEFAULT NULL,
  `district` varchar(255) DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `source` enum('upload','manual') NOT NULL,
  `product` enum('PMG','HSD','HOBC') NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prices_archive_customer` (`customer_code`),
  KEY `idx_prices_archive_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
