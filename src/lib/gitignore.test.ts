import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CASES = [
  ['.env', true],
  ['.env.production', true],
  ['.env.demo', true],
  ['.env.local', true],
  ['.env.production.local', true],
  ['.env.preview', true],
  ['.deploy.env', true],
  ['.env.example', false],
  ['nested/config/.env', true],
  ['nested/config/.env.production', true],
  ['nested/config/.env.demo', true],
  ['nested/config/.env.local', true],
  ['nested/config/.env.production.local', true],
  ['nested/config/.env.preview', true],
  ['nested/config/.deploy.env', true],
  ['nested/config/.env.example', false],
] as const;

describe('environment file ignores', () => {
  it('ignores real env files at any depth but keeps examples visible', () => {
    const result = spawnSync(
      'git',
      ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin'],
      {
        cwd: process.cwd(),
        input: `${CASES.map(([name]) => name).join('\n')}\n`,
        encoding: 'utf8',
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    const ignored = new Set(result.stdout.trim().split('\n'));
    for (const [name, shouldIgnore] of CASES) {
      expect.soft(ignored.has(name), `${name} must ${shouldIgnore ? '' : 'not '}be ignored`)
        .toBe(shouldIgnore);
    }
  });
});
