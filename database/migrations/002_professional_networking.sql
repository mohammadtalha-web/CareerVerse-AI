USE careerverse_ai;

CREATE TABLE IF NOT EXISTS networking_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  profile_slug VARCHAR(80) NOT NULL,
  headline VARCHAR(160) NOT NULL DEFAULT '',
  location VARCHAR(180) NOT NULL DEFAULT '',
  bio TEXT NOT NULL,
  skills JSON NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY networking_profiles_slug_unique (profile_slug),
  KEY networking_profiles_visibility_updated_idx (visibility, updated_at),
  CONSTRAINT networking_profiles_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_portfolio (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  project_url VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY networking_portfolio_owner_created_idx (user_id, created_at),
  CONSTRAINT networking_portfolio_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_portfolio_url_check
    CHECK (project_url IS NULL OR project_url LIKE 'https://%')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_blocks (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT networking_blocks_not_self_check CHECK (blocker_id <> blocked_id),
  CONSTRAINT networking_blocks_blocker_fk
    FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_blocks_blocked_fk
    FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_connections (
  user_low_id BIGINT UNSIGNED NOT NULL,
  user_high_id BIGINT UNSIGNED NOT NULL,
  requester_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_low_id, user_high_id),
  KEY networking_connections_high_status_idx (user_high_id, status, updated_at),
  KEY networking_connections_low_status_idx (user_low_id, status, updated_at),
  CONSTRAINT networking_connections_not_self_check CHECK (user_low_id < user_high_id),
  CONSTRAINT networking_connections_requester_fk
    FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_connections_low_fk
    FOREIGN KEY (user_low_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_connections_high_fk
    FOREIGN KEY (user_high_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_low_id BIGINT UNSIGNED NOT NULL,
  user_high_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY networking_conversations_pair_unique (user_low_id, user_high_id),
  KEY networking_conversations_high_updated_idx (user_high_id, updated_at),
  KEY networking_conversations_low_updated_idx (user_low_id, updated_at),
  CONSTRAINT networking_conversations_not_self_check CHECK (user_low_id < user_high_id),
  CONSTRAINT networking_conversations_low_fk
    FOREIGN KEY (user_low_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_conversations_high_fk
    FOREIGN KEY (user_high_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY networking_messages_conversation_created_idx (conversation_id, created_at),
  CONSTRAINT networking_messages_conversation_fk
    FOREIGN KEY (conversation_id) REFERENCES networking_conversations (id) ON DELETE CASCADE,
  CONSTRAINT networking_messages_sender_fk
    FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  link_url VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY networking_posts_created_idx (created_at),
  KEY networking_posts_user_created_idx (user_id, created_at),
  CONSTRAINT networking_posts_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_posts_url_check
    CHECK (link_url IS NULL OR link_url LIKE 'https://%' OR link_url LIKE 'http://%')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY networking_comments_post_created_idx (post_id, created_at),
  CONSTRAINT networking_comments_post_fk
    FOREIGN KEY (post_id) REFERENCES networking_posts (id) ON DELETE CASCADE,
  CONSTRAINT networking_comments_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_reactions (
  post_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  reaction ENUM('like', 'celebrate', 'insightful') NOT NULL DEFAULT 'like',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT networking_reactions_post_fk
    FOREIGN KEY (post_id) REFERENCES networking_posts (id) ON DELETE CASCADE,
  CONSTRAINT networking_reactions_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_uploads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  portfolio_id BIGINT UNSIGNED NULL,
  post_id BIGINT UNSIGNED NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY networking_uploads_storage_unique (storage_key),
  KEY networking_uploads_portfolio_idx (portfolio_id),
  KEY networking_uploads_post_idx (post_id),
  CONSTRAINT networking_uploads_parent_check
    CHECK ((portfolio_id IS NOT NULL AND post_id IS NULL) OR (portfolio_id IS NULL AND post_id IS NOT NULL)),
  CONSTRAINT networking_uploads_size_check CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT networking_uploads_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_uploads_portfolio_fk
    FOREIGN KEY (portfolio_id) REFERENCES networking_portfolio (id) ON DELETE CASCADE,
  CONSTRAINT networking_uploads_post_fk
    FOREIGN KEY (post_id) REFERENCES networking_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB;
