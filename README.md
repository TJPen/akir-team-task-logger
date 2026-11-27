# Team Desk

A shared task board for **Akir Enterprises** and **Xpress One Labs – Alabama**.

Live app: https://akir-team-task-logger.designs-dd9.workers.dev

## Task management

- Company → assignee (Ms. Tay, TJ, Felicia) → due date → task description.
- Edit, complete, reopen, search, and filter tasks. Saved in Cloudflare D1 and shared across devices.
- Individual passwords, server-enforced account permissions, secure HttpOnly sessions, same-origin mutation checks, and login rate limiting.
- Installable web app with encrypted Web Push notifications. Each phone uses the signed-in account and explicitly allows notifications.
- Assignment/update notifications plus reminders at **9 AM America/Chicago** on the day before and the due date. Daylight saving time is handled automatically. The queue runs every five minutes; scheduled messages can arrive a few minutes after 9.
- Finishing a task cancels unsent reminders. Edits replace the prior pending reminders. Reopening queues a fresh update.
- No SMS service or phone numbers are required.

## Phone setup

1. Open the app and enter your own password. The password identifies your account automatically.
2. On iPhone/iPad (iOS/iPadOS 16.4+), use Safari → Share → Add to Home Screen, then open that icon. On Android, use Chrome; installing to the Home Screen is optional.
3. Open **Phone setup**, confirm your signed-in name, tap **Enable notifications**, and allow the permission prompt.
4. Tap **Send a test**. Confirm that the notification appears on the phone.

Repeat for each person/device. Browser permission, network connection, device notification settings, and the push service affect delivery. “Push service accepted” is not proof that the person saw the notification. A phone delivery test is required after setup.

TJ is the administrator and can manage all tasks in both companies. Ms. Tay and Felicia can access tasks assigned to them **or created by them**. Their default view shows assignments to them; **Assigned by me** shows tasks they created, including tasks assigned to someone else. Creator identity is immutable and is determined from the authenticated session. Older tasks have an unknown creator rather than an invented attribution. Task details, comments, checklists, activity and file downloads enforce the same access rules server-side. After reassignment, a former assignee loses access unless they are the creator or TJ.

Phone subscriptions can only be registered or tested for the signed-in person. Sign-out ends the session and disconnects that browser’s phone notifications. Sign in and enable notifications again to reconnect.

## Version 2 workflows

- Priorities: Normal, High, Urgent; higher priorities sort first, with filters for priority and progress.
- Progress: Not started, In progress, Blocked (a reason is required), Completed. The existing checkbox completes or reopens a task, and overdue open tasks stay red.
- Click a task title to open its comments, checklist, private files and activity. Activity starts with this upgrade; it does not fabricate past changes. Up to 200 comments and 30 checklist items per task; the latest 201 history entries are returned.
- Daily, weekly and monthly recurrence creates a fresh task on completion or after the previous due date. Missed tasks remain open; checklists reset unchecked. Monthly dates preserve the original day (January 31 → February 28 → March 31). Only the latest occurrence changes the repeat template. Choose **Does not repeat** there to stop the series. Comments and files stay with their original occurrence.
- **Morning summary** opens due-today and overdue tasks. The push summary is queued at 9 AM America/Chicago, with DST support; TJ sees counts for both companies, others see only their assignments. Phone setup includes an individual opt-out. Retries stop after the three-hour morning window and accepted devices are deduplicated. There is no exact-once guarantee across an acceptance/database-write failure.
- Files are stored privately in D1 (R2 is not enabled on this account), in 256 KB chunks. Limits: 5 MB per file, 20 files per task, 250 MB total. Downloads require an authenticated authorized account and are served as attachments with a sandbox policy. Allowed extensions: PDF, PNG/JPEG/WebP/HEIC, TXT, CSV, DOCX, XLSX. This build does not scan files for malware. The uploader, task creator or TJ may remove a file.
- The five-minute cron processes one recurring series, one reminder job (up to two pending devices), and one pending device per recipient’s daily summary per run to keep work bounded. Interactive changes process up to two reminder jobs. Large backlogs or multiple devices can delay delivery; accepted devices are skipped on subsequent retries.

## Source and verification

Version 1.5 adds a personal “Good morning” greeting and a daily King James Bible verse. A shuffled collection of 44 verses rotates using the server’s America/Chicago calendar date, stays consistent across accounts and refreshes, and changes each day without adjacent repeats. Text is bundled locally from [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv); its MIT license is included in `public/bible-license.txt`.

Version 1.4 removes decorative arrows and stars, uses a checklist identity, and adds a brief colorful completion burst after a successful save. The animation is non-blocking, clears automatically, and is replaced by a static success message for reduced-motion users. Reopening a task or a failed save never triggers a celebration.

The visual layout follows the supplied visual reference with a light canvas, a charcoal navigation rail, sage and lime cards, oversized headings, and both company logos. The task board stays central, with company shortcuts and phone reminders alongside it. Completion progress and a seven-day due-date chart use only the tasks authorized for the signed-in account and the selected company. Frosted sign-in and dialog surfaces fall back to opaque backgrounds when blur is unavailable. Motion respects the device’s reduced-motion preference.

