#!/usr/bin/env node
// CI security gate: `npm audit --omit=dev`, with a dated allowlist of advisories.
//
// Fails when any high or critical ADVISORY in the production tree is not covered
// by an unexpired entry in .github/audit-allowlist.json. Entries match on the
// advisory's GHSA id only, never on package name, so a new advisory against the
// same package still fails. Package entries that npm reports as high only because
// they depend on a vulnerable package carry no advisory of their own; they pass
// when every high or critical advisory reachable through their `via` chain is
// allowlisted, and fail when no such advisory can be found.
//
// Usage (CI):    node scripts/audit-gate.mjs
// Usage (tests): node scripts/audit-gate.mjs --input <audit.json> [--allowlist <file>]
//   AUDIT_GATE_TODAY=YYYY-MM-DD overrides the UTC date. It is honoured only with
//   --input, so it cannot shift the expiry of a real audit run.
//
// Exit codes: 0 pass, 1 blocking advisories, 2 could not verify (bad input).
// Built-ins only: this gate must not add an npm dependency.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const NON_BLOCKING = new Set(['info', 'low', 'moderate']);
const GHSA_RE = /GHSA(?:-[0-9a-z]{4}){3}/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_ALLOWLIST = fileURLToPath(
  new URL('../.github/audit-allowlist.json', import.meta.url),
);

class GateError extends Error {}

