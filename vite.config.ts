import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { demoSwPlugin } from './build/demo-sw-plugin.ts';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  base: process.env.VITE_BASE ?? '/lapar/',
  plugins: [react(), tailwindcss(), demoSwPlugin()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'app/index.html'),
        demo: resolve(import.meta.dirname, 'app/demo/index.html'),
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
