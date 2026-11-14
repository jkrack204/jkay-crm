# JKAY Racks CRM

CRE desk, BD desk and Admin console for JKAY Racks. Decisions behind this build are in the
project doc `claude/CRM_Decisions.md`.

Runs entirely on **Railway** (same account as the inventory tool, one bill):
Railway Postgres for data, a Railway Storage Bucket for files, and one service for the app.
Login is our own username + password — no third-party auth service.

## Layout

```
apps/server     Fastify API + job worker, serves the built web app (one Railway service)
apps/web        React + Vite front end ("Paper & Clay" styles carried over from the mockups)
packages/shared Enums, input schemas and phone helpers used by both sides
```

## Run locally

1. Have a Postgres to point at (a local one, or a Railway dev database).
2. `cp .env.example .env` and fill in `DATABASE_URL` and `SECRETS_KEY`.
   Leave the bucket values empty and keep `STORAGE_LOCAL_DIR=./.uploads` — uploads then go to
   that folder on your machine instead of the bucket.
3. `npm install`
4. `npm run db:migrate` — creates every table.
5. Create the defaults and the first Admin (choose the password yourself):
   ```
   SEED_ADMIN_USERNAME=raneesh SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME="..." SEED_ADMIN_EMAIL=... npm run db:seed
   ```
   On Windows PowerShell set each with `$env:SEED_ADMIN_USERNAME="raneesh"` etc. first, then `npm run db:seed`.
6. Two terminals: `npm run dev:server` (API on :3000) and `npm run dev:web` (open http://localhost:5173)

## On Railway

No Railway build/start settings are needed. Railway runs `npm run build`, then `npm start`, and
`npm start` itself applies any new database migrations, fills in missing defaults, then starts
the server. The database is only ever reached over Railway's private network.

1. Push this folder to a GitHub repo.
2. In the Railway project (the one with Postgres): **+ Create → GitHub Repo** → pick the repo.
3. App service → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the private one)
   - `SECRETS_KEY` = 32 random bytes, base64
   - `COOKIE_SECURE` = `true`
   - First deploy only: `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`
     (delete these four after you've logged in once — the Admin stays; changing them never
     overwrites an existing Admin's password)
4. App service → **Settings → Networking → Generate Domain** to get the web address.
5. Postgres service → **Settings → Networking**: the TCP Proxy (public URL) can stay off.
6. Postgres service → **Backups**: turn on daily backups.
7. Files (site photos, drawings, quotations): **+ Create → Bucket**. Then in the app service →
   **Variables**, reference the bucket's own variables (if the bucket is named `files`):
   - `BUCKET_ENDPOINT` = `${{files.ENDPOINT}}`
   - `BUCKET_NAME` = `${{files.BUCKET}}`
   - `BUCKET_ACCESS_KEY_ID` = `${{files.ACCESS_KEY_ID}}`
   - `BUCKET_SECRET_ACCESS_KEY` = `${{files.SECRET_ACCESS_KEY}}`
   - `BUCKET_REGION` = `${{files.REGION}}`
   - only if the bucket's Credentials tab says to use path-style URLs: `BUCKET_PATH_STYLE` = `true`

   Do **not** set `STORAGE_LOCAL_DIR` on Railway — the app's own disk is wiped on every deploy.
   Files are uploaded through the app and opened through short-lived signed links, so the bucket
   stays private and downloads come straight from the bucket (free bucket egress).

8. App service → **Variables**: `APP_URL` = the web address from step 4 (e.g. `https://jkay-crm.up.railway.app`),
   used for the link inside alert emails.

Every later `git push` redeploys and migrates automatically.

## Reminders, alert emails, live updates, backups

These run inside the same app service, once a minute — nothing extra to deploy.

- **Reminders and escalations** — follop at its time → repeat at 10:00 IST next morning → every
  Admin 4 hours later; "Call Not Attend" at Admin's step escalates at once; unclaimed pool leads,
  leads with no contact, unanswered quotations, final balance before production, site-visit
  morning. Timings are in Admin › Settings › Rules & alerts. Each alert fires once
  (`reminder_log`).
- **Alert emails** — off until `RESEND_API_KEY` is set. To switch on: create a Resend account,
  add JK Racks' domain there and put the DNS records it shows on the domain, then set
  `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `JK Racks CRM <alerts@jkayracks.in>`, on that domain).
  Status shows in Admin › Settings › Email & backups.
- **Live updates** — every screen keeps `/api/events` open and refetches when anyone changes
  something. Nothing to configure.
- **Nightly backup** — after 02:30 IST the whole database is saved to the bucket as
  `backups/YYYY-MM-DD.json.gz` (last `BACKUP_KEEP_DAYS`, default 30). Admin can download any of
  them or take one now from Settings › Email & backups. This is on top of Railway's own backups.

**Demo data** (for showing the CRM before real leads arrive)
1. Railway › app service › Variables: `DEMO_DATA` = `true`.
2. Admin › Settings › **Demo data** › **Load demo data** — about 24 sample leads across every stage,
   3 demo CREs and 2 demo BDEs (logins and password shown on that page).
3. After the demo: **Remove demo data** (only the sample records) or **Erase all leads** (every lead,
   demo or not, plus files and alerts; lead numbers restart at #1; type ERASE to confirm).
4. Delete the `DEMO_DATA` variable — the page and its buttons disappear.

**Restoring a backup** (into a new, empty database):
1. Railway: **+ Create → Database → PostgreSQL** (a new one).
2. Locally, with `DATABASE_URL` set to the new database's public URL (turn its TCP proxy on for
   this, off again after): `npm run db:migrate`, then
   `npm run db:restore -w @jkay/server -- path/to/jkay-crm-backup-2026-11-10.json.gz`
   (or `-- --key backups/2026-11-10.json.gz` to read it straight from the bucket).
3. Point the app's `DATABASE_URL` at the new database. Everyone signs in with their old password.

## Tests

```
TEST_DATABASE_URL=postgres://...throwaway-db... npm test -w @jkay/server
```
The test wipes that database, rebuilds it and drives the real API (login, permissions, the
claim race, stage rules, transfers, hand-off, lost, sign-out, file uploads, and the BD desk:
visits, drawings, quotations, the discount limit, payments, won/lost/reopen, and the Admin side:
records, privacy between Admins, ranking, reassign, settings; and the background jobs: the follop
→ repeat → escalate chain, every alert firing once, alert emails, live updates, and a backup
restored into a second database `jkay_restore_test` it creates and drops). Uploaded files
go to a temporary folder. Never point it at real data.

## Schema in one paragraph

A `leads` row is the whole life of an enquiry: CRE desk → (hand-off) → BD desk → won/lost.
`stages` are Admin-managed per desk; a stage's `kind` (pool / working / handoff / won / lost)
and flags (`requires_followup`, `requires_stage_tag`, `shows_value`, `requires_quotation`)
carry the workflow rules so Admin can rename and reorder freely. `lead_owners` is the owner log
(one open row = current owner, null owner = pool). `stage_history` and `activities` record every
move. Admin tags, notes, ranking and watches are per Admin (`admin_*` tables, `notes.scope`).
Lead platforms land raw in `inbound_leads` before becoming leads. `reminder_log` remembers which
alerts the background jobs already sent. `employees` holds the scrypt
password hash; `sessions` holds hashed login tokens.

## Styles

`apps/web/src/styles/system.css` is the shared design system from the mockups.
`admin.page.css`, `cre.page.css`, `bd.page.css` are each mockup's page styles, kept for porting the
screens; they get scoped per desk as each desk is built.
