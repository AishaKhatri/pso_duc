-- Migration: persist power-on reset events.
--
-- Previously kept in mqtt-service.js in-memory Maps (powerOnCache,
-- resetCounters, clearedResetsCache) and lost on every server restart.
-- This table moves them into the central DB so cleared state survives
-- restarts and the UI sees all historical resets (not just the most recent
-- 20 per dispenser).
--
-- `dedup_key` (MD5 hex of the identifying fields) + UNIQUE index dedupe at
-- the DB level. Application computes the hash in node and uses INSERT IGNORE
-- — MQTT QoS-1 redeliveries and device-side replays-after-server-restart
-- collide on the unique key and the DB silently drops them.
--
-- Idempotent.

SET @tbl_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE table_schema = DATABASE() AND table_name = 'resets'
);
SET @sql := IF(@tbl_exists = 0,
  'CREATE TABLE `resets` (
    `id` int NOT NULL AUTO_INCREMENT,
    `customer_code` varchar(8) NOT NULL,
    `address` varchar(9) NOT NULL,
    `message` varchar(64) DEFAULT NULL,
    `die_time` datetime NULL DEFAULT NULL,
    `wakeup_time` datetime NULL DEFAULT NULL,
    `downtime_ms` bigint DEFAULT NULL,
    `cleared` tinyint NOT NULL DEFAULT 0,
    `dedup_key` CHAR(32) DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_resets_dedup_key` (`dedup_key`),
    KEY `idx_customer_code_address` (`customer_code`,`address`),
    KEY `idx_address` (`address`),
    KEY `idx_cleared` (`cleared`)
  ) ENGINE=InnoDB',
  'SELECT ''resets already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
