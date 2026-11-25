import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const supabasePkg = {
  group: ['@supabase/*'],
  message: 'supabase-js is only imported by app/src/data/supabase/client.ts.',
};
const noImpl = (...dirs) => dirs.map((d) => ({ group: [`**/data/${d}`, `**/data/${d}/**`], message: `Views must not import data/${d}.` }));

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.claude/**',
      '.worktrees/**',
      'supabase/functions/**', // Deno code
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // ARCHITECTURE 3.3
  { files: ['app/src/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [supabasePkg] }] } },
  { files: ['app/src/data/supabase/client.ts'], rules: { 'no-restricted-imports': 'off' } },
  {
    files: ['app/src/features/**/*.{ts,tsx}'],
    ignores: ['app/src/features/*/index.tsx', 'app/src/features/demo/**', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [supabasePkg, ...noImpl('demo', 'supabase')] }] },
  },
  {
    files: ['app/src/features/demo/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [supabasePkg, ...noImpl('supabase')] }] },
  },
  {
    files: ['app/src/**/*.test.{ts,tsx}'],
    ignores: ['app/src/data/supabase/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [supabasePkg, ...noImpl('supabase')] }] },
  },
  {
    files: ['app/src/demo-main.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [supabasePkg, ...noImpl('supabase'), { group: ['**/app/router', './app/router'], message: 'The demo must not load the router.' }] },
      ],
    },
  },
);
