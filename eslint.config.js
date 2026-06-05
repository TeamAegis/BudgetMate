// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', '.angular/**', 'node_modules/**', 'src-tauri/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      // Guardrail: feature code must use core/bridge, never import @tauri-apps/api directly.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tauri-apps/api',
              message: 'Import IPC only through src/app/core/bridge (the audited Tauri surface).',
            },
            {
              name: '@tauri-apps/api/core',
              message: 'Import IPC only through src/app/core/bridge (the audited Tauri surface).',
            },
          ],
          patterns: ['@tauri-apps/api/*'],
        },
      ],
    },
  },
  {
    // The bridge is the ONE place allowed to import @tauri-apps/api.
    files: ['src/app/core/bridge/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
