import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The intentional rest-destructure that strips Zustand actions from the
      // persisted payload (useInvoiceStore.ts:saveInvoice) is a valid pattern.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Storage layer reads schemaless JSON from localStorage; base tsconfig does
      // not enforce no-implicit-any. Kept as a warning (tech-debt). See _upgrade/AUDIT.md.
      '@typescript-eslint/no-explicit-any': 'warn',
      // App's correct hydration pattern is "read localStorage in effect, then setState".
      // Rewriting risks regressions; kept as a warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
