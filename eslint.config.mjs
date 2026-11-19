import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import useClientExports from './eslint-rules/use-client-exports.js';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.claude/worktrees/**',
    'docs/**', // Astro docs subproject — has its own toolchain; root lint must not walk its build output
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    plugins: {
      local: {
        rules: {
          'use-client-exports': useClientExports,
        },
      },
    },
    rules: {
      'local/use-client-exports': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Allow console.log in server-side code
  {
    files: [
      'src/lib/**/*.ts',
      'src/app/api/**/*.ts',
      'src/instrumentation.ts',
      'scripts/**/*',
    ],
    rules: {
      'no-console': 'off',
    },
  },
]);

export default eslintConfig;
