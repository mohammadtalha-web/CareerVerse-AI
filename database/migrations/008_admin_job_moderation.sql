USE careerverse_ai;

ALTER TABLE admin_audit_log
  MODIFY action ENUM(
    'recruiter_verified',
    'recruiter_unverified',
    'job_published',
    'job_unpublished',
    'job_closed'
  ) NOT NULL,
  ADD COLUMN target_job_id BIGINT UNSIGNED NULL AFTER target_user_id,
  ADD KEY admin_audit_job_created_idx (target_job_id, created_at),
  ADD CONSTRAINT admin_audit_job_fk
    FOREIGN KEY (target_job_id) REFERENCES jobs (id) ON DELETE SET NULL;