function parseArgs(argv) {
  const opts = { input: null, allowlist: DEFAULT_ALLOWLIST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--input' || arg === '--allowlist') && argv[i + 1]) {
      opts[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      throw new GateError(`unknown or incomplete argument: ${arg}`);
    }
  }
  return opts;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function today(opts) {
  const override = process.env.AUDIT_GATE_TODAY;
  if (override === undefined || override === '') {
    return new Date().toISOString().slice(0, 10);
  }
  if (!opts.input) {
    throw new GateError('AUDIT_GATE_TODAY is for tests and is honoured only with --input');
  }
  if (!isValidDate(override)) {
    throw new GateError(`AUDIT_GATE_TODAY is not a YYYY-MM-DD date: ${override}`);
  }
  return override;
}

function loadAllowlist(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new GateError(`cannot read allowlist ${file}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.advisories)) {
    throw new GateError('allowlist must be an object with an "advisories" array');
  }
  return data.advisories.map((entry, i) => {
    const where = `allowlist entry ${i}`;
    if (!entry || typeof entry.ghsa !== 'string' || !/^GHSA(?:-[0-9a-z]{4}){3}$/.test(entry.ghsa)) {
      throw new GateError(`${where}: "ghsa" must be a lower-case GHSA id`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new GateError(`${where} (${entry.ghsa}): "reason" is required`);
    }
    for (const key of ['added', 'expires']) {
      if (!isValidDate(entry[key])) {
        throw new GateError(`${where} (${entry.ghsa}): "${key}" must be a YYYY-MM-DD date`);
      }
    }
    if (entry.expires < entry.added) {
      throw new GateError(`${where} (${entry.ghsa}): "expires" is before "added"`);
    }
    return entry;
  });
}

function loadAudit(opts) {
  let raw;
  if (opts.input) {
    try {
      raw = readFileSync(opts.input, 'utf8');
    } catch (err) {
      throw new GateError(`cannot read ${opts.input}: ${err.message}`);
    }
  } else {
    // npm audit exits non-zero whenever it finds anything; the JSON decides.
    const res = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) throw new GateError(`cannot run npm audit: ${res.error.message}`);
    raw = res.stdout;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GateError('npm audit output is not JSON');
  }
  if (data && data.error) {
    throw new GateError(`npm audit reported an error: ${JSON.stringify(data.error)}`);
  }
  if (!data || typeof data.vulnerabilities !== 'object' || data.vulnerabilities === null) {
    throw new GateError('npm audit output has no "vulnerabilities" object');
  }
  return data.vulnerabilities;
}

function severityBlocks(sev) {
  if (BLOCKING.has(sev)) return true;
  if (NON_BLOCKING.has(sev)) return false;
  return true; // unknown severity: fail closed
}

// Collect every advisory object reachable from a package entry through `via`.
function reachableAdvisories(vulns, name, seen = new Set()) {
  if (seen.has(name)) return { advisories: [], dangling: [] };
  seen.add(name);
  const entry = vulns[name];
  if (!entry) return { advisories: [], dangling: [name] };
  const advisories = [];
  const dangling = [];
  for (const v of entry.via ?? []) {
    if (v && typeof v === 'object') {
      advisories.push(v);
    } else if (typeof v === 'string') {
      const sub = reachableAdvisories(vulns, v, seen);
      advisories.push(...sub.advisories);
      dangling.push(...sub.dangling);
    }
  }
  return { advisories, dangling };
}

function evaluate(vulns, allowlist, date) {
  const active = new Map();
  const expired = new Map();
  for (const entry of allowlist) {
    (date <= entry.expires ? active : expired).set(entry.ghsa, entry);
  }

  const lines = [];
  const blocking = [];
  const allowed = new Map();
  let moderateOrLower = 0;

  // 1. Every advisory object, judged on its own severity and GHSA id.
  for (const [pkg, entry] of Object.entries(vulns)) {
    for (const v of entry.via ?? []) {
      if (!v || typeof v !== 'object') continue;
      if (!severityBlocks(v.severity)) {
        moderateOrLower += 1;
        continue;
      }
      const match = typeof v.url === 'string' ? v.url.match(GHSA_RE) : null;
      const ghsa = match ? match[0].toLowerCase().replace(/^ghsa/, 'GHSA') : null;
      const label = `${ghsa ?? `advisory ${v.source ?? '?'} (no GHSA id)`} in ${v.name ?? pkg} (${v.severity})`;
      if (ghsa && active.has(ghsa)) {
        allowed.set(ghsa, active.get(ghsa));
        lines.push(`allowed:  ${label}, allowlisted until ${active.get(ghsa).expires}`);
      } else if (ghsa && expired.has(ghsa)) {
        blocking.push(label);
        lines.push(`BLOCKING: ${label}, allowlist entry expired ${expired.get(ghsa).expires}`);
      } else {
        blocking.push(label);
        lines.push(`BLOCKING: ${label}, not allowlisted`);
      }
    }
  }

  // 2. Every high or critical package entry must trace to a high or critical advisory.
  for (const [pkg, entry] of Object.entries(vulns)) {
    if (!severityBlocks(entry.severity)) continue;
    const { advisories, dangling } = reachableAdvisories(vulns, pkg);
    if (dangling.length > 0 || !advisories.some((a) => severityBlocks(a.severity))) {
      const label = `package ${pkg} (${entry.severity})`;
      blocking.push(label);
      lines.push(`BLOCKING: ${label}, no high or critical advisory found on its via chain`);
    }
  }

  for (const entry of allowlist) {
    if (!allowed.has(entry.ghsa) && active.has(entry.ghsa)) {
      lines.push(`note:     allowlist entry ${entry.ghsa} matched nothing; remove it`);
    }
  }

  const ok = blocking.length === 0;
  lines.push(
    `audit gate: ${ok ? 'PASS' : 'FAIL'} (${blocking.length} blocking, ` +
      `${allowed.size} allowlisted high/critical, ${moderateOrLower} moderate or lower; date ${date} UTC)`,
  );
  return { ok, lines };
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const date = today(opts);
    const allowlist = loadAllowlist(opts.allowlist);
    const vulns = loadAudit(opts);
    const { ok, lines } = evaluate(vulns, allowlist, date);
    for (const line of lines) console.log(line);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    if (err instanceof GateError) {
      console.error(`audit gate: ERROR ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

main();
