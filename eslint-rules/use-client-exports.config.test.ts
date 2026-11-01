import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(root, 'eslint.config.mjs');
const fixturePath = path.join(root, 'src/components/DataStatus.tsx');

function ruleMessages(results: ESLint.LintResult[]) {
  return (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'local/use-client-exports',
  );
}

describe('eslint.config.mjs registers local/use-client-exports', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: configFile,
    });
  });

  it('reports the #450 helper export from a src/ filePath', async () => {
    const results = await eslint.lintText(
      "'use client';\nexport function latestTimestamp() {}\n",
      { filePath: fixturePath },
    );
    const hits = ruleMessages(results);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.ruleId).toBe('local/use-client-exports');
  });

  it('does not report a PascalCase component export', async () => {
    const results = await eslint.lintText(
      "'use client';\nexport function DataStatus() { return null; }\n",
      { filePath: fixturePath },
    );
    expect(ruleMessages(results)).toEqual([]);
  });
});
