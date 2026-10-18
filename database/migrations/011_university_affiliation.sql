USE careerverse_ai;

CREATE TABLE IF NOT EXISTS universities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY universities_name_unique (name)
) ENGINE=InnoDB;

ALTER TABLE users
  ADD COLUMN university_id BIGINT UNSIGNED NULL,
  ADD KEY users_university_idx (university_id),
  ADD CONSTRAINT users_university_fk
    FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE SET NULL;
