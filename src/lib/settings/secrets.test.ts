import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  ENC_PREFIX,
  __resetSecretsCryptoStateForTests,
} from './secrets';

const KEY = 'test-secret-key-material-do-not-use-in-prod';

function withKey() {
  process.env.HOARD_SECRETS_KEY = KEY;
}
function withoutKey() {
  delete process.env.HOARD_SECRETS_KEY;
  delete process.env.SETTINGS_ENCRYPTION_KEY;
}

beforeEach(() => {
  __resetSecretsCryptoStateForTests();
  withoutKey();
});

afterEach(() => {
  withoutKey();
  vi.restoreAllMocks();
});

// ============================================================================
// THE MANDATORY NON-BRICKING ROUND-TRIP TEST — leads the suite.
// Existing rows are plaintext TODAY; this proves the new code reads them AND
// round-trips new encrypted values AND degrades safely when no key is set.
// ============================================================================
describe('non-bricking round-trip (the load-bearing guarantee)', () => {
  it('reads a LEGACY PLAINTEXT value verbatim (no prefix) — with or without a key', () => {
    const legacy = 'AAAA1111BBBB2222-legacy-plaintext-steam-key';

    // No key configured (the state during a not-yet-keyed deploy).
    withoutKey();
    expect(decryptSecret(legacy)).toBe(legacy);

    // Key configured — a legacy value still has no prefix, so still verbatim.
    __resetSecretsCryptoStateForTests();
    withKey();
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it('round-trips a NEW value written by this code (encrypt → decrypt === original)', () => {
    withKey();
    const secret = 'https://discord.com/api/webhooks/123456789/abcDEF-token';
    const stored = encryptSecret(secret);

    expect(stored.startsWith(ENC_PREFIX)).toBe(true);
    expect(stored).not.toContain(secret); // ciphertext must not embed plaintext
    expect(decryptSecret(stored)).toBe(secret);
  });

  it('with the key UNSET, read + write degrade to PLAINTEXT + a warning (no crash)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withoutKey();

    const secret = 'itad-api-key-value';
    // Write degrades to plaintext (unchanged), no throw.
    const stored = encryptSecret(secret);
    expect(stored).toBe(secret);
    expect(isEncrypted(stored)).toBe(false);

    // Read of that plaintext returns it verbatim.
    expect(decryptSecret(stored)).toBe(secret);

    // A warning was logged about the missing key.
    expect(warn).toHaveBeenCalled();
  });
});

// ============================================================================
// Encrypted-at-rest properties
// ============================================================================
describe('encrypted-at-rest', () => {
  beforeEach(withKey);

  it('produces the versioned enc:v1: prefix', () => {
    expect(encryptSecret('x').startsWith('enc:v1:')).toBe(true);
  });

  it('never stores the plaintext in the ciphertext', () => {
    const secret = 'super-secret-steam-key-9f8e7d';
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain('super-secret');
  });

  it('is non-deterministic (random IV per encryption)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b); // different IV → different ciphertext
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('round-trips empty string and unicode', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('kéy—✓ 日本語'))).toBe('kéy—✓ 日本語');
  });

  it('isEncrypted detects ciphertext vs plaintext', () => {
    expect(isEncrypted(encryptSecret('v'))).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });
});

// ============================================================================
// Failure modes must never throw (non-bricking safety net)
// ============================================================================
describe('failure modes degrade safely (never throw)', () => {
  it('tampered ciphertext fails auth → FAILS CLOSED to empty (not ciphertext, not plaintext) + logs error', () => {
    withKey();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stored = encryptSecret('authentic-value');
    // Flip a character deep in the base64 body to corrupt the ciphertext/tag.
    const body = stored.slice(ENC_PREFIX.length);
    const flipped = body[10] === 'A' ? 'B' : 'A';
    const tampered = ENC_PREFIX + body.slice(0, 10) + flipped + body.slice(11);

    expect(() => decryptSecret(tampered)).not.toThrow();
    // Fail-closed: returns '' so config.ts's env-var fallback engages, NOT the
    // raw ciphertext (which is truthy and would defeat the fallback).
    expect(decryptSecret(tampered)).toBe('');
    expect(err).toHaveBeenCalled();
  });

  it('an encrypted value with the key REMOVED FAILS CLOSED to empty (not ciphertext) + warns (no crash)', () => {
    withKey();
    const stored = encryptSecret('value-encrypted-while-keyed');
    __resetSecretsCryptoStateForTests();
    withoutKey();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => decryptSecret(stored)).not.toThrow();
    expect(decryptSecret(stored)).toBe(''); // absent, not the ciphertext
    expect(warn).toHaveBeenCalled();
  });

  it('SETTINGS_ENCRYPTION_KEY is accepted as an alternate env var', () => {
    withoutKey();
    process.env.SETTINGS_ENCRYPTION_KEY = 'alternate-key-var';
    const stored = encryptSecret('via-alt-var');
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('via-alt-var');
  });
});
