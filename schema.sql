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
