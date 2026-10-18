CREATE DATABASE IF NOT EXISTS careerverse_ai
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE careerverse_ai;

CREATE TABLE IF NOT EXISTS universities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY universities_name_unique (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('job_seeker', 'recruiter', 'admin') NOT NULL DEFAULT 'job_seeker',
  university_id BIGINT UNSIGNED NULL,
  google_subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  password_salt CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash CHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recruiter_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_google_subject_unique (google_subject),
  KEY users_university_idx (university_id),
  KEY users_full_name_prefix_idx (full_name),
  FULLTEXT KEY users_full_name_fulltext (full_name),
  CONSTRAINT users_university_fk
    FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY sessions_token_hash_unique (token_hash),
  KEY sessions_user_expiry_idx (user_id, expires_at),
  KEY sessions_expiry_idx (expires_at),
  CONSTRAINT sessions_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL,
  window_expires_at DATETIME(3) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_hash),
  KEY auth_rate_limits_expiry_idx (window_expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  notification_type ENUM(
    'job_match', 'message', 'connection_request', 'connection_accepted',
    'application_received', 'application_update'
  ) NOT NULL,
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

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  target_job_id BIGINT UNSIGNED NULL,
  target_post_id BIGINT UNSIGNED NULL,
  target_profile_user_id BIGINT UNSIGNED NULL,
  action ENUM(
    'recruiter_verified', 'recruiter_unverified',
    'job_published', 'job_unpublished', 'job_closed', 'job_hidden', 'job_restored',
    'post_hidden', 'post_restored', 'profile_hidden', 'profile_restored', 'report_dismissed',
    'member_paused', 'member_resumed', 'member_deleted'
  ) NOT NULL,
  reason VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY admin_audit_actor_created_idx (actor_user_id, created_at),
  KEY admin_audit_target_created_idx (target_user_id, created_at),
  KEY admin_audit_job_created_idx (target_job_id, created_at),
  KEY admin_audit_post_created_idx (target_post_id, created_at),
  KEY admin_audit_profile_created_idx (target_profile_user_id, created_at),
  CONSTRAINT admin_audit_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT admin_audit_target_fk
    FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_tool_usage (
  user_id BIGINT UNSIGNED NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT ai_tool_usage_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type ENUM('government', 'private') NOT NULL,
  website_url VARCHAR(2048) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY job_sources_key_unique (source_key),
  CONSTRAINT job_sources_country_check CHECK (country_code REGEXP '^[A-Z]{2}$'),
  CONSTRAINT job_sources_website_check CHECK (website_url LIKE 'https://%')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employer_id BIGINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  external_id VARCHAR(200) NULL,
  slug VARCHAR(180) NOT NULL,
  title VARCHAR(160) NOT NULL,
  company_name VARCHAR(160) NOT NULL,
  location VARCHAR(180) NOT NULL DEFAULT '',
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  employment_type ENUM('full_time', 'part_time', 'contract', 'internship', 'temporary') NOT NULL,
  workplace_type ENUM('onsite', 'hybrid', 'remote') NOT NULL,
  experience VARCHAR(120) NOT NULL DEFAULT '',
  salary VARCHAR(160) NOT NULL DEFAULT '',
  salary_min DECIMAL(13,2) NULL,
  salary_max DECIMAL(13,2) NULL,
  salary_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  salary_period ENUM('hour', 'month', 'year') NULL,
  description TEXT NOT NULL,
  requirements JSON NOT NULL,
  application_url VARCHAR(2048) NULL,
  source_url VARCHAR(2048) NULL,
  status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  published_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  last_seen_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY jobs_slug_unique (slug),
  UNIQUE KEY jobs_source_external_unique (source_id, external_id),
  KEY jobs_salary_company_idx (employer_id, salary_currency, salary_period, salary_min),
  KEY jobs_search_filters_idx (status, country_code, employment_type, workplace_type, published_at),
  KEY jobs_status_published_idx (status, published_at, id),
  KEY jobs_moderation_visibility_idx (status, moderation_hidden, published_at),
  KEY jobs_title_prefix_idx (title),
  KEY jobs_company_prefix_idx (company_name),
  KEY jobs_location_prefix_idx (location),
  KEY jobs_source_status_idx (source_id, status),
  KEY jobs_employer_created_idx (employer_id, created_at, id),
  KEY jobs_source_freshness_idx (source_id, status, last_seen_at),
  FULLTEXT KEY jobs_search_text_fulltext (title, company_name, location, description),
  CONSTRAINT jobs_employer_fk
    FOREIGN KEY (employer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT jobs_source_fk
    FOREIGN KEY (source_id) REFERENCES job_sources (id) ON DELETE CASCADE,
  CONSTRAINT jobs_country_check CHECK (country_code REGEXP '^[A-Z]{2}$'),
  CONSTRAINT jobs_application_url_check CHECK (application_url IS NULL OR application_url LIKE 'https://%'),
  CONSTRAINT jobs_source_url_check CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  CONSTRAINT jobs_expiry_check CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at >= published_at),
  CONSTRAINT jobs_salary_range_check CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CONSTRAINT jobs_salary_currency_check CHECK (salary_currency IS NULL OR salary_currency REGEXP '^[A-Z]{3}$')
) ENGINE=InnoDB;

ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_job_fk
    FOREIGN KEY (target_job_id) REFERENCES jobs (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  status ENUM('applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn') NOT NULL DEFAULT 'applied',
  cover_letter TEXT NOT NULL,
  ai_screening_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ai_screening_consent_at DATETIME(3) NULL,
  ai_screening_consent_version VARCHAR(40) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY applications_user_job_unique (user_id, job_id),
  KEY applications_user_created_idx (user_id, created_at),
  KEY applications_job_status_idx (job_id, status),
  KEY applications_job_created_idx (job_id, created_at, id),
  CONSTRAINT applications_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT applications_job_fk
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_resumes (
  application_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type ENUM('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id),
  UNIQUE KEY application_resumes_storage_unique (storage_key),
  KEY application_resumes_user_created_idx (user_id, created_at),
  CONSTRAINT application_resumes_application_fk
    FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT application_resumes_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT application_resumes_size_check CHECK (byte_size BETWEEN 1 AND 5242880)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_application_screenings (
  application_id BIGINT UNSIGNED NOT NULL,
  screened_by BIGINT UNSIGNED NOT NULL,
  model VARCHAR(120) NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  screened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id),
  KEY ai_screenings_recruiter_date_idx (screened_by, screened_at),
  CONSTRAINT ai_screenings_application_fk
    FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT ai_screenings_recruiter_fk
    FOREIGN KEY (screened_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ai_screenings_score_check CHECK (score BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id BIGINT UNSIGNED NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, job_id),
  KEY saved_jobs_user_created_idx (user_id, created_at, job_id),
  KEY saved_jobs_job_idx (job_id),
  CONSTRAINT saved_jobs_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT saved_jobs_job_fk
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS company_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(100) NOT NULL,
  company_name VARCHAR(160) NOT NULL,
  industry VARCHAR(120) NOT NULL DEFAULT '',
  headquarters VARCHAR(180) NOT NULL DEFAULT '',
  website_url VARCHAR(2048) NULL,
  description TEXT NOT NULL,
  employee_count INT UNSIGNED NULL,
  employee_count_as_of DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY company_profiles_owner_unique (owner_user_id),
  UNIQUE KEY company_profiles_slug_unique (slug),
  KEY company_profiles_name_idx (company_name),
  CONSTRAINT company_profiles_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT company_profiles_website_check CHECK (website_url IS NULL OR website_url LIKE 'https://%')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS networking_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  profile_slug VARCHAR(80) NOT NULL,
  headline VARCHAR(160) NOT NULL DEFAULT '',
  location VARCHAR(180) NOT NULL DEFAULT '',
  bio TEXT NOT NULL,
  skills JSON NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY networking_profiles_slug_unique (profile_slug),
  KEY networking_profiles_visibility_updated_idx (visibility, updated_at),
  KEY networking_profiles_moderation_visibility_idx (visibility, moderation_hidden, updated_at),
  KEY networking_profiles_headline_prefix_idx (visibility, headline),
  KEY networking_profiles_location_prefix_idx (visibility, location),
  FULLTEXT KEY networking_profiles_search_fulltext (headline, location, bio),
  CONSTRAINT networking_profiles_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

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
  KEY networking_blocks_owner_created_idx (blocker_id, created_at, blocked_id),
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
  moderation_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY networking_posts_created_idx (created_at),
  KEY networking_posts_user_created_idx (user_id, created_at),
  KEY networking_posts_moderation_visibility_idx (moderation_hidden, created_at, id),
  CONSTRAINT networking_posts_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_posts_url_check
    CHECK (link_url IS NULL OR link_url LIKE 'https://%' OR link_url LIKE 'http://%')
) ENGINE=InnoDB;

ALTER TABLE admin_audit_log
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
  message_id BIGINT UNSIGNED NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY networking_uploads_storage_unique (storage_key),
  KEY networking_uploads_portfolio_idx (portfolio_id),
  KEY networking_uploads_post_idx (post_id),
  KEY networking_uploads_message_idx (message_id),
  CONSTRAINT networking_uploads_parent_check
    CHECK (
      (portfolio_id IS NOT NULL AND post_id IS NULL AND message_id IS NULL)
      OR (portfolio_id IS NULL AND post_id IS NOT NULL AND message_id IS NULL)
      OR (portfolio_id IS NULL AND post_id IS NULL AND message_id IS NOT NULL)
    ),
  CONSTRAINT networking_uploads_size_check CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT networking_uploads_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT networking_uploads_portfolio_fk
    FOREIGN KEY (portfolio_id) REFERENCES networking_portfolio (id) ON DELETE CASCADE,
  CONSTRAINT networking_uploads_post_fk
    FOREIGN KEY (post_id) REFERENCES networking_posts (id) ON DELETE CASCADE,
  CONSTRAINT networking_uploads_message_fk
    FOREIGN KEY (message_id) REFERENCES networking_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB;