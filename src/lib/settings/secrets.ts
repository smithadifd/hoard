/**
 * Field-level encryption for secret settings values (Queue S · S12 · MC-3).
 *
 * The `settings` table stores a handful of secret values (Steam / ITAD API keys
 * and both Discord webhook URLs) as plaintext JSON. This module encrypts those
 * values *at rest* with a versioned, authenticated scheme so a leaked SQLite
 * file or backup does not hand over live credentials.
 *
 * ## Versioned, non-bricking scheme
 *
 * A stored value is one of:
 *   - `enc:v1:<base64>` — a value written by this code: AES-256-GCM ciphertext.
 *   - anything else      — a **legacy plaintext** value (the state of every row
 *     today) OR a value written while no key was configured. Read verbatim.
 *
 * `decryptSecret` keys entirely off the `enc:v1:` prefix, so it transparently
 * reads BOTH legacy plaintext and freshly-encrypted values. `encryptSecret`
 * always produces `enc:v1:` ciphertext (when a key is configured). This is what
 * makes the rollout non-bricking: existing plaintext rows stay readable, new
 * writes are encrypted, and the two are distinguished by the version tag. The
 * `v1` tag also leaves room for a future scheme (`v2`, key rotation, …).
 *
 * **The one-time re-encryption of existing plaintext rows is a SEPARATE
 * supervised migration** — this module only makes both forms readable and
 * writes new values encrypted.
 *
 * ## Key handling (transition-safe)
 *
 * The key comes from `HOARD_SECRETS_KEY` (or `SETTINGS_ENCRYPTION_KEY`). The raw
 * env value is any-length passphrase; it is stretched to a 32-byte AES key with
 * scrypt over a fixed application salt (deterministic, so ciphertext written on
 * one boot decrypts on the next).
 *
 * If NO key is configured:
 *   - `encryptSecret` returns the plaintext unchanged (with a one-time warning),
 *     so a deploy that has not yet set the key does not crash — it simply keeps
 *     writing plaintext, exactly like today.
 *   - `decryptSecret` returns legacy plaintext verbatim; if it encounters an
 *     already-encrypted value it *cannot* read (no key, wrong key, or corrupt
 *     ciphertext), it FAILS CLOSED — returns the empty "absent" string (loud
 *     one-time warning) rather than the raw ciphertext, and never throws.
 *
 * ## Fail-closed on undecryptable ciphertext (why empty, not the ciphertext)
 *
 * Returning the raw `enc:v1:` ciphertext on a decrypt failure would leak a
 * garbage credential into live consumers: `config.ts` merges `dbSettings[key] ||
 * envConfig.x`, and a truthy ciphertext string would WIN over the env-var
 * fallback — defeating the one recovery path (env var) in the exact disaster
 * (key lost/rotated/corrupt). Steam/ITAD would then auth with junk and Discord
 * would `fetch('enc:v1:…')`. So an undecryptable secret returns `''`, which is
 * falsy: `config.ts`'s `|| envConfig` falls through to the env var, and the
 * `_secrets` truthiness check reports it not-usable.
 *
 * Negligible tradeoff: a *legacy plaintext* value that literally starts with
 * `enc:v1:` would, on the no-key branch, be treated as ciphertext and return `''`
 * instead of verbatim. Real secret values (https:// webhook URLs, hex/opaque API
 * keys) never start with `enc:v1:`, and such a value is anyway indistinguishable
 * from corrupt ciphertext — fail-closed is the correct call.
 *
 * Nothing here ever generates a key on boot — that would make ciphertext written
 * this boot unreadable next boot.
 */

import crypto from 'node:crypto';

const VERSION = 'v1';
/** Prefix that tags a value as ciphertext produced by this module. */
export const ENC_PREFIX = `enc:${VERSION}:`;

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit nonce, GCM standard
const TAG_LEN = 16; // 128-bit auth tag
// Fixed, non-secret application salt for the scrypt KDF. It only needs to be
// stable across boots (so the derived key is deterministic); it is not a secret.
const KDF_SALT = 'hoard.settings.secrets.v1';

