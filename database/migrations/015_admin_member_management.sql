USE careerverse_ai;

ALTER TABLE users
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER recruiter_verified;

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
    'report_dismissed',
    'member_paused',
    'member_resumed',
    'member_deleted'
  ) NOT NULL;
