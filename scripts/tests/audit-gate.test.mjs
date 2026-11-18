// Self-test for scripts/audit-gate.mjs against canned `npm audit --json` reports.
// Run: node --test scripts/tests/audit-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../audit-gate.mjs', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/audit-gate/', import.meta.url));
const allowlist = join(fixtures, 'allowlist.json');
const realAllowlist = fileURLToPath(new URL('../../.github/audit-allowlist.json', import.meta.url));

function run(fixture, { today = '2026-11-18', list = allowlist, input = true } = {}) {
  const args = [gate];
  if (input) args.push('--input', join(fixtures, fixture));
  args.push('--allowlist', list);
  const env = { ...process.env, AUDIT_GATE_TODAY: today };
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function tempAllowlist(advisories) {
  const file = join(mkdtempSync(join(tmpdir(), 'audit-gate-')), 'allowlist.json');
  writeFileSync(file, JSON.stringify({ advisories }));
  return file;
}

test('(a) only the allowlisted advisory: pass', () => {
  const { code, out } = run('allowlisted-only.json');
  assert.equal(code, 0, out);
  assert.match(out, /allowed: {2}GHSA-fc5q-39xc-vjpf in picomatch \(high\)/);
  assert.match(out, /audit gate: PASS/);
});

test('(b) allowlisted plus another high advisory: fail', () => {
  const { code, out } = run('allowlisted-plus-other-high.json');
  assert.equal(code, 1, out);
  assert.match(out, /BLOCKING: GHSA-aaaa-bbbb-cccc in undici \(high\), not allowlisted/);
  assert.match(out, /audit gate: FAIL \(1 blocking/);
});

test('(c) a different picomatch advisory: fail', () => {
  const { code, out } = run('other-picomatch-ghsa.json');
  assert.equal(code, 1, out);
  assert.match(out, /BLOCKING: GHSA-wxyz-2345-6789 in picomatch \(high\), not allowlisted/);
  assert.match(out, /audit gate: FAIL/);
});

test('(c2) a second picomatch advisory beside the allowlisted one: fail', () => {
  const { code, out } = run('allowlisted-plus-other-picomatch.json');
  assert.equal(code, 1, out);
  assert.match(out, /BLOCKING: GHSA-mnop-qrst-uvwx in picomatch \(critical\)/);
});

test('(d) allowlisted advisory past its expiry: fail', () => {
  const { code, out } = run('allowlisted-only.json', { today: '2027-01-01' });
  assert.equal(code, 1, out);
  assert.match(out, /BLOCKING: GHSA-fc5q-39xc-vjpf in picomatch \(high\), allowlist entry expired 2026-12-31/);
});

test('(d2) allowlisted advisory on its expiry date: still pass', () => {
  const { code, out } = run('allowlisted-only.json', { today: '2026-12-31' });
  assert.equal(code, 0, out);
});

test('(e) moderate-only report: pass', () => {
  const { code, out } = run('moderate-only.json');
  assert.equal(code, 0, out);
  assert.match(out, /audit gate: PASS \(0 blocking, 0 allowlisted high\/critical, 1 moderate or lower/);
});

test('empty allowlist: the picomatch advisory fails', () => {
  const { code, out } = run('allowlisted-only.json', { list: tempAllowlist([]) });
  assert.equal(code, 1, out);
});

test('high package entry whose via chain does not resolve: fail', () => {
  const { code, out } = run('dangling-via.json');
  assert.equal(code, 1, out);
  assert.match(out, /BLOCKING: package fdir \(high\), no high or critical advisory found/);
});

test('high advisory without a GHSA id: fail', () => {
  const { code, out } = run('high-without-ghsa.json');
  assert.equal(code, 1, out);
  assert.match(out, /no GHSA id/);
});

test('npm audit error output: could not verify (exit 2)', () => {
  const { code, out } = run('npm-error.json');
  assert.equal(code, 2, out);
});

test('malformed allowlist entry: could not verify (exit 2)', () => {
  const list = tempAllowlist([{ ghsa: 'GHSA-fc5q-39xc-vjpf', added: '2026-11-18', expires: '2026-12-31' }]);
  const { code, out } = run('allowlisted-only.json', { list });
  assert.equal(code, 2, out);
  assert.match(out, /"reason" is required/);
});

test('date override without --input is refused (exit 2)', () => {
  const { code, out } = run('allowlisted-only.json', { input: false });
  assert.equal(code, 2, out);
  assert.match(out, /AUDIT_GATE_TODAY is for tests/);
});

test('committed allowlist is well formed and dated', () => {
  const { code, out } = run('moderate-only.json', { list: realAllowlist });
  assert.equal(code, 0, out);
  const { advisories } = JSON.parse(readFileSync(realAllowlist, 'utf8'));
  for (const entry of advisories) {
    assert.ok(entry.expires >= entry.added, entry.ghsa);
  }
});
