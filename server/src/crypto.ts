// Envelope encryption for Plaid access tokens (S2). Prod: TOKEN_ENC_KEY from Key Vault.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { cfg } from './config.js';
// SEC-2: a known fallback key is acceptable ONLY in dev. Production must fail fast.
if (cfg.authMode !== 'dev' && !cfg.tokenEncKey) {
  throw new Error('TOKEN_ENC_KEY must be set when AUTH_MODE is not dev — refusing to start with the dev fallback key');
}
const key = cfg.tokenEncKey ? Buffer.from(cfg.tokenEncKey, 'base64') : Buffer.alloc(32, 7); // dev-only fallback
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(blob: string): string {
  const b = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
