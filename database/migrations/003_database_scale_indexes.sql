USE careerverse_ai;

ALTER TABLE users
  ADD KEY users_full_name_prefix_idx (full_name),
  ADD FULLTEXT KEY users_full_name_fulltext (full_name);

ALTER TABLE sessions
  ADD KEY sessions_expiry_idx (expires_at);

ALTER TABLE jobs
  ADD KEY jobs_title_prefix_idx (title),
  ADD KEY jobs_company_prefix_idx (company_name),
  ADD KEY jobs_location_prefix_idx (location),
  ADD KEY jobs_status_published_idx (status, published_at, id),
  ADD KEY jobs_employer_created_idx (employer_id, created_at, id),
  ADD KEY jobs_source_freshness_idx (source_id, status, last_seen_at),
  ADD FULLTEXT KEY jobs_search_text_fulltext (title, company_name, location, description);

ALTER TABLE applications
  ADD KEY applications_job_created_idx (job_id, created_at, id);

ALTER TABLE saved_jobs
  ADD KEY saved_jobs_user_created_idx (user_id, created_at, job_id);

ALTER TABLE networking_profiles
  ADD KEY networking_profiles_headline_prefix_idx (visibility, headline),
  ADD KEY networking_profiles_location_prefix_idx (visibility, location),
  ADD FULLTEXT KEY networking_profiles_search_fulltext (headline, location, bio);

ALTER TABLE networking_blocks
  ADD KEY networking_blocks_owner_created_idx (blocker_id, created_at, blocked_id);

ALTER TABLE networking_connections
  DROP INDEX networking_connections_high_status_idx,
  DROP INDEX networking_connections_low_status_idx,
  ADD KEY networking_connections_high_status_idx (user_high_id, status, updated_at),
  ADD KEY networking_connections_low_status_idx (user_low_id, status, updated_at);
