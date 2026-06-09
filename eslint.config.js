import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const browserEnv = { ...globals.browser, ...globals.es2022 };

const commonRules = {
  'no-console': ['warn', { allow: ['warn', 'error', 'debug', 'info'] }],
  'prefer-const': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  // Plain JS modules
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserEnv,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // JSX components
  {
    files: ['src/**/*.jsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserEnv,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...commonRules,
      // React import is unused with the modern JSX transform but harmless to keep
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|React$)', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // TypeScript files
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': tsPlugin },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserEnv,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
      // Use TS-aware no-unused-vars
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // TS handles these better than JS rules
      'no-undef': 'off',
    },
  },

  // Disable React Compiler rules project-wide (not using React Compiler)
  // and set-state-in-effect which flags intentional reset patterns.
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
    },
  },

  // Test files — Node globals for vi.spyOn(global,...); relax unused-vars
  {
    files: ['src/**/*.test.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
