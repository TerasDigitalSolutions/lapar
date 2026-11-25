import { defineConfig } from '@playwright/test';

const demo = ['**/demo/**'];

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/local/**'],
  use: { baseURL: 'http://localhost:4173', browserName: 'chromium' },
  projects: [
    { name: 'phone', testMatch: demo, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'tablet', testMatch: demo, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'smoke', testMatch: ['**/smoke.spec.ts'] },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/lapar/',
    reuseExistingServer: !process.env.CI,
  },
});
