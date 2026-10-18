USE careerverse_ai;

ALTER TABLE applications
  ADD COLUMN ai_screening_consent_version VARCHAR(40) NULL;
