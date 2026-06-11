// Stripe billing — real when STRIPE_SECRET_KEY set, mock otherwise. Card data never touches this server (Checkout).
import { cfg } from './config.js';

async function stripePost(path: string, form: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  if (!res.ok) throw new Error(`stripe ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export const PLAN_PRICES: Record<string, { price: string; label: string; amount: number }> = {
  personal: { price: cfg.stripe.prices.personal, label: 'Personal', amount: 399 },
  family: { price: cfg.stripe.prices.family, label: 'Family', amount: 1099 },
  enterprise: { price: cfg.stripe.prices.enterprise, label: 'Enterprise', amount: 2499 }
};

export const Billing = {
  async createCheckout(userId: string, email: string, plan: string) {
    const p = PLAN_PRICES[plan];
    if (!p) throw new Error('unknown plan');
    if (cfg.stripe.mock) return { url: `${cfg.appBaseUrl}/billing/mock-checkout?plan=${plan}&user=${userId}`, mock: true };
    const session = await stripePost('/checkout/sessions', {
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
    const s = await stripePost('/billing_portal/sessions', { customer: stripeCustomerId, return_url: `${cfg.appBaseUrl}/settings` });
    return { url: s.url, mock: false };
  }
};

// webhook events we act on (signature verification required in prod — raw body + STRIPE_WEBHOOK_SECRET)
export function planFromEvent(evt: { type: string; data: { object: Record<string, unknown> } }): { userId?: string; plan?: string; customer?: string; cancel?: boolean } {
  const o = evt.data.object as Record<string, never>;
  if (evt.type === 'checkout.session.completed') {
    return { userId: o['client_reference_id'], customer: o['customer'], plan: undefined };
  }
  if (evt.type === 'customer.subscription.deleted') return { customer: o['customer'], cancel: true };
  return {};
}
