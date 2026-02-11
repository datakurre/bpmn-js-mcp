// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────────
  { ignores: ['dist/', 'node_modules/', '*.config.*'] },

  // ── Base JS recommended rules ─────────────────────────────────────────────
  eslint.configs.recommended,

  // ── TypeScript recommended (type-aware off — no parserOptions.project) ────
  ...tseslint.configs.recommended,

  // ── Project-wide overrides ────────────────────────────────────────────────
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // ── Code-quality ────────────────────────────────────────────────────
      // Disabled — bpmn-js APIs are largely untyped; `any` is unavoidable
      // at the boundary.  Type-safety is enforced within our own interfaces.
      '@typescript-eslint/no-explicit-any': 'off',

      // Catch unused vars (ignore those starting with _)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Prefer type-only imports where possible (tree-shaking, clarity)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // ── Maintainability ─────────────────────────────────────────────────
      // Enforce consistent return types on exported functions
      '@typescript-eslint/explicit-function-export-return-type': 'off',

      // Disallow duplicate imports from the same module
      'no-duplicate-imports': 'error',

      // Require === and !==
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // No console.log (allow console.error for MCP stdio server)
      'no-console': ['error', { allow: ['error'] }],

      // Limit function complexity to keep handlers comprehensible
      complexity: ['error', 20],

      // Limit file length — signals when a module should be split.
      // Handler files include a ~40-line TOOL_DEFINITION schema (static data),
      // so the limit is slightly higher than typical application code.
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],

      // Limit function length — keep handlers focused
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],

      // Prefer const over let when variable is never reassigned
      'prefer-const': 'error',

      // No var — use let/const
      'no-var': 'error',

      // No parameter reassignment (helps reason about data flow)
      'no-param-reassign': ['error', { props: false }],

      // ── Style consistency ───────────────────────────────────────────────
      // Consistent brace style
      curly: ['error', 'multi-line'],

      // No trailing spaces in template literals or elsewhere (handled by formatter)
      'no-trailing-spaces': 'off',
    },
  },

  // ── ELK layout engine — algorithmic code with inherent complexity ────────
  {
    files: ['src/elk/**/*.ts'],
    rules: {
      complexity: ['error', 60],
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },

  // ── bpmnlint plugin rules — lint rules are inherently branchy ───────────
  {
    files: ['src/bpmnlint-plugin-bpmn-mcp/**/*.ts'],
    rules: {
      complexity: ['error', 40],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },

  // ── Test-specific relaxations ─────────────────────────────────────────────
  {
    files: ['test/**/*.ts'],
    rules: {
      // Tests often use any for mock objects
      '@typescript-eslint/no-explicit-any': 'off',
      // Tests can have longer functions (setup + assertions)
      'max-lines-per-function': 'off',
      // Tests can be longer files
      'max-lines': 'off',
      // Tests sometimes reassign for setup
      'no-param-reassign': 'off',
    },
  }
);
