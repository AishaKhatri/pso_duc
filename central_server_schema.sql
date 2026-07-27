CREATE DATABASE IF NOT EXISTS `DUC_RPi`;

USE `DUC`;

CREATE TABLE `stations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `customer_code` varchar(8) NOT NULL,
  `station_id` varchar(255) NOT NULL,
  `city` varchar(255) NOT NULL,
  `district` varchar(255) DEFAULT NULL,
  `division` varchar(255) DEFAULT NULL,
  `price_pmg` decimal(10,2) DEFAULT NULL,
  `price_hsd` decimal(10,2) DEFAULT NULL,
  `price_hobc` decimal(10,2) DEFAULT NULL,
  `prices_updated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `customer_code` (`customer_code`)
) ENGINE=InnoDB;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('super_admin','admin','operator','viewer') NOT NULL DEFAULT 'viewer',
  `customer_code` varchar(8) DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `allow_price_update` tinyint NOT NULL DEFAULT '0',
  `last_login` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_users_customer_code` (`customer_code`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`customer_code`) REFERENCES `stations` (`customer_code`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `session_token` varchar(255) NOT NULL,
  `signed_in` tinyint NOT NULL DEFAULT '1',
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_token` (`session_token`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_signed_in` (`signed_in`),
  CONSTRAINT `sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Activity log: server-wide audit trail of user actions (signin/out, CRUD on
-- managed entities, MQTT publishes, clear-error/reset actions). user_id is
-- nullable so signin failures / unauthenticated events can still be recorded.
CREATE TABLE IF NOT EXISTS `activity_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `entity_type` varchar(32) DEFAULT NULL,
  `entity_id` varchar(128) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `activity_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per long-outage event (>=12h continuously offline). cleared_at is
-- filled when the device reconnects, so an active outage is `cleared_at IS NULL`.
CREATE TABLE IF NOT EXISTS `long_outage_alerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dispenser_id` varchar(50) NOT NULL,
  `address` varchar(9) NOT NULL,
  `customer_code` varchar(8) DEFAULT NULL,
  `offline_since` timestamp NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `cleared_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_address` (`address`),
  KEY `idx_cleared_at` (`cleared_at`)
) ENGINE=InnoDB;

-- Append-only audit of every price change made from the Prices page, whether by
-- PSO price-file upload or by manual entry. One row per (station, product) whose
-- price was written, so the change history survives the next overwrite of the
-- live stations row. Written inside the same transaction as the stations update.
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

CREATE TABLE `dispensers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `address` varchar(9) NOT NULL,
  `conn_status` tinyint NOT NULL DEFAULT '0',
  `connected_at` timestamp NULL DEFAULT NULL,
  `interface_type` enum('ir','keypad') NOT NULL DEFAULT 'ir',
  `interface_lock_status` tinyint NOT NULL DEFAULT '1',
  `number_of_nozzles` int NOT NULL,
  `DispenserBrand` varchar(255) NOT NULL,
  `imei1` varchar(50) DEFAULT NULL,
  `imei2` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `remark` text,
  `remark_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_address` (`address`),
  UNIQUE KEY `idx_customer_dispenser` (`customer_code`,`dispenser_id`),
  CONSTRAINT `dispensers_ibfk_1` FOREIGN KEY (`customer_code`) REFERENCES `stations` (`customer_code`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `dispenser_remarks` (
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

CREATE TABLE `nozzles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `product` varchar(50) NOT NULL,
  -- status: 0 = device online but no MB comm, 1 = device + MB OK, 2 = no recent ping (device unreachable)
  `status` tinyint NOT NULL DEFAULT '2',
  `last_ping_at` timestamp NULL DEFAULT NULL,
  `price_per_liter` decimal(10,2) NOT NULL DEFAULT '0.00',
  `actual_price` decimal(10,2) DEFAULT NULL,
  `total_quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_sales_today` decimal(15,2) NOT NULL DEFAULT '0.00',
  `lock_unlock` tinyint NOT NULL DEFAULT '0',
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_nozzle_per_dispenser` (`customer_code`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzles_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`) REFERENCES `dispensers` (`customer_code`,`dispenser_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `nozzle_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `product` varchar(50) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '2',
  `last_ping_at` timestamp NULL DEFAULT NULL,
  `price_per_liter` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_sales_today` decimal(15,2) NOT NULL DEFAULT '0.00',
  `lock_unlock` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nozzle_history` (`customer_code`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzle_history_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`customer_code`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `time` datetime NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `volume` decimal(15,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `station_dispenser_nozzle` (`customer_code`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`customer_code`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `network_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `address` varchar(9) NOT NULL,
  `connection_type` enum('GSM','WIFI') NOT NULL,
  `apn_ssid` varchar(255) DEFAULT NULL,
  `ipv4` varchar(15) DEFAULT NULL,
  `signal_strength` int DEFAULT NULL,
  `master_sim` tinyint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_code_address` (`customer_code`,`address`),
  KEY `idx_connection_type` (`connection_type`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB;

CREATE TABLE `device_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `address` varchar(9) NOT NULL,
  `firmware_version` varchar(50) DEFAULT NULL,
  `hardware_version` varchar(50) DEFAULT NULL,
  `wifi_enable` tinyint DEFAULT NULL,
  `last_die_time` bigint DEFAULT NULL,
  `wakeup_time` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_code_address` (`customer_code`,`address`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB;

CREATE TABLE `errors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `address` varchar(9) NOT NULL,
  `error_message` json NOT NULL,
  `cleared` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_code_address` (`customer_code`,`address`),
  KEY `idx_address` (`address`),
  KEY `idx_cleared` (`cleared`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `address` varchar(9) NOT NULL,
  `message` varchar(64) DEFAULT NULL,
  `die_time` datetime NULL DEFAULT NULL,
  `wakeup_time` datetime NULL DEFAULT NULL,
  `downtime_ms` bigint DEFAULT NULL,
  `cleared` tinyint NOT NULL DEFAULT '0',
  -- MD5 hex digest of (address|die_time|wakeup_time|message), computed in node
  -- before INSERT. Combined with INSERT IGNORE this drops both MQTT QoS-1
  -- redeliveries and device-side replays after a server restart.
  `dedup_key` char(32) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resets_dedup_key` (`dedup_key`),
  KEY `idx_customer_code_address` (`customer_code`,`address`),
  KEY `idx_address` (`address`),
  KEY `idx_cleared` (`cleared`)
) ENGINE=InnoDB;