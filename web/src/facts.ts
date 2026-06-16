// Personalized "interesting facts" derived from a generated report. Pure and
// client-side (no extra API/data), so it works for both the on-screen report and
// the PDF. Formatters are passed in so each caller uses its own money formatting.
export interface FactInput {
  kpis: { income: { value: number }; spend: { value: number }; net: { value: number }; savingsRate: { value: number }; count: number };
  categories: { name: string; share: number; count: number }[];
  merchants: { name: string; total: number; count: number }[];
  biggest: { name: string; amount: number; count?: number }[];
  trend: { label: string; out: number }[];
  subscriptions: { count: number; annual: number };
  incomeSources: { name: string; total: number }[];
}

export function buildFacts(rep: FactInput, fmt: (n: number) => string, fmt0: (n: number) => string): { icon: string; text: string }[] {
  const f: { icon: string; text: string }[] = [];
  const spend = rep.kpis.spend.value, income = rep.kpis.income.value, net = rep.kpis.net.value;

  if (rep.biggest[0]) {
    const b = rep.biggest[0];
    f.push({ icon: '🏆', text: `Your biggest expense was ${b.name} at ${fmt(Math.abs(b.amount))}${b.count && b.count > 1 ? ` across ${b.count} charges` : ''}.` });
  }
  const mv = [...rep.merchants].sort((a, b) => b.count - a.count)[0];
  if (mv && mv.count >= 3) f.push({ icon: '🔁', text: `${mv.name} is your most frequent stop — ${mv.count} visits totaling ${fmt(mv.total)}.` });
  if (rep.categories[0] && spend > 0) f.push({ icon: '📊', text: `${rep.categories[0].name} was ${rep.categories[0].share}% of everything you spent.` });
  const spendTx = rep.categories.reduce((s, c) => s + c.count, 0);
  if (spendTx > 0 && spend > 0) f.push({ icon: '🧾', text: `${spendTx} purchases this period, averaging ${fmt(spend / spendTx)} each.` });
  if (income > 0 && spend > 0) f.push(income >= spend
    ? { icon: '💵', text: `Your income covered your spending ${(income / spend).toFixed(1)}× over.` }
    : { icon: '⚠', text: `You spent ${fmt(spend / income)} for every $1 you earned.` });
  if (net > 0 && income > 0) f.push({ icon: '✅', text: `You kept ${fmt(net)} of your income, a ${rep.kpis.savingsRate.value}% savings rate.` });
  if (rep.subscriptions.count > 0) f.push({ icon: '↻', text: `Your ${rep.subscriptions.count} subscription${rep.subscriptions.count > 1 ? 's' : ''} add up to ${fmt0(rep.subscriptions.annual)} a year.` });
  if (rep.trend.length > 1) { const peak = rep.trend.reduce((a, b) => b.out > a.out ? b : a); if (peak.out > 0) f.push({ icon: '📈', text: `Your spending peaked in ${peak.label} at ${fmt0(peak.out)}.` }); }
  if (rep.incomeSources[0]) f.push({ icon: '💰', text: `Your largest income source was ${rep.incomeSources[0].name} (${fmt(rep.incomeSources[0].total)}).` });

  return f;
}
