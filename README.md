# Team Desk

A shared task board for **Akir Enterprises** and **Xpress One Labs – Alabama**.

Live app: https://akir-team-task-logger.designs-dd9.workers.dev

## First build

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

TJ is the administrator and can see/edit all tasks in both companies. Ms. Tay and Felicia can see/edit only tasks currently assigned to themselves. Every person can create tasks assigned to anyone, including themselves. A task assigned to someone else appears in that recipient’s list and TJ’s admin view; its creator receives a confirmation but cannot read or edit it afterward unless it is assigned back to them. These rules are enforced in the API, including direct requests and searches.

Phone subscriptions can only be registered or tested for the signed-in person. Sign-out ends the session and disconnects that browser’s phone notifications. Sign in and enable notifications again to reconnect.

## Source and verification

Version 1.4 removes decorative arrows and stars, uses a checklist identity, and adds a brief colorful completion burst after a successful save. The animation is non-blocking, clears automatically, and is replaced by a static success message for reduced-motion users. Reopening a task or a failed save never triggers a celebration.

The visual layout follows the supplied visual reference with a light canvas, a charcoal navigation rail, sage and lime cards, oversized headings, and both company logos. The task board stays central, with company shortcuts and phone reminders alongside it. Completion progress and a seven-day due-date chart use only the tasks authorized for the signed-in account and the selected company. Frosted sign-in and dialog surfaces fall back to opaque backgrounds when blur is unavailable. Motion respects the device’s reduced-motion preference.

Headings, controls, and task text use [Manrope](https://fonts.google.com/specimen/Manrope); compact navigation initials use [Sora](https://fonts.google.com/specimen/Sora). Both fonts are self-hosted as Latin WOFF2 files under the SIL Open Font License. Their licenses are included in `public/sora-license.txt` and `public/manrope-license.txt`. Company logo images are optimized web copies of the supplied artwork.

Requires Node.js 22.13+ (native `node:sqlite` for tests). No runtime npm dependencies.

```sh
npm run build
npm test
```

`public/` contains the responsive UI, web app manifest, icons, and service worker. `build.mjs` produces `assets.mjs` for upload. `worker.mjs` implements authentication, task APIs, D1 jobs, and the scheduled handler. `push.mjs` uses Web Crypto for RFC 8291 encryption and RFC 8292 VAPID.

Tests cover dates and daylight saving transitions, validation, authentication, CSRF protection, persisted task changes, optimistic edit conflicts, completion/reopening, retry and duplicate suppression, push URL restrictions, payload decryption with independent Node crypto, and VAPID signature verification. Live browser QA checks the deployed UI separately.

## Cloudflare deployment

Worker name: `akir-team-task-logger`. D1 database name: `akir-xpress-team-tasks`.

The initial build was deployed through the Cloudflare connector using its authenticated API. `deployment.json` is the non-secret upload metadata. Use the database ID from the intended Cloudflare account, apply `schema.sql` through D1, build, and upload `worker.mjs`, `push.mjs`, and `assets.mjs` as ES modules. Enable the Worker’s workers.dev subdomain and configure a `*/5 * * * *` Cron Trigger. The scheduled handler must remain enabled for reminders while the app is closed.

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

## First-build limits and behavior

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
