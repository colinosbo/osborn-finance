// Stripe billing — real when STRIPE_SECRET_KEY set, mock otherwise.
// Card data never touches this server (Checkout). Webhooks are HMAC-verified (SEC-4).
import { createHmac, timingSafeEqual } from 'crypto';
import { cfg } from './config.js';

async function stripeApi(method: string, path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form) : undefined
  });
  // L1: don't fold the raw Stripe body into the error (avoids leaking request
  // echoes / identifiers into logs). Surface status + Stripe error code only.
  if (!res.ok) {
    let code = '';
    try { code = ((await res.json()) as { error?: { code?: string } }).error?.code || ''; } catch { /* non-JSON body */ }
    throw new Error(`stripe ${path} failed: ${res.status}${code ? ` (${code})` : ''}`);
  }
  return res.json();
}

export const PLAN_PRICES: Record<string, { price: string; label: string; amount: number }> = {
  personal: { price: cfg.stripe.prices.personal, label: 'Personal', amount: 399 },
  family: { price: cfg.stripe.prices.family, label: 'Family', amount: 1099 },
  enterprise: { price: cfg.stripe.prices.enterprise, label: 'Enterprise', amount: 2499 }
};

// BUG-1 fix: derive the plan from the Stripe price id, never from a guessed field.
export function planFromPriceId(priceId: string | undefined): string | null {
  if (!priceId) return null;
  for (const [plan, p] of Object.entries(PLAN_PRICES)) if (p.price === priceId) return plan;
  return null;
}

// SEC-4/BUG-3 fix: verify Stripe-Signature (t=...,v1=...) against the RAW body.
export function verifyStripeSignature(rawBody: Buffer | string, sigHeader: string | undefined, secret: string, toleranceSec = 300): boolean {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=') as [string, string]));
  const t = parts['t'], v1 = parts['v1'];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const payload = `${t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface StripeEventAction {
  kind: 'activate' | 'update' | 'cancel' | 'payment_failed' | 'ignore';
  userId?: string;            // activate only (client_reference_id)
  customer?: string;
  plan?: string | null;
  subscriptionId?: string;
  currentPeriodEnd?: number;  // unix seconds
}

// INC-1 fix: handle the full subscription lifecycle, not just the first purchase.
export function parseStripeEvent(evt: { type: string; data: { object: Record<string, unknown> } }): StripeEventAction {
  const o = (evt?.data?.object || {}) as Record<string, never>;
  const items = (o as never as { items?: { data?: Array<{ price?: { id?: string } }> } }).items;
  const priceId = items?.data?.[0]?.price?.id;
  switch (evt?.type) {
    case 'checkout.session.completed':
      return { kind: 'activate', userId: o['client_reference_id'], customer: o['customer'], subscriptionId: o['subscription'], plan: planFromPriceId(priceId) };
    case 'customer.subscription.updated':
      return { kind: 'update', customer: o['customer'], plan: planFromPriceId(priceId), subscriptionId: o['id'], currentPeriodEnd: o['current_period_end'] };
    case 'customer.subscription.deleted':
      return { kind: 'cancel', customer: o['customer'], subscriptionId: o['id'] };
    case 'invoice.payment_failed':
      return { kind: 'payment_failed', customer: o['customer'] };
    default:
      return { kind: 'ignore' };
  }
}

// For checkout.session.completed the session doesn't embed line items —
// fetch the subscription to learn which price (and so which plan) was bought.
export async function fetchSubscriptionPlan(subscriptionId: string): Promise<{ plan: string | null; currentPeriodEnd: number | null }> {
  if (cfg.stripe.mock) return { plan: null, currentPeriodEnd: null };
  const sub = await stripeApi('GET', `/subscriptions/${subscriptionId}`);
  return { plan: planFromPriceId(sub?.items?.data?.[0]?.price?.id), currentPeriodEnd: sub?.current_period_end ?? null };
}

export const Billing = {
  async createCheckout(userId: string, email: string, plan: string) {
    const p = PLAN_PRICES[plan];
    if (!p) throw new Error('unknown plan');
    if (cfg.stripe.mock) return { url: `${cfg.appBaseUrl}/billing/mock-checkout?plan=${plan}&user=${userId}`, mock: true };
    const session = await stripeApi('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer_email: email,
      'line_items[0][price]': p.price,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '14',
      client_reference_id: userId,
      success_url: `${cfg.appBaseUrl}/settings?billing=success`,
      cancel_url: `${cfg.appBaseUrl}/plans?billing=cancelled`
    });
    return { url: session.url, mock: false };
  },
  async createPortal(stripeCustomerId: string) {
    if (cfg.stripe.mock) return { url: `${cfg.appBaseUrl}/billing/mock-portal`, mock: true };
    const s = await stripeApi('POST', '/billing_portal/sessions', { customer: stripeCustomerId, return_url: `${cfg.appBaseUrl}/settings` });
    return { url: s.url, mock: false };
  }
};