Headings, controls, and task text use [Manrope](https://fonts.google.com/specimen/Manrope); compact navigation initials use [Sora](https://fonts.google.com/specimen/Sora). Both fonts are self-hosted as Latin WOFF2 files under the SIL Open Font License. Their licenses are included in `public/sora-license.txt` and `public/manrope-license.txt`. Company logo images are optimized web copies of the supplied artwork.

Requires Node.js 22.13+ (native `node:sqlite` for tests). No runtime npm dependencies.

```sh
npm run build
npm test
```

`public/` contains the responsive UI, web app manifest, icons, and service worker. `build.mjs` produces `assets.mjs` for upload. `worker.mjs` implements authentication, task listing, push jobs and the scheduled handler. `domain.mjs` holds date and validation rules; `workflows.mjs` implements collaboration, recurrence, private files and daily summaries. `push.mjs` uses Web Crypto for RFC 8291 encryption and RFC 8292 VAPID.

Tests cover dates and daylight saving transitions, validation, authentication, CSRF protection, persisted task changes, optimistic edit conflicts, completion/reopening, retry and duplicate suppression, push URL restrictions, payload decryption with independent Node crypto, and VAPID signature verification. Live browser QA checks the deployed UI separately.

## Cloudflare deployment

Worker name: `akir-team-task-logger`. D1 database name: `akir-xpress-team-tasks`.

The initial build was deployed through the Cloudflare connector using its authenticated API. `deployment.json` is the non-secret upload metadata. Use the database ID from the intended Cloudflare account, apply `schema.sql` **once to a new empty database**, build, and upload `worker.mjs`, `push.mjs`, `domain.mjs`, `workflows.mjs`, and `assets.mjs` as ES modules. Enable the Worker’s workers.dev subdomain and configure a `*/5 * * * *` Cron Trigger. The scheduled handler must remain enabled for reminders while the app is closed.

Required bindings:

| Binding | Type | Value |
|---|---|---|
| `DB` | D1 | Task database |
| `APP_ORIGIN` | Plain text | Canonical HTTPS app origin |
| `VAPID_PUBLIC` | Plain text | Base64url uncompressed P-256 public key |
| `VAPID_PRIVATE` | Secret | JSON Web Key for its private key |
| `TJ_PASSWORD` | Secret | TJ administrator password |
| `MSTAY_PASSWORD` | Secret | Ms. Tay password |
| `FELICIA_PASSWORD` | Secret | Felicia password |
| `LOGIN_PEPPER` | Secret | Random secret for login rate-limit keys |

Credentials are **not** stored in this repository. Preserve secrets on redeploy. Rotating VAPID keys requires re-enabling notifications on every device. To rotate an individual password, change that person’s Cloudflare secret and delete their `sessions` rows to revoke prior sessions. Do not commit passwords, push subscription endpoints, exports of live task data, or Cloudflare credentials.

## Limits and behavior

- Up to 2,000 tasks and 10 subscribed devices per person. No permanent task deletion in this build.
- Assignment notifications wait up to 24 hours for a phone to be enabled. Future reminders still run if an assignment notification expires.
- Only future 9 AM reminders are scheduled; a task added after its due-day 9 AM receives the immediate assignment notification, without a second catch-up notification.
- Reminder jobs persist in D1; retry uses a bounded backoff. Successful recipients are recorded so an ordinary retry does not re-send to those phones. A worker failure after push acceptance but before database recording can still produce a duplicate; notification tags reduce duplicate display.
- Expired phone subscriptions are removed. Open Phone setup to subscribe again.
- API data is never cached by the service worker. The board requires an internet connection.
- Tasks auto-refresh every minute while visible, on returning to the app, or using Refresh.
- GitHub stores source only. Automatic deployment from GitHub is not configured; update Cloudflare explicitly after source changes.

Platform reference: [Apple Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Upgrade from shared-password version

Apply `migrations/002_personal_accounts.sql` once to an existing version 1.0 database before uploading version 1.1. For a new database use `schema.sql` directly and do not apply this migration again. Configure the four new authentication secrets, deploy, and remove the unused `TEAM_PASSWORD` secret. The migration preserves tasks and jobs, revokes all old shared sessions, and marks legacy phone subscriptions unverified. Everyone must sign in with their own password and save Phone setup again. Password values are configured only in Cloudflare, never in source.

## Upgrade from version 1.x to 2.0

Apply `migrations/003_team_workflows.sql` once to the existing personal-account database, then upload the five modules above. This additive migration preserves task IDs, versions, sessions, subscriptions and existing jobs. It maps completed tasks to Completed progress and leaves legacy creators unknown. Do not rerun `schema.sql` on an existing database. Preserve all bindings and secrets and the five-minute Cron Trigger.

Validation includes local SQLite integration tests and an isolated Cloudflare Worker/D1 run covering creator access, comments, checklist, blocked/completed progress, private 600 KB and 5 MB upload/download, monthly recurrence, activity and summary preferences. Browser checks cover creation, comments, checklist, file upload, history and a 390 px mobile layout. Test resources contain sample data only.

## Upgrade from 2.0 to 2.1

Apply `migrations/004_task_deletion.sql` once before deploying the five Worker modules. New databases use the full `schema.sql` instead. Existing tasks, sessions, subscriptions, and VAPID keys are preserved.

The board puts status, priority, and assignee dropdowns directly on each task, with larger labels and responsive phone controls. Clicking a task opens its comments, files, checklist, and history. Assigned to me clears company, search, and other filters and opens the signed-in person's active task list.

Delete requires confirmation and the current task version. Admins, the current assignee, and the creator can delete accessible tasks. Deletion retains internal records and history, hides the task and its files from all app views, and cancels pending reminders. Deleting the latest occurrence stops future repeats; deleting an older occurrence leaves its series running. There is no in-app restore control.
