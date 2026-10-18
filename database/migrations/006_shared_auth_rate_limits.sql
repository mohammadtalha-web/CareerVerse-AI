USE careerverse_ai;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL,
  window_expires_at DATETIME(3) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_hash),
  KEY auth_rate_limits_expiry_idx (window_expires_at)
) ENGINE=InnoDB;
