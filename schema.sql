PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, company TEXT NOT NULL CHECK(company IN ('akir','xpress')),
 assignee TEXT NOT NULL CHECK(assignee IN ('Ms. Tay','TJ','Felicia')),
 due_date TEXT NOT NULL, description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status,due_date);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, person TEXT);
CREATE TABLE IF NOT EXISTS login_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
 id TEXT PRIMARY KEY, person TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), version INTEGER NOT NULL,
 kind TEXT NOT NULL, run_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,run_at,lease_until);
CREATE TABLE IF NOT EXISTS deliveries (
 job_id TEXT NOT NULL REFERENCES jobs(id), subscription_id TEXT NOT NULL,
 accepted_at INTEGER NOT NULL, PRIMARY KEY(job_id,subscription_id)
);

-- Additive upgrade: preserve existing tasks, sessions, subscriptions and reminders.
ALTER TABLE tasks ADD COLUMN created_by TEXT;
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','urgent'));
ALTER TABLE tasks ADD COLUMN progress TEXT NOT NULL DEFAULT 'not_started' CHECK(progress IN ('not_started','in_progress','blocked','completed'));
ALTER TABLE tasks ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN series_id TEXT;
ALTER TABLE tasks ADD COLUMN occurrence_date TEXT;
ALTER TABLE tasks ADD COLUMN mutation_id TEXT;
UPDATE tasks SET progress='completed' WHERE status='done';
CREATE INDEX tasks_creator ON tasks(created_by,status,due_date);
CREATE UNIQUE INDEX tasks_occurrence ON tasks(series_id,occurrence_date);
CREATE TABLE recurring_series(id TEXT PRIMARY KEY, cadence TEXT NOT NULL, anchor_day INTEGER NOT NULL, template TEXT NOT NULL, current_task_id TEXT NOT NULL, next_due_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE comments(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),author TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX comments_task ON comments(task_id,created_at);
CREATE TABLE checklist_items(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX checklist_task ON checklist_items(task_id,position);
CREATE TABLE activity(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX activity_task ON activity(task_id,created_at);
CREATE TABLE attachments(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),author TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX attachments_task ON attachments(task_id,created_at);
CREATE TABLE attachment_chunks(attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(attachment_id,part));
CREATE TABLE user_preferences(person TEXT PRIMARY KEY,digest_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE digest_jobs(id TEXT PRIMARY KEY,person TEXT NOT NULL,date TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT);
CREATE TABLE digest_deliveries(job_id TEXT NOT NULL REFERENCES digest_jobs(id),subscription_id TEXT NOT NULL,accepted_at INTEGER NOT NULL,PRIMARY KEY(job_id,subscription_id));
