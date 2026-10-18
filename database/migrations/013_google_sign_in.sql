ALTER TABLE users
  ADD COLUMN google_subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY users_google_subject_unique (google_subject);
