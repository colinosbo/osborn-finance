export const cfg = {
  port: +(process.env.PORT || 4000),
  authMode: process.env.AUTH_MODE || 'dev',
  databaseUrl: process.env.DATABASE_URL || '',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
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
  tokenEncKey: process.env.TOKEN_ENC_KEY || ''
};
export const PLAN_LIMITS: Record<string, { items: number }> = {
  free: { items: 0 }, personal: { items: 1 }, family: { items: 5 }, enterprise: { items: 999 }
};
