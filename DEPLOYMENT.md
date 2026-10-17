# Taskly API and Website Restriction Deployment

This application is not a serverless backend. The Express API runs a scheduler inside the Node process and stores state in SQLite. Host it as a continuously running Node.js service with a durable filesystem/volume, or migrate to a durable database before using horizontally scaled instances. Do **not** run the API or its scheduler as Vercel Functions, and do not store the production database on an ephemeral filesystem.

## Local development

From the repository root:

```bash
npm ci
cp .env.example .env
```

Use local-only values in `.env` (the defaults are shown):

```dotenv
NODE_ENV=development
PORT=4000
JWT_SECRET=replace-with-a-random-development-secret
TASKLY_DB_PATH=./server/data/taskly.db
CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Run the API and frontend in separate terminals:

```bash
npm run server
```

```bash
npm run dev
```

Check backend and database readiness:

```bash
curl -i http://localhost:4000/api/health
```

Expected healthy response: HTTP 200, `status: "healthy"`, `database: "sqlite-connected"`. The UI checks this endpoint before creating a task. A website restriction is persisted atomically by `POST /api/jobs` as a job and its linked site-limit row; the browser does not post a duplicate rule.

### Local extension setup

1. Open `chrome://extensions`, enable Developer mode, and load the repository's `extension/` directory as an unpacked extension.
2. Open the extension popup and enter `http://localhost:4000/api`.
3. Select **Validate & Save API** and grant Chrome's explicit host permission for `localhost:4000`.
4. Pair the extension with the Taskly account. Verify that the popup can sync the account's rules.
5. The extension may enforce its last valid cached rules offline; a sync/network failure does not erase that cache and is explicitly shown as stale.

The extension's optional host permission request is per API origin. For a custom website rule, its website access permission is a separate browser permission.

## Vercel frontend

Configure these **build-time** variables in the Vercel project's Environment Variables for Production (and Preview if desired):

```dotenv
VITE_API_URL=https://YOUR-ACTUAL-API-HOST/api
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

`VITE_API_URL` is a placeholder, not a production hostname. Replace it with the actual HTTPS API URL after the backend exists. The Supabase values are the project URL and **publishable/anon** key only; never put a service-role key in a `VITE_` variable. In Supabase Auth URL Configuration, set the production Site URL to `https://taskagents.vercel.app` and allow that exact redirect URL (plus the local development URL only if needed). Keep email confirmation enabled. Vite embeds these values at build time: **redeploy/rebuild after changing them**. Production API builds reject missing, HTTP, localhost, malformed, or credential/query-bearing API URLs and never fall back to localhost.

Email/password signup confirmation and password reset use Supabase Auth emails. Supabase's built-in sender is limited to project-team addresses and currently has a low rate limit; it is not suitable for public users. This setup intentionally adds no SMTP/email vendor, Google sign-in, or OTP. Until a production email sender is configured separately, public users may not receive signup or reset emails.

This auth change stores and verifies account credentials in Supabase Auth. It does not migrate Taskly tasks, notes, website rules, or other workspace data from the existing local/SQLite API storage into Supabase; those remain governed by the existing frontend/API deployment configuration.

Deploy the Vite project with the existing `vercel.json` build/output configuration. Do not add backend routes as Vercel serverless functions.

## Persistent backend host

Run the existing Node server on a persistent Node.js service (not a serverless function). Set these variables in that service's environment:

```dotenv
NODE_ENV=production
PORT=<provided by hosting service>
JWT_SECRET=<long random private secret>
TASKLY_DB_PATH=<absolute path on the service's persistent mounted volume>/taskly.db
CORS_ORIGINS=https://<actual-vercel-frontend-origin>,chrome-extension://<published-extension-id>
```

- `PORT` is normally injected by the host; do not hardcode it if the provider supplies it.
- `JWT_SECRET` must be a private, randomly generated production secret. Keep it out of the repository and logs.
- `TASKLY_DB_PATH` must point to the host's durable mounted volume. Back up the database and test restore before relying on it. SQLite is suited to a single API instance with persistent local storage; for multiple API instances use a shared durable database such as PostgreSQL instead.
- `CORS_ORIGINS` is a comma-separated exact-origin allowlist. Add the actual Vercel origin and, once known, the exact Chrome extension origin. Do not put paths or trailing slashes in origin entries. For local extension development, add that unpacked extension's `chrome-extension://<id>` origin to the local `.env` allowlist if its fetches are rejected.
- The server handles CORS preflight and allows only the configured origin list; it does not infer that any network failure is CORS.

Build/install the backend from the repository root with the lockfile (`npm ci`) and start it with `npm run server`. The Node process must remain running to service requests and run the existing interval-based scheduler. Configure the hosting provider's health probe as `GET /api/health`.

## Released Chrome extension

No API host is guessed or compiled into the extension. After installing the released extension, open its popup, enter the same real production API URL (`https://<actual-api-host>/api`), click **Validate & Save API**, and accept Chrome's origin-specific host permission. The popup tests `/api/health`, persists the normalized URL in `chrome.storage.local`, refreshes the service worker API client, then attempts rule synchronization. Pair the extension with the same Taskly account. The backend CORS allowlist must include the published extension ID.

A successful task save confirms API persistence only. It does not confirm that a user has installed, paired, or synchronized an extension; the UI/log must not label it as enforced until the extension reports current synchronization and has relevant site permissions.

## Safe checks after deployment

1. Open `https://<actual-api-host>/api/health` and confirm HTTP 200 plus database health.
2. In the browser Network panel, confirm the frontend calls that API host (not localhost) and inspect the actual HTTP status or pre-response network failure.
3. Create a website restriction and confirm the server response contains both `job` and `siteLimit`; confirm the rule appears from authenticated `GET /api/site-limits`.
4. Configure the extension to the same API URL, accept host permission, pair it, and use Sync. Confirm the extension's synchronized rule state and website permission before testing a block.
5. Test an allowed and a blocked navigation with a real Chrome installation. API/unit tests or simulated requests are not real-browser enforcement verification.

The unpacked Manifest V3 extension was loaded in Chromium and its service worker started successfully. This checkout has no actual deployed API hostname, Vercel credentials, production credentials, or paired account, so authenticated extension sync, a real site block, and production deployment remain unverified manual steps.
