-- Run once on the original shared-password database. Preserve tasks and reminders.
ALTER TABLE sessions ADD COLUMN person TEXT;
ALTER TABLE subscriptions ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
DELETE FROM sessions;
