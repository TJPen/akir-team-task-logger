# Team Desk

A shared task board for **Akir Enterprises** and **Xpress One Labs – Alabama**.

Live app: https://akir-team-task-logger.designs-dd9.workers.dev

## First build

- Company → assignee (Ms. Tay, TJ, Felicia) → due date → task description.
- Edit, complete, reopen, search, and filter tasks. Saved in Cloudflare D1 and shared across devices.
- Shared team password, secure HttpOnly sessions, same-origin mutation checks, and login rate limiting.
- Installable web app with encrypted Web Push notifications. Each phone chooses its recipient and explicitly allows notifications.
- Assignment/update notifications plus reminders at **9 AM America/Chicago** on the day before and the due date. Daylight saving time is handled automatically. The queue runs every five minutes; scheduled messages can arrive a few minutes after 9.
- Finishing a task cancels unsent reminders. Edits replace the prior pending reminders. Reopening queues a fresh update.
- No SMS service or phone numbers are required.

## Phone setup

1. Open the app and enter the team password shared separately by TJ.
2. On iPhone/iPad (iOS/iPadOS 16.4+), use Safari → Share → Add to Home Screen, then open that icon. On Android, use Chrome; installing to the Home Screen is optional.
3. Open **Phone setup**, choose your name, tap **Enable notifications**, and allow the permission prompt.
4. Tap **Send a test**. Confirm that the notification appears on the phone.

Repeat for each person/device. Browser permission, network connection, device notification settings, and the push service affect delivery. “Push service accepted” is not proof that the person saw the notification. A phone delivery test is required after setup.

Everyone with the shared password can see/edit both companies’ tasks and select any notification recipient. Names are not separate authenticated accounts. Sign-out ends the board session but keeps that phone's reminders enabled; use **Disconnect this phone** to stop them.

## Source and verification

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
| `TEAM_PASSWORD` | Secret | Cryptographically generated shared password |

Credentials are **not** stored in this repository. Preserve secrets on redeploy. Rotating VAPID keys requires re-enabling notifications on every device. To rotate the team password, change the Cloudflare secret and delete existing `sessions` rows to revoke prior sessions. Do not commit passwords, push subscription endpoints, exports of live task data, or Cloudflare credentials.

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
