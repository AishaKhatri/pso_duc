CREATE TABLE `emqx_connections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(50) NOT NULL,
  `username` varchar(50) NOT NULL,
  `peername` varchar(50) NOT NULL,
  `status` varchar(50) NOT NULL,
  `time_stamp` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

insert into emqx_connections(client_id, username, peername, status, time_stamp) values ('test_from_cmd', 'username', '127.0.0.1', 'test', FROM_UNIXTIME(1770899275979/1000));