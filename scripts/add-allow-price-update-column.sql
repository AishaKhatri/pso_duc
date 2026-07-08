-- Migration: add users.allow_price_update and grant it to existing super_admins.
-- Run once in MySQL Workbench against the live database (select the correct
-- schema first, or uncomment the USE line below).
--
-- Note: MySQL has no "ADD COLUMN IF NOT EXISTS", so the ALTER errors if the
-- column already exists — that error is harmless (it just means it's done).

-- USE `DUC`;

ALTER TABLE `users`
  ADD COLUMN `allow_price_update` tinyint NOT NULL DEFAULT '0' AFTER `is_active`;

-- Super_admins get price-file access by default.
UPDATE `users`
   SET `allow_price_update` = 1
 WHERE `role` = 'super_admin'
   AND `allow_price_update` <> 1
   AND `id` > 0;
