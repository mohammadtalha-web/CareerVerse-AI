USE careerverse_ai;

ALTER TABLE jobs
  ADD COLUMN moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD KEY jobs_moderation_visibility_idx (status, moderation_hidden, published_at);

ALTER TABLE networking_profiles
  ADD COLUMN moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD KEY networking_profiles_moderation_visibility_idx (visibility, moderation_hidden, updated_at);

ALTER TABLE networking_posts
  ADD COLUMN moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD KEY networking_posts_moderation_visibility_idx (moderation_hidden, created_at, id);

ALTER TABLE admin_audit_log
  MODIFY action ENUM(
    'recruiter_verified',
    'recruiter_unverified',
    'job_published',
    'job_unpublished',
    'job_closed',
    'job_hidden',
    'job_restored',
    'post_hidden',
    'post_restored',
    'profile_hidden',
    'profile_restored',
    'report_dismissed'
  ) NOT NULL,
  ADD COLUMN target_post_id BIGINT UNSIGNED NULL AFTER target_job_id,
  ADD COLUMN target_profile_user_id BIGINT UNSIGNED NULL AFTER target_post_id,
  ADD COLUMN reason VARCHAR(1000) NULL AFTER action,
  ADD KEY admin_audit_post_created_idx (target_post_id, created_at),
  ADD KEY admin_audit_profile_created_idx (target_profile_user_id, created_at),
  ADD CONSTRAINT admin_audit_post_fk
    FOREIGN KEY (target_post_id) REFERENCES networking_posts (id) ON DELETE SET NULL,
  ADD CONSTRAINT admin_audit_profile_fk
    FOREIGN KEY (target_profile_user_id) REFERENCES networking_profiles (user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS content_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_user_id BIGINT UNSIGNED NOT NULL,
  target_type ENUM('post', 'profile', 'job') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  reason_category ENUM('spam_scam', 'harassment', 'inappropriate', 'misleading', 'other') NOT NULL,
  details VARCHAR(1000) NULL,
  status ENUM('pending', 'actioned', 'dismissed') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  open_report_key VARCHAR(40)
    GENERATED ALWAYS AS (
      CASE WHEN status = 'pending' THEN CONCAT(target_type, ':', target_id) ELSE NULL END
    ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY content_reports_one_open_per_reporter_unique (reporter_user_id, open_report_key),
  KEY content_reports_status_created_idx (status, created_at, id),
  KEY content_reports_target_idx (target_type, target_id, created_at),
  CONSTRAINT content_reports_reporter_fk
    FOREIGN KEY (reporter_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT content_reports_reviewer_fk
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
