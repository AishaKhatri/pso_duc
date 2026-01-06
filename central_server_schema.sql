CREATE DATABASE IF NOT EXISTS `pso_duc`;

USE `pso_duc`;

CREATE TABLE `stations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `station_id` varchar(50) NOT NULL,
  `station_name` varchar(255) NOT NULL,
  `city` varchar(255) NOT NULL,
  `province` varchar(255),
  `station_config` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `station_id` (`station_id`)
) ENGINE=InnoDB;

CREATE TABLE `dispensers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `address` varchar(5) NOT NULL,
  `conn_status` tinyint NOT NULL DEFAULT '0',
  `connected_at` timestamp NULL DEFAULT NULL,
  `ir_lock_status` tinyint NOT NULL DEFAULT '0',
  `number_of_nozzles` int NOT NULL,
  `vendor` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `station_id` (`station_id`,`dispenser_id`,`address`),
  CONSTRAINT `dispensers_ibfk_1` FOREIGN KEY (`station_id`) REFERENCES `stations` (`station_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_address` CHECK (`address` REGEXP '^[0-9]{5}$')
) ENGINE=InnoDB;

CREATE TABLE `nozzles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
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
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `quantity` decimal(15,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_nozzle_per_dispenser` (`station_id`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzles_ibfk_1` FOREIGN KEY (`station_id`,`dispenser_id`) REFERENCES `dispensers` (`station_id`,`dispenser_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `nozzle_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
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
  KEY `idx_nozzle_history` (`station_id`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `nozzle_history_ibfk_1` FOREIGN KEY (`station_id`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`station_id`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `dispenser_id` varchar(50) NOT NULL,
  `nozzle_id` varchar(50) NOT NULL,
  `time` datetime NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `volume` decimal(15,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `station_dispenser_nozzle` (`station_id`,`dispenser_id`,`nozzle_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`station_id`,`dispenser_id`,`nozzle_id`) REFERENCES `nozzles` (`station_id`,`dispenser_id`,`nozzle_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `network_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `device_type` enum('dispenser','tank') NOT NULL,
  `address` varchar(5) NOT NULL,
  `connection_type` enum('GSM','WIFI') NOT NULL,
  `apn_ssid` varchar(255) DEFAULT NULL,
  `ipv4` varchar(15) DEFAULT NULL,
  `signal_strength` int DEFAULT NULL,
  `master_sim` tinyint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_type_address` (`station_id`,`device_type`,`address`),
  KEY `idx_connection_type` (`connection_type`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB;

CREATE TABLE `tanks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `tank_id` varchar(50) NOT NULL,
  `address` varchar(5) NOT NULL,
  `product` varchar(50) NOT NULL,
  `conn_status` tinyint NOT NULL DEFAULT '0',
  `connected_at` timestamp NULL DEFAULT NULL,
  `dip_chart_path` varchar(500) NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` int DEFAULT '0',
  `temperature` decimal(5,2) DEFAULT '0.00',
  `product_level_mm` decimal(10,2) DEFAULT '0.00',
  `product_level_ltr` decimal(10,2) DEFAULT '0.00',
  `water_level_mm` decimal(10,2) DEFAULT '0.00',
  `water_level_ltr` decimal(10,2) DEFAULT '0.00',
  `last_updated` timestamp NULL DEFAULT NULL,
  `max_capacity_mm` decimal(10,2) DEFAULT '0.00',
  `max_capacity_ltr` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `tank_id` (`tank_id`,`address`),
  CONSTRAINT `chk_tank_address` CHECK (regexp_like(`address`,_cp850'^[0-9]{5}$'))
) ENGINE=InnoDB;

CREATE TABLE `device_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `device_type` enum('dispenser','tank') NOT NULL,
  `address` varchar(5) NOT NULL,
  `temperature` decimal(10,2) DEFAULT NULL,
  `firmware_version` varchar(50) DEFAULT NULL,
  `hardware_version` varchar(50) DEFAULT NULL,
  `mac_address` varchar(17) DEFAULT NULL,
  `serial_number` varchar(50) DEFAULT NULL,
  `last_die_time` bigint DEFAULT NULL,
  `wakeup_time` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_type_address` (`station_id`,`device_type`,`address`),
  KEY `idx_address` (`address`),
  KEY `idx_mac_address` (`mac_address`),
  KEY `idx_device_type` (`device_type`)
) ENGINE=InnoDB;

CREATE TABLE `errors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_id` varchar(50) NOT NULL,
  `device_type` enum('dispenser','tank') NOT NULL,
  `address` varchar(5) NOT NULL,
  `error_message` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_type_address` (`station_id`,`device_type`,`address`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;