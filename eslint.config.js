import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),

  // ── Main source ruleset ──────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Item 21 — flag console.log (warn; fixing all call sites is a separate task)
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Item 21 — flag explicit `any` (warn; a dedicated cleanup pass is a separate task)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Item 21 — prevent raw localStorage access outside designated hooks/utilities
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/localStorage', '!**/useLocalStorage*'],
          message: 'Use the useLocalStorage hook or storageKeys utility instead of raw localStorage',
        }],
      }],
      // Item 23 — flag getAll() calls that omit a $filter (broad heuristic; warn-level)
      // Note: ESLint flat config applies rules from the last matching block, so this
      // selector is also repeated in the service-files block below (combined with the
      // HTTPS check) to ensure coverage is not lost for generated/hooks/context files.
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'CallExpression[callee.property.name="getAll"]:not(:has(Property[key.name="filter"]))',
          message: 'getAll() should include a $filter to scope results per user',
        },
      ],
    },
  },

  // ── Item 22: Dataverse service files — HTTPS-only + scoped-getAll ────────
  // This block matches a subset of the main block's files. In ESLint flat config
  // the last matching block wins per rule name, so no-restricted-syntax here
  // intentionally includes BOTH the HTTPS selector (error) and the getAll selector
  // (warn) to avoid losing Item 23 coverage for these files.
  {
    files: ['src/generated/**/*.ts', 'src/hooks/*.ts', 'src/context/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^http:\\/\\//]',
          message: 'All Dataverse service calls must use HTTPS, not HTTP',
        },
        // Repeated from Item 23 so service files are not exempt from the filter guard
        {
          selector: 'CallExpression[callee.property.name="getAll"]:not(:has(Property[key.name="filter"]))',
          message: 'getAll() should include a $filter to scope results per user',
        },
      ],
    },
  },
])
