-- Remove tasks from all active views without destroying their history.
ALTER TABLE tasks ADD COLUMN deleted_at INTEGER;
