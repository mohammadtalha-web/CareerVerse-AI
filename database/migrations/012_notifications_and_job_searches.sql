CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  notification_type ENUM('job_match', 'message', 'connection_request', 'connection_accepted') NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NOT NULL,
  href VARCHAR(512) NOT NULL,
  dedupe_key VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY notifications_user_dedupe_unique (user_id, dedupe_key),
  KEY notifications_user_created_idx (user_id, created_at, id),
  KEY notifications_user_unread_idx (user_id, read_at, created_at, id),
  CONSTRAINT notifications_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT notifications_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  auth_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY push_subscriptions_endpoint_unique (endpoint_hash),
  KEY push_subscriptions_user_idx (user_id),
  CONSTRAINT push_subscriptions_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_search_history (
  user_id BIGINT UNSIGNED NOT NULL,
  search_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  query_text VARCHAR(100) NOT NULL DEFAULT '',
  location_text VARCHAR(100) NOT NULL DEFAULT '',
  last_searched_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, search_hash),
  KEY job_search_history_recent_idx (last_searched_at, user_id),
  CONSTRAINT job_search_history_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
