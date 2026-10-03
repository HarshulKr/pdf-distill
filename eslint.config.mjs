// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import autoImports from './.wxt/eslint-auto-imports.mjs';

export default tseslint.config(
  {
    ignores: ['.output/**', '.wxt/**', 'coverage/**', 'node_modules/**', 'tests/fixtures/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  // WXT auto-imports globals such as defineBackground and browser.
  autoImports,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Template literals with numbers are common and harmless in messages.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Config files are plain JS / not in the TS project.
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
