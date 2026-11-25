# Lapar

Lapar is a QR ordering and kitchen web app for small eateries. One TypeScript codebase (React, Vite, Tailwind) builds two static pages for GitHub Pages: the app (landing, customer, staff, owner and admin views behind a hash router) and an offline demo at `/lapar/demo/`. Screens get data through a single interface with in-memory and Supabase implementations.

## Develop

Node 22, npm.

```
npm ci
npm run dev        # dev server
npm run typecheck
npm run lint
npm test           # vitest
npm run build      # typecheck + vite build into dist/
npm run e2e        # playwright (builds, then runs against vite preview)
npx playwright install chromium   # once, before e2e
```

`VITE_BASE` overrides the base path (default `/lapar/`); see `.env.example`.

## Layout

```
app/index.html, app/demo/index.html   entry pages (app, demo)
app/src/app/        router, layout, error boundary
app/src/features/   one folder per area, each with its own messages file
app/src/i18n/       tiny i18n layer (defineMessages / useT)
app/src/config.ts   site-wide constants
app/public/         static assets
e2e/                Playwright tests
supabase/           database project
.github/workflows/  ci.yml, deploy.yml
```

## Deploys

Pushes to `main` run `deploy.yml`: it calls `ci.yml` (typecheck, lint, unit tests, build, e2e), and only if that passes builds `dist/` and publishes it with GitHub Pages (source: GitHub Actions).

## Operations

`nightly.yml` runs at 19:15 UTC (03:15 Malaysia time) and by hand (Actions, Nightly, Run workflow). It moves new menu photos from Supabase Storage into `app/public/menu/`, commits them to `main`, deploys only if something changed, marks those photos published and deletes the staging copies, takes an encrypted database backup, and commits `.github/heartbeat` if `main` has been quiet for 30 days (GitHub disables scheduled workflows in public repos after 60 days without activity).

Repository secrets (Settings, Secrets and variables, Actions). Until they exist the matching steps skip with a notice and the run still succeeds; once set, any failure fails the run and GitHub emails the owner.

| Secret | Used by |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | photo sync and publish |
| `SUPABASE_DB_URL`, `AGE_PUBLIC_KEY`, `BACKUP_REPO_TOKEN` | backup (all three needed) |

Repository variable `SUPABASE_PUBLIC_KEY` (publishable key) is used by the site build. `BACKUP_REPO_TOKEN` is a fine-grained token with contents write on the private repo `lapar-backups` only. If `main` is protected, allow the Actions bot to push.

Backups are `lapar-YYYY-MM-DD.tar.gz.age` files (roles, schema and data dumps, encrypted with `age`); the newest 30 are kept in `lapar-backups`. Nothing unencrypted is ever written into a repo. To try it locally: `BACKUP_DRY_RUN=1 AGE_PUBLIC_KEY=<public key> SUPABASE_DB_URL=<url> scripts/backup.sh` writes the encrypted file to `BACKUP_OUT_DIR` (default `.`) and stops.

Repo size: removed photos stay in history. At about 80 KB per photo that is fine for thousands; revisit if the repo passes about 500 MB.

## Restore

1. Download the newest `lapar-*.tar.gz.age` from `lapar-backups`.
2. Decrypt and unpack with the private age key: `age -d -i key.txt lapar-YYYY-MM-DD.tar.gz.age | tar xz` (creates `dump/roles.sql`, `schema.sql`, `data.sql`).
3. Create a fresh Supabase project with the same Postgres major version as `supabase/config.toml`, and take its database URL as `$DB`.
4. Load in order: `psql "$DB" -f dump/roles.sql`, then `dump/schema.sql`, then `dump/data.sql`. Errors about objects that already exist in Supabase's own schemas are expected.
5. Mark every migration as already applied. The dump has the schema but not the `supabase_migrations` history table, so without this a deploy re-runs every migration and fails. Run `supabase migration repair --status applied <version> ...` with the version of every file in `supabase/migrations/` (the number before the first `_`), e.g. `supabase migration repair --db-url "$DB" --status applied $(ls supabase/migrations | cut -d_ -f1)`, then check with `supabase migration list --db-url "$DB"`.
6. Point the repo secrets and the `SUPABASE_PUBLIC_KEY` variable at the new project, update the project ref in the `supabase` job of `deploy.yml`, and re-run `Deploy` so the Edge Function matches. The dump includes the `auth.*` tables, so users and owner logins come back with the data; check that you can sign in as admin (`docs/ARCHITECTURE.md`, section 13).
7. Menu photos live in the site repo (`app/public/menu/`), not in the backup; photos still in staging are not backed up.

Rehearse this restore once into a scratch Supabase project before you ever need it, and delete the scratch project afterwards.
