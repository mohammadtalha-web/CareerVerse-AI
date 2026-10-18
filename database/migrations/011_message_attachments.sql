ALTER TABLE networking_uploads
  DROP CONSTRAINT networking_uploads_parent_check,
  ADD COLUMN message_id BIGINT UNSIGNED NULL AFTER post_id,
  ADD KEY networking_uploads_message_idx (message_id),
  ADD CONSTRAINT networking_uploads_parent_check
    CHECK (
      (portfolio_id IS NOT NULL AND post_id IS NULL AND message_id IS NULL)
      OR (portfolio_id IS NULL AND post_id IS NOT NULL AND message_id IS NULL)
      OR (portfolio_id IS NULL AND post_id IS NULL AND message_id IS NOT NULL)
    ),
  ADD CONSTRAINT networking_uploads_message_fk
    FOREIGN KEY (message_id) REFERENCES networking_messages (id) ON DELETE CASCADE;
