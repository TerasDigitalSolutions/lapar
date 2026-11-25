import { execSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

// `supabase status -o env` follows the SUPABASE_* port variables locally and the defaults in CI.
const env = Object.fromEntries(
  execSync('supabase status -o env', { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]]),
);

export default defineConfig({
  testDir: 'e2e/local',
  workers: 1,
  use: { baseURL: 'http://localhost:5173', browserName: 'chromium', viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173/lapar/',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: env.API_URL ?? '',
      VITE_SUPABASE_PUBLIC_KEY: env.PUBLISHABLE_KEY ?? env.ANON_KEY ?? '',
    },
  },
});
