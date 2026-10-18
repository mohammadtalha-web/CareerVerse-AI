USE careerverse_ai;

CREATE TABLE IF NOT EXISTS pending_email_registrations (
  email VARCHAR(254) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('job_seeker', 'recruiter') NOT NULL,
  university_name VARCHAR(160) NULL,
  password_salt CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash CHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  challenge_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  resend_after DATETIME(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (email),
  KEY pending_email_registrations_expiry_idx (expires_at)
) ENGINE=InnoDB;
