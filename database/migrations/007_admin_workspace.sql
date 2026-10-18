USE careerverse_ai;

ALTER TABLE users
  MODIFY role ENUM('job_seeker', 'recruiter', 'admin') NOT NULL DEFAULT 'job_seeker';

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  action ENUM('recruiter_verified', 'recruiter_unverified') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY admin_audit_actor_created_idx (actor_user_id, created_at),
  KEY admin_audit_target_created_idx (target_user_id, created_at),
  CONSTRAINT admin_audit_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT admin_audit_target_fk
    FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
