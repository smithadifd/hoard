import { createRequire } from 'node:module';
import path from 'node:path';
import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import rule from './use-client-exports.js';

// Parser comes from eslint-config-next's nested typescript-eslint — same
// parser npm run lint uses — without adding a direct dependency.
const fromNext = createRequire(
  path.join(process.cwd(), 'node_modules/eslint-config-next/package.json'),
);
const tsParser = fromNext('typescript-eslint').parser;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const USE = "'use client';\n";

tester.run('use-client-exports', rule as Rule.RuleModule, {
  valid: [
    {
      name: 'no directive: helper named export is not checked',
      code: 'export function latestTimestamp() { return 0; }\n',
    },
    {
      name: 'directive not first statement: not checked',
      code: "import x from 'y';\n'use client';\nexport function latestTimestamp() { return 0; }\n",
    },
    {
      name: 'export function PascalCase component',
      code: `${USE}export function DataStatus() { return null; }\n`,
    },
    {
      name: 'export const PascalCase component',
      code: `${USE}export const GameCard = () => null;\n`,
    },
    {
      name: 'export default camelCase function is allowed',
      code: `${USE}export default function errorPage() { return null; }\n`,
    },
    {
      name: 'export default expression is allowed',
      code: `${USE}const foo = 1;\nexport default foo;\n`,
    },
    {
      name: 'export type camelCase is allowed',
      code: `${USE}export type sortOption = { value: string };\n`,
    },
    {
      name: 'export interface camelCase is allowed',
      code: `${USE}export interface gameProps { id: number }\n`,
    },
    {
      name: 'export { PascalCase }',
      code: `${USE}function GameCard() { return null; }\nexport { GameCard };\n`,
    },
    {
      name: 'export { a as PascalCase } uses the exported name',
      code: `${USE}const a = 1;\nexport { a as GameCard };\n`,
    },
    {
      name: 're-export named PascalCase from another module',
      code: `${USE}export { GameCard } from './GameCard';\n`,
    },
    {
      name: 'export type { camelCase } from another module',
      code: `${USE}export type { sortOption } from './sortOptions';\n`,
    },
    {
      name: 'export { type camelCase } inline type specifier',
      code: `${USE}type foo = number;\nexport { type foo };\n`,
    },
    {
      name: 'React hook useXxx function is allowed',
      code: `${USE}export function useInfiniteScroll() { return null; }\n`,
    },
    {
      name: 'React hook useXxx const is allowed',
      code: `${USE}export const useApiMutation = () => null;\n`,
    },
    {
      name: 'leading comment then use client still checked as client module',
      code: `/** banner */\n${USE}export function GameCard() { return null; }\n`,
    },
    {
      name: 'use client with no named exports',
      code: `${USE}`,
    },
    {
      name: 'JSX PascalCase component',
      filename: 'GameCard.tsx',
      code: `${USE}export function GameCard() { return <div />; }\n`,
    },
    {
      name: 'double-quoted use client directive',
      code: '"use client";\nexport function GameCard() { return null; }\n',
    },
  ],
  invalid: [
    {
      name: 'invalid helper export function latestTimestamp (#450 shape)',
      filename: 'DataStatus.tsx',
      code: `${USE}export function latestTimestamp() { return 0; }\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'latestTimestamp' } }],
    },
    {
      name: 'invalid helper export const',
      code: `${USE}export const latestTimestamp = () => 0;\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'latestTimestamp' } }],
    },
    {
      name: 'invalid export { camelCase }',
      code: `${USE}const latestTimestamp = 1;\nexport { latestTimestamp };\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'latestTimestamp' } }],
    },
    {
      name: 'invalid export { PascalCase as camelCase } uses exported name',
      code: `${USE}const Foo = 1;\nexport { Foo as latestTimestamp };\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'latestTimestamp' } }],
    },
    {
      name: 'invalid re-export camelCase from another module',
      code: `${USE}export { latestTimestamp } from './times';\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'latestTimestamp' } }],
    },
    {
      name: 'invalid export { a, b as C } flags only a',
      code: `${USE}const a = 1;\nconst b = 2;\nexport { a, b as GameCard };\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'a' } }],
    },
    {
      name: 'invalid screaming-snake const is not PascalCase',
      code: `${USE}export const BASE_SORT_OPTIONS = [];\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'BASE_SORT_OPTIONS' } }],
    },
    {
      name: 'invalid export * from a client module (fail-closed)',
      code: `${USE}export * from './helpers';\n`,
      errors: [{ messageId: 'exportAll' }],
    },
    {
      name: 'invalid export * as ns from a client module (fail-closed)',
      code: `${USE}export * as helpers from './helpers';\n`,
      errors: [{ messageId: 'exportAll' }],
    },
    {
      name: 'invalid use_snake is not a React hook',
      code: `${USE}export function use_notAHook() { return null; }\n`,
      errors: [{ messageId: 'nonComponentExport', data: { name: 'use_notAHook' } }],
    },
  ],
});
