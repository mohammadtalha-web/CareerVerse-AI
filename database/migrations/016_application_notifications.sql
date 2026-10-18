USE careerverse_ai;

ALTER TABLE notifications
  MODIFY notification_type ENUM(
    'job_match',
    'message',
    'connection_request',
    'connection_accepted',
    'application_received',
    'application_update'
  ) NOT NULL;
