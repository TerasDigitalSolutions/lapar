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
