// I3: centralized request-body/query validation. Routes previously hand-rolled
// these checks; zod makes them declarative and prevents regressions as the
// surface grows. `parse` returns either parsed data or a 400-ready error message.
import { z, type ZodType } from 'zod';
import { ALL_CATS } from './classifier.js';

export const schemas = {
  recategorize: z.object({
    merchant: z.string().min(1).max(200),
    category: z.enum(ALL_CATS as [string, ...string[]])
  }),
  checkout: z.object({
    plan: z.enum(['personal', 'family', 'enterprise'])
  }),
  demoRequest: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(120).optional(),
    comments: z.string().trim().max(2000).optional()
  }),
  plaidExchange: z.object({
    public_token: z.string().min(1).max(500)
  }),
  reportQuery: z.object({
    offset: z.coerce.number().int().min(0).max(120).optional()
  }),
  reportRange: z.object({
    days: z.coerce.number().int().min(1).max(3650).optional(),
    offset: z.coerce.number().int().min(0).max(120).optional()
  }),
  transactionsQuery: z.object({
    days: z.coerce.number().int().min(0).max(100000).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cat: z.string().max(100).optional(),
    flow: z.enum(['in', 'out']).optional(),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['date', 'amount', 'name', 'category']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    accounts: z.string().max(1000).optional()
  })
};

export function parse<T>(schema: ZodType<T>, data: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const r = schema.safeParse(data ?? {});
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: `${first.path.join('.') || 'body'}: ${first.message}` };
}
