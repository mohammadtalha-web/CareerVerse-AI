USE careerverse_ai;

CREATE TABLE IF NOT EXISTS networking_profile_photos (
  user_id BIGINT UNSIGNED NOT NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY networking_profile_photos_storage_unique (storage_key),
  CONSTRAINT networking_profile_photos_size_check CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT networking_profile_photos_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
