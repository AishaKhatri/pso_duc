CREATE DATABASE IF NOT EXISTS `DUC`;

USE `DUC`;

CREATE TABLE `stations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `customer_code` varchar(8) NOT NULL,
  `station_id` varchar(255) NOT NULL,
  `city` varchar(255) NOT NULL,
  `district` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `customer_code` (`customer_code`)
) ENGINE=InnoDB;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','operator','viewer') NOT NULL DEFAULT 'viewer',
  `customer_code` varchar(8) DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
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

CREATE TABLE `dispensers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `address` varchar(8) NOT NULL,
  `conn_status` tinyint NOT NULL DEFAULT '0',
  `connected_at` timestamp NULL DEFAULT NULL,
  `ir_lock_status` tinyint NOT NULL DEFAULT '0',
  `number_of_nozzles` int NOT NULL,
  `DispenserBrand` varchar(255) NOT NULL,
  `imei1` varchar(50) DEFAULT NULL,
  `imei2` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_address` (`address`),
  UNIQUE KEY `idx_customer_dispenser` (`customer_code`,`dispenser_id`),
  CONSTRAINT `dispensers_ibfk_1` FOREIGN KEY (`customer_code`) REFERENCES `stations` (`customer_code`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `connections_history` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `dispenser_id` varchar(50) NOT NULL,
  `address` varchar(8) NOT NULL,
  `conn_status` tinyint NOT NULL DEFAULT '0',
  `connected_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `ping_log` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `nozzles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `product` varchar(50) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '0',
  `price_per_liter` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_sales_today` decimal(15,2) NOT NULL DEFAULT '0.00',
  `lock_unlock` tinyint NOT NULL DEFAULT '0',
  `keypad_lock_status` tinyint NOT NULL DEFAULT '0',
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_nozzle_per_dispenser` (`customer_code`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzles_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`) REFERENCES `dispensers` (`customer_code`,`dispenser_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `nozzle_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `product` varchar(50) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `price_per_liter` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total_sales_today` decimal(15,2) NOT NULL DEFAULT '0.00',
  `lock_unlock` tinyint NOT NULL DEFAULT '0',
  `keypad_lock_status` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nozzle_history` (`customer_code`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzle_history_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`customer_code`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE
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
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`customer_code`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`customer_code`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `network_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_code` varchar(8) NOT NULL,
  `address` varchar(8) NOT NULL,
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
  `address` varchar(8) NOT NULL,
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
  `address` varchar(8) NOT NULL,
  `error_message` json NOT NULL,
  `cleared` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_code_address` (`customer_code`,`address`),
  KEY `idx_address` (`address`),
  KEY `idx_cleared` (`cleared`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;