import js from '@eslint/js';
import globals from 'globals';

// TypeScript проверяется через `tsc --noEmit` (TS 7 пока не поддержан typescript-eslint),
// ESLint отвечает за JS: браузерный app.js и скрипты.
export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'tools/**',
      '.shots/**',
      'docs/**',
      'PRG.zip',
      '**/*.ts',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
  {
    files: ['src/web/app.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
];
