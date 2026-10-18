USE careerverse_ai;

ALTER TABLE jobs
  ADD COLUMN salary_min DECIMAL(13,2) NULL,
  ADD COLUMN salary_max DECIMAL(13,2) NULL,
  ADD COLUMN salary_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN salary_period ENUM('hour', 'month', 'year') NULL,
  ADD KEY jobs_salary_company_idx (employer_id, salary_currency, salary_period, salary_min),
  ADD CONSTRAINT jobs_salary_range_check
    CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  ADD CONSTRAINT jobs_salary_currency_check
    CHECK (salary_currency IS NULL OR salary_currency REGEXP '^[A-Z]{3}$');

ALTER TABLE applications
  ADD COLUMN ai_screening_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ai_screening_consent_at DATETIME(3) NULL;

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
