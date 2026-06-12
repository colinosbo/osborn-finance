// Envelope encryption for Plaid access tokens (S2). Prod: TOKEN_ENC_KEY from Key Vault.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { cfg } from './config.js';
// SEC-2: a known fallback key is acceptable ONLY in dev. Production must fail fast.
if (cfg.authMode !== 'dev' && !cfg.tokenEncKey) {
  throw new Error('TOKEN_ENC_KEY must be set when AUTH_MODE is not dev — refusing to start with the dev fallback key');
}

// M5: key registry keyed by a 1-byte id so ciphertext is self-describing and the
// key can be rotated. The current key encrypts new blobs; previous keys remain
// loaded so existing blobs stay decryptable during a rotation window.
//
//   versioned blob layout: [keyId:1][iv:12][authTag:16][ciphertext]
//   legacy blob layout    : [iv:12][authTag:16][ciphertext]   (no key-id prefix)
//
const currentKeyId = cfg.tokenEncKeyId;
const keys = new Map<number, Buffer>();
keys.set(currentKeyId, cfg.tokenEncKey ? Buffer.from(cfg.tokenEncKey, 'base64') : Buffer.alloc(32, 7)); // dev-only fallback
// Previous keys for rotation: TOKEN_ENC_KEY_PREV = "2:<base64>,3:<base64>".
for (const part of cfg.tokenEncKeyPrev.split(',').map(s => s.trim()).filter(Boolean)) {
  const idx = part.indexOf(':');
  const id = +part.slice(0, idx);
  const b64 = part.slice(idx + 1);
  if (Number.isInteger(id) && id >= 1 && id <= 255 && b64 && !keys.has(id)) keys.set(id, Buffer.from(b64, 'base64'));
}
const legacyKey = keys.get(currentKeyId)!; // pre-versioning blobs were written with this key

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', legacyKey, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([currentKeyId]), iv, c.getAuthTag(), enc]).toString('base64');
}

function attempt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): string | null {
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch { return null; }
}

export function decrypt(blob: string): string {
  const b = Buffer.from(blob, 'base64');
  // Versioned: first byte selects the key.
  const key = keys.get(b[0]);
  if (key) {
    const r = attempt(key, b.subarray(1, 13), b.subarray(13, 29), b.subarray(29));
    if (r !== null) return r;
  }
  // Legacy fallback: no key-id prefix.
  const r = attempt(legacyKey, b.subarray(0, 12), b.subarray(12, 28), b.subarray(28));
  if (r !== null) return r;
  throw new Error('decrypt failed: no configured key matched (check TOKEN_ENC_KEY / TOKEN_ENC_KEY_PREV)');
}
