# Osborn Finance — Marketing Strategy

Last updated: 2026-06-13. This document is grounded in what the product actually does today (Plaid-linked accounts, auto-categorization, dashboards, reports + PDF export, AI advisor, subscription tracking with bill-increase alerts, savings goals) and the three live tiers: Personal $4.99/mo, Personal+ $9.99/mo, Enterprise $24.99/mo per seat.

A note on honesty: nothing here recommends inventing user counts, fabricating named testimonials, or implying compliance the product doesn't have yet. The on-site changes shipped alongside this doc use only factual claims (encryption method, Plaid/Stripe/Azure reliance, category count, trial length). As real users and real outcomes accumulate, swap the capability stats for genuine social proof — that will convert far better than placeholders ever could.

## Positioning

The sharpest one-line position the product can own is **"See every dollar, across every account — on autopilot."** The differentiator versus the two things people already use is automation and consolidation: a spreadsheet is manual and single-source; a bank's own app only sees that one bank and never tells you a subscription quietly went up. Osborn pulls every account together, categorizes it without effort, and then does the work a budgeting tool usually leaves to you — surfacing recurring charges, catching price hikes, and projecting when you'll hit a savings goal.

Lead with the outcome, not the mechanism. "Know where your money goes" and "stop paying for subscriptions you forgot about" land harder than "transaction categorization engine." The mechanism (Plaid, AES-256, Azure) belongs in the trust section, where it reassures rather than confuses.

## Target segments

The most reachable early buyer is the **subscription-fatigued individual** — someone who suspects they're leaking money on forgotten recurring charges and would pay a few dollars a month to find out. The new bill-increase alerts are tailor-made for this person, and the hook ("the average household wastes money on subscriptions they don't use") is a proven acquisition angle.

The second segment is the **multi-account consolidator** — people with two or three banks, a credit card, and maybe a partner's accounts, who are tired of logging into four apps. Personal+ (up to five linked banks) is built for them, and the "every account in one place" message in the comparison table speaks directly to it.

The third, slower segment is **goal-driven savers** — people saving for a house, a wedding, an emergency fund. The savings-goals feature with on-pace projections gives this segment a reason to open the app weekly, which is the behavior that drives retention and word of mouth.

Enterprise/per-seat is real but should not be a launch focus; treat it as inbound-only until the consumer funnel is working.

## Conversion funnel (and what shipped)

The landing page now follows a deliberate sequence: a benefit-led hero with a sample dashboard, a factual capability-stats band, a how-it-works trio, a security section, a comparison-vs-alternatives table, and a final CTA with a share link. Each section answers the next objection in order — what is it, can I trust the claims, how hard is setup, is my money safe, why not just use what I have, and finally a low-friction ask.

A meaningful fix shipped on the in-app side: the Dashboard no longer shows the marketing pitch to people who have already paid. Free users with no data see the sales landing; paid users with no data see a focused "connect your bank" onboarding instead. Showing a customer a "buy now" page after they've bought is a classic activation leak, and closing it should improve trial-to-active conversion. The redundant standalone `/welcome` screen — a weaker duplicate of the real landing — was removed.

The Plans page gained a monthly/annual toggle (annual = two months free). Annual billing is the single highest-leverage retention lever a subscription product has: it converts a monthly churn decision into a yearly one and pulls cash forward. The toggle is display-and-messaging today; wiring the annual Stripe price IDs is the one backend task needed to make it transact.

Remaining funnel opportunities, roughly in priority order: add a genuine testimonial/outcome section once real users exist; instrument the funnel (see Metrics) so drop-off is visible; consider a limited free tier or an interactive demo so prospects can feel the product before paying, since "connect your bank" is a heavy first ask behind a paywall.

## Pricing and packaging

The current ladder is coherent: 1 bank / 5 banks / unlimited, with the mid tier featured as "Most popular." Two things to tighten. First, reconcile the pricing — the live app charges $4.99 / $9.99 / $24.99, while older planning docs reference $3.99 / $10.99 / $24.99; pick one source of truth (the app is the right one) and align all collateral. Second, the bill-increase alerts and savings goals are now genuine selling points and are reflected in the plan feature lists, but they're available on every paid tier; that's fine for simplicity, but if you ever need to widen the gap between Personal and Personal+, gating "across all accounts" insights (which only matter with multiple banks anyway) is the natural seam.

The free trial (7 days, no upfront charge) is the right mechanism. The thing that will most move trial conversion is making the trial's value obvious fast — the subscription tracker and bill-increase alerts produce a concrete "you're wasting $X/year" number, and that number should be surfaced as early as possible in the post-connect experience.

## Acquisition channels

The cheapest, most-aligned channel is **content built around the subscription-audit angle** — "how to find subscriptions you forgot about," "why your streaming bill keeps creeping up," "the real annual cost of your monthly subscriptions." This is high-intent, low-competition long-tail SEO, and it maps exactly to the bill-increase feature. Each article ends with the product as the automated way to do what the article describes manually.

**Comparison and alternative pages** ("Osborn Finance vs a spreadsheet," "vs your bank's app") capture people already in a solution mindset and reuse the comparison table that now lives on the landing page.

**Referral / word of mouth** is the natural loop for a personal-finance tool because the "I found $200/year in subscriptions" moment is inherently shareable. A share link shipped on the landing page as honest scaffolding; the real win is a two-sided referral program (both parties get a free month) once billing can attribute the `?ref` tag. Build this after annual billing.

Paid acquisition (search/social) can work but only after the organic funnel proves a cost-per-trial-to-paid that the $5–10 ARPU can support; don't buy traffic into an unmeasured funnel.

## Retention

Retention for this product is a function of habit. The features that create a reason to return are the ones to promote in lifecycle email: a weekly or monthly digest ("here's where your money went, here's a subscription that went up, here's your goal progress"). The product already has the data for this — the reports engine, the recurring detector, and the goals projector — so the lifecycle email is largely an assembly job, and a weekly-digest opt-in already exists in preferences. Annual plans plus a dunning-aware billing flow (already handled server-side via Stripe lifecycle events) protect the revenue you've earned.

## Metrics to watch

Instrument the funnel end to end: landing visits → plan-page views → trial starts → bank connected (activation) → trial-to-paid → month-2 retention → annual-plan share. The two numbers that matter most early are **activation rate** (did they connect a bank or import a CSV) and **trial-to-paid**, because everything downstream depends on them. For the subscription angle specifically, track the "money found" figure the tracker surfaces per user — it's both a product-value metric and the headline for marketing copy once you can cite real aggregates.

## Prioritized next steps

The highest-leverage sequence: (1) reconcile pricing across app and docs; (2) instrument the funnel so decisions are data-driven; (3) wire annual Stripe price IDs so the toggle transacts; (4) build the lifecycle/digest email around existing data; (5) launch the two-sided referral program; (6) start the subscription-audit content engine; (7) replace the capability-stats band with real testimonials and an aggregate "money found" stat once the data exists.
