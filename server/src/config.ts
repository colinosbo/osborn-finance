// Resolve runtime environment once. Auth/crypto defaults key off this (H1).
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

export const cfg = {
  nodeEnv,
  isProd,
  port: +(process.env.PORT || 4000),
  // H1: secure-by-default. The dev header-auth path is only the default OUTSIDE
  // production; in production the default is 'entra' and an explicit AUTH_MODE=dev
  // is refused at startup (see assertSecureConfig). A single missing env var can
  // no longer collapse authentication.
  authMode: process.env.AUTH_MODE || (isProd ? 'entra' : 'dev'),
  databaseUrl: process.env.DATABASE_URL || '',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  // H2: issuer must be pinned alongside audience — audience alone is not tenant isolation.
  entra: {
    jwksUrl: process.env.ENTRA_JWKS_URL || '',
    audience: process.env.ENTRA_AUDIENCE || '',
    issuer: process.env.ENTRA_ISSUER || ''
  },
  // L3: salt for the audit-log client-IP hash.
  auditIpSalt: process.env.AUDIT_IP_SALT || 'osfin-dev-salt',
  plaid: {
    clientId: process.env.PLAID_CLIENT_ID || '',
    secret: process.env.PLAID_SECRET || '',
    env: process.env.PLAID_ENV || 'sandbox',
    mock: !process.env.PLAID_CLIENT_ID
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      personal: process.env.STRIPE_PRICE_PERSONAL || 'price_personal_dev',
      family: process.env.STRIPE_PRICE_FAMILY || 'price_family_dev',
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_dev'
    },
    mock: !process.env.STRIPE_SECRET_KEY
  },
  tokenEncKey: process.env.TOKEN_ENC_KEY || '',
  // M5: current key id (1 byte, 1..255) and optional previous keys "id:base64,id:base64"
  // kept live during a rotation window so old ciphertext stays decryptable.
  tokenEncKeyId: Math.min(255, Math.max(1, +(process.env.TOKEN_ENC_KEY_ID || 1))),
  tokenEncKeyPrev: process.env.TOKEN_ENC_KEY_PREV || ''
};

// H1/H2/SEC-2: collect fatal misconfigurations. Returns a list of problems;
// the entrypoint logs each and refuses to boot if any exist in production.
export function assertSecureConfig(): string[] {
  const problems: string[] = [];
  if (cfg.isProd && cfg.authMode === 'dev')
    problems.push('AUTH_MODE=dev is not permitted in production — header-based auth is a full bypass. Set AUTH_MODE=entra.');
  if (cfg.authMode === 'entra') {
    if (!cfg.entra.jwksUrl) problems.push('ENTRA_JWKS_URL must be set when AUTH_MODE=entra.');
    if (!cfg.entra.audience) problems.push('ENTRA_AUDIENCE must be set when AUTH_MODE=entra.');
    if (!cfg.entra.issuer) problems.push('ENTRA_ISSUER must be set when AUTH_MODE=entra (H2: issuer pinning).');
  }
  if (cfg.authMode !== 'dev' && !cfg.tokenEncKey)
    problems.push('TOKEN_ENC_KEY must be set when AUTH_MODE is not dev (SEC-2).');
  return problems;
}

export const PLAN_LIMITS: Record<string, { items: number }> = {
  free: { items: 0 }, personal: { items: 1 }, family: { items: 5 }, enterprise: { items: 999 }
};