/** Read the configured key material, if any. Re-read per call so tests/rotations take effect. */
function readEnvKey(): string | undefined {
  const raw = process.env.HOARD_SECRETS_KEY || process.env.SETTINGS_ENCRYPTION_KEY;
  return raw && raw.length > 0 ? raw : undefined;
}

// Derived-key cache, keyed by the raw env value so a rotated key re-derives.
let cachedRaw: string | undefined;
let cachedKey: Buffer | undefined;

/** Returns the 32-byte AES key, or null when no key material is configured. */
function getKey(): Buffer | null {
  const raw = readEnvKey();
  if (!raw) return null;
  if (raw !== cachedRaw || !cachedKey) {
    cachedKey = crypto.scryptSync(raw, KDF_SALT, 32);
    cachedRaw = raw;
  }
  return cachedKey;
}

// One-time warnings so the transition window does not spam logs on every read.
let warnedEncryptNoKey = false;
let warnedDecryptNoKey = false;

/** True if `value` is ciphertext produced by this module (has the version prefix). */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a secret value for storage.
 * Returns `enc:v1:<base64(iv|tag|ciphertext)>`. With no key configured, returns
 * the plaintext unchanged (transition-safe) after a one-time warning.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (!warnedEncryptNoKey) {
      console.warn(
        '[settings-crypto] HOARD_SECRETS_KEY not set — storing secret settings as PLAINTEXT. ' +
          'Set HOARD_SECRETS_KEY to encrypt secrets at rest.',
      );
      warnedEncryptNoKey = true;
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64');
  return `${ENC_PREFIX}${packed}`;
}

// The "absent" value returned when an encrypted secret cannot be recovered. It
// is falsy so config.ts's `dbSettings[key] || envConfig.x` falls through to the
// env-var fallback, and the `_secrets` truthiness check reports it not-usable.
// Deliberately NOT the raw ciphertext — see the fail-closed note in the header.
const UNRECOVERABLE_SECRET = '';

/**
 * Decrypt a stored secret value.
 * - Unprefixed value (legacy plaintext, or written key-less): returned verbatim.
 * - `enc:v1:` value with a key configured: decrypted and authenticated.
 * - `enc:v1:` value with NO key, or a decrypt/auth failure: FAILS CLOSED —
 *   returns the empty "absent" string (loud one-time warning), never the raw
 *   ciphertext, and never throws. This lets config.ts's env-var fallback take
 *   over instead of feeding junk ciphertext to Steam/ITAD/Discord.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext → verbatim (unchanged)

  const key = getKey();
  if (!key) {
    if (!warnedDecryptNoKey) {
      console.warn(
        '[settings-crypto] Found an encrypted secret but HOARD_SECRETS_KEY is not set — ' +
          'cannot decrypt; treating it as absent so the env-var fallback applies. ' +
          'Restore HOARD_SECRETS_KEY.',
      );
      warnedDecryptNoKey = true;
    }
    return UNRECOVERABLE_SECRET;
  }

  try {
    const packed = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = packed.subarray(0, IV_LEN);
    const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = packed.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    console.error(
      '[settings-crypto] Failed to decrypt a secret setting (wrong key or corrupt value); ' +
        'treating it as absent so the env-var fallback applies.',
      err,
    );
    return UNRECOVERABLE_SECRET;
  }
}

/**
 * TEST-ONLY: reset the derived-key cache and one-time-warning flags so tests can
 * exercise the key-set / key-unset transitions deterministically. Not for
 * production use.
 */
export function __resetSecretsCryptoStateForTests(): void {
  cachedRaw = undefined;
  cachedKey = undefined;
  warnedEncryptNoKey = false;
  warnedDecryptNoKey = false;
}
