// Custom report PDF — vector-drawn with jsPDF, styled to match the app's
// on-screen report (gray theme, violet accents, sharp corners). Only the
// sections enabled in the report customizer are rendered, and whole sections
// are kept together across page breaks where they fit. jsPDF loads on demand
// from CDN (its bundle drags in core-js internals Vite can't resolve), with
// fallback mirrors.
import { color } from './api';
import { buildFacts } from './facts';

const JSPDF_URLS = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

interface Kpi { value: number; prev: number; delta: number; pct: number | null }
interface Cat { name: string; total: number; count: number; prev: number; delta: number; share: number }
interface Tip { icon: string; title: string; text: string; savePerMonth: number; pinned?: boolean }
interface Big { date: string; name: string; merchant: string; amount: number; category: string; count?: number }
export interface ReportPDFData {
  period: { from: string; to: string; label: string; days: number; grain: string };
  kpis: { income: Kpi; spend: Kpi; net: Kpi; savingsRate: Kpi; count: number };
  categories: Cat[];
  merchants: { name: string; total: number; count: number }[];
  trend: { label: string; in: number; out: number; net: number }[];
  biggest: Big[];
  newMerchants: string[];
  incomeSources: { name: string; total: number; count: number }[];
  subscriptions: { count: number; names: string[]; monthly: number; annual: number; items: { name: string; cadence: string; monthly: number; annual: number }[] };
  insights: { tips: Tip[]; totalSavePerMonth: number; savingsRate: number };
  investments?: {
    hasData: boolean; asOf: string | null; totalValue: number; totalChange: number | null; contributions: number;
    accounts: { name: string; mask: string; type: string; value: number; start: number | null; change: number | null; changePct: number | null; tracking: boolean; since: string | null }[];
  };
}
export interface PDFSections { kpis: boolean; categories: boolean; donut: boolean; income: boolean; insights: boolean; topSpending: boolean; subscriptions: boolean; investments: boolean }
export interface PDFOpts { sections?: PDFSections; topN?: number }

type RGB = [number, number, number];
interface Doc {
  setFont(f: string, s?: string): void; setFontSize(n: number): void;
  setTextColor(r: number, g: number, b: number): void; setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void; setLineWidth(n: number): void;
  text(t: string | string[], x: number, y: number, o?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: string): void;
  circle(x: number, y: number, r: number, style?: string): void;
  splitTextToSize(t: string, w: number): string[]; getTextWidth(t: string): number;
  addPage(): void; setPage(n: number): void; getNumberOfPages(): number; save(name: string): void;
}

let loader: Promise<void> | null = null;
const hasJsPDF = () => !!(window as unknown as { jspdf?: { jsPDF?: unknown } }).jspdf?.jsPDF;
function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = src; sc.async = true;
    sc.onload = () => hasJsPDF() ? resolve() : reject(new Error('global missing'));
    sc.onerror = () => reject(new Error('script error'));
    document.head.appendChild(sc);
  });
}
function loadJsPDF(): Promise<void> {
  if (hasJsPDF()) return Promise.resolve();
  if (loader) return loader;
  loader = (async () => { for (const u of JSPDF_URLS) { try { await loadScript(u); return; } catch { /* next */ } } loader = null; throw new Error('Could not load the PDF library from any CDN'); })();
  return loader;
}

// ---- gray-theme palette (mirrors styles.css :root / data-theme='gray') ----
const BG: RGB = [15, 16, 17], SURF: RGB = [23, 24, 26], SURF2: RGB = [20, 21, 23], BORDER: RGB = [41, 42, 45], HAIR: RGB = [32, 33, 35];
const INK: RGB = [233, 234, 236], MUTED: RGB = [160, 163, 168], FAINT: RGB = [113, 116, 122];
const VIOLET: RGB = [139, 92, 246], VIOLETB: RGB = [167, 139, 250], ACCENT: RGB = [42, 39, 64];
const GREEN: RGB = [58, 208, 127], RED: RGB = [255, 107, 107], WHITE: RGB = [255, 255, 255];

const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
// keep only glyphs the standard PDF font can render (ASCII + Latin-1)
const safe = (s: string) => (s || '').replace(/[^\x20-\x7E -ÿ]/g, '');
const clip = (s: string, n: number) => { s = safe(s); return s.length > n ? s.slice(0, n - 1) + '...' : s; };
function hexToRgb(hex: string): RGB { const h = hex.replace('#', ''); const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h; return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : (iso || ''); };

export async function generateReportPDF(rep: ReportPDFData, opts: PDFOpts = {}): Promise<void> {
  await loadJsPDF();
  const { jsPDF } = (window as unknown as { jspdf: { jsPDF: new (o: object) => Doc } }).jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const PW = 595, PH = 842, M = 40, CW = PW - M * 2, RIGHT = PW - M, BOTTOM = PH - 56, TOP = 54;
  const sec = opts.sections || { kpis: true, categories: true, donut: true, income: true, insights: true, topSpending: true, subscriptions: true, investments: true };
  const topN = opts.topN || 8;

  const T = (s: string | string[], x: number, yy: number, o?: { align?: string }) => doc.text(s, x, yy, o);
  const font = (style: 'normal' | 'bold', size: number, c: RGB = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...c); };
  const fillBg = () => { doc.setFillColor(...BG); doc.rect(0, 0, PW, PH, 'F'); doc.setFillColor(...VIOLET); doc.rect(0, 0, PW, 4, 'F'); };
  let y = 0;
  const newPage = () => { doc.addPage(); fillBg(); y = TOP; };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };
  // keep a whole section together: break to a fresh page if it won't fit here but would fit on its own page
  const keepTogether = (h: number) => { if (y + h > BOTTOM && h <= BOTTOM - TOP) newPage(); };
  const panel = (x: number, yy: number, w: number, h: number, fill: RGB = SURF) => { doc.setFillColor(...fill); doc.setDrawColor(...BORDER); doc.setLineWidth(0.8); doc.rect(x, yy, w, h, 'FD'); };
  const sectionHead = (label: string) => { ensure(60); y += 10; font('bold', 13.5, INK); T(label, M, y); doc.setFillColor(...VIOLET); doc.rect(M, y + 7, 26, 2.4, 'F'); y += 24; };
  const tri = (x: number, yy: number, up: boolean, c: RGB) => { doc.setFillColor(...c); if (up) doc.triangle(x, yy - 6.5, x - 3.4, yy - 1, x + 3.4, yy - 1, 'F'); else doc.triangle(x - 3.4, yy - 6.5, x + 3.4, yy - 6.5, x, yy - 1, 'F'); };
  const deltaInfo = (k: Kpi, goodUp: boolean, rate = false) => {
    if (!k.prev && !k.delta) return { up: null as boolean | null, s: 'no prior data', c: FAINT };
    const up = k.delta >= 0, good = up === goodUp;
    const s = (rate ? `${k.delta > 0 ? '+' : ''}${k.delta} pts` : `${k.delta > 0 ? '+' : ''}${money0(k.delta)}`) + (k.pct != null && !rate ? ` (${k.pct > 0 ? '+' : ''}${k.pct}%)` : '');
    return { up, s, c: good ? GREEN : RED };
  };
  // draws a list of rows inside panels, breaking cleanly across pages — no row ever split or clipped
  function drawRowPanels<X>(items: X[], rowH: number, draw: (it: X, top: number, idx: number) => void) {
    const padT = 12, padB = 8; let i = 0;
    while (i < items.length) {
      if (y + padT + rowH + padB > BOTTOM) newPage();
      const canFit = Math.max(1, Math.floor((BOTTOM - y - padT - padB) / rowH));
      const chunk = items.slice(i, i + canFit);
      const rh = padT + chunk.length * rowH + padB;
      panel(M, y, CW, rh);
      chunk.forEach((it, j) => draw(it, y + padT + j * rowH, i + j));
      y += rh + 16; i += chunk.length;
    }
  }

  // ============ header / letterhead ============
  fillBg();
  font('bold', 16, INK); T('Co', M, 44); const ow = doc.getTextWidth('Co');
  font('bold', 16, VIOLETB); T('visor', M + ow + 1, 44);
  font('normal', 9, FAINT); T(`Generated ${new Date().toISOString().slice(0, 10)}`, RIGHT, 42, { align: 'right' });
  doc.setDrawColor(...HAIR); doc.setLineWidth(1); doc.line(M, 58, RIGHT, 58);
  doc.setFillColor(...VIOLET); doc.rect(M, 74, 3, 46, 'F');
  font('bold', 8, VIOLETB); T(`${/^\d{4}$/.test(rep.period.label) ? 'ANNUAL' : 'MONTHLY'} SPENDING REPORT`, M + 14, 85);
  font('bold', 23, INK); T(safe(rep.period.label), M + 14, 110);
  font('normal', 10.5, FAINT); T(`${fmtDate(rep.period.from)}  to  ${fmtDate(rep.period.to)}   -   ${rep.period.days} days   -   ${rep.kpis.count.toLocaleString()} transactions`, M + 14, 127);
  y = 152;

  // ============ KPI cards ============
  if (sec.kpis) {
    const net = rep.kpis.net.value, gain = net >= 0;
    const cards = [
      { label: 'INCOME', val: money0(rep.kpis.income.value), col: GREEN, d: deltaInfo(rep.kpis.income, true) },
      { label: 'SPENDING', val: money0(rep.kpis.spend.value), col: INK, d: deltaInfo(rep.kpis.spend, false) },
      { label: 'NET', val: (net < 0 ? '-' : '') + money0(Math.abs(net)), col: gain ? GREEN : RED, d: deltaInfo(rep.kpis.net, true) },
      { label: 'SAVINGS RATE', val: `${rep.kpis.savingsRate.value}%`, col: INK, d: deltaInfo(rep.kpis.savingsRate, true, true) }
    ];
    const gap = 11, cw = (CW - gap * 3) / 4, ch = 82;
    cards.forEach((c, i) => {
      const x = M + i * (cw + gap);
      panel(x, y, cw, ch);
      font('bold', 7, FAINT); T(c.label, x + 13, y + 21);
      font('bold', 15.5, c.col); T(c.val, x + 13, y + 46);
      let tx = x + 13;
      if (c.d.up !== null) { tri(x + 15, y + 64, c.d.up, c.d.c); tx = x + 22; }
      font('normal', 7.5, c.d.c); T(c.d.s, tx, y + 65);
    });
    y += ch + 24;
  }

  // ============ Spending by Category (donut sub-toggle + bars) ============
  if (sec.categories && rep.categories.length) {
    const cats = rep.categories.slice(0, topN);
    const estDonut = sec.donut ? 198 : 0;
    const estRows = 12 + Math.min(cats.length, 12) * 40 + 8 + 16;
    keepTogether(34 + estDonut + estRows);
    sectionHead('Spending by Category');

    if (sec.donut) {
      const dH = 184; ensure(dH + 14); panel(M, y, CW, dH);
      const restTotal = rep.categories.slice(cats.length).reduce((s, c) => s + c.total, 0);
      // Fold the remainder INTO an existing "Other" so the legend never shows two "Other" rows.
      const slices: Cat[] = cats.map(c => ({ ...c }));
      if (restTotal > 0) {
        const other = slices.find(c => c.name === 'Other');
        if (other) other.total += restTotal;
        else slices.push({ name: 'Other', total: restTotal, share: 0, count: 0, prev: 0, delta: 0 } as Cat);
      }
      const sum = slices.reduce((s, c) => s + c.total, 0) || 1;
      const cx = M + 96, cy = y + dH / 2, R = 70, hole = 44;
      let a0 = -Math.PI / 2;
      for (const sl of slices) {
        const a1 = a0 + (sl.total / sum) * Math.PI * 2; const [r, g, b] = hexToRgb(color(sl.name)); doc.setFillColor(r, g, b);
        const steps = Math.max(2, Math.ceil((a1 - a0) / 0.08));
        for (let k = 0; k < steps; k++) { const s = a0 + (a1 - a0) * (k / steps), e = a0 + (a1 - a0) * ((k + 1) / steps) + 0.012; doc.triangle(cx, cy, cx + R * Math.cos(s), cy + R * Math.sin(s), cx + R * Math.cos(e), cy + R * Math.sin(e), 'F'); }
        a0 = a1;
      }
      doc.setFillColor(...SURF); doc.circle(cx, cy, hole, 'F');
      font('bold', 7, FAINT); T('SPENT', cx, cy - 5, { align: 'center' });
      font('bold', 13, INK); T(money0(rep.kpis.spend.value), cx, cy + 12, { align: 'center' });
      const lx = M + 196; let ly = y + 30; const lend = RIGHT - 16;
      for (const sl of slices.slice(0, 8)) {
        const [r, g, b] = hexToRgb(color(sl.name));
        doc.setFillColor(r, g, b); doc.rect(lx, ly - 8, 8, 8, 'F');
        font('normal', 9.5, INK); T(clip(sl.name, 22), lx + 15, ly - 1);
        font('normal', 9, FAINT); T(`${Math.round((sl.total / sum) * 100)}%`, lend, ly - 1, { align: 'right' });
        font('normal', 9, MUTED); T(money0(sl.total), lend - 44, ly - 1, { align: 'right' });
        ly += 18.5;
      }
      y += dH + 16;
    }

    // category rows: name + amount + share on one line, bar below, delta below — no overlap
    drawRowPanels(cats, 40, (c, top) => {
      const [r, g, b] = hexToRgb(color(c.name));
      doc.setFillColor(r, g, b); doc.rect(M + 16, top + 1, 9, 9, 'F');
      font('bold', 9.5, INK); T(clip(c.name, 28), M + 32, top + 9);
      font('bold', 9.5, INK); T(money(c.total), RIGHT - 16 - 54, top + 9, { align: 'right' });
      font('normal', 9, FAINT); T(`${c.share}%`, RIGHT - 16, top + 9, { align: 'right' });
      doc.setFillColor(...HAIR); doc.rect(M + 16, top + 17, CW - 32, 5, 'F');
      doc.setFillColor(r, g, b); doc.rect(M + 16, top + 17, Math.max(2, (CW - 32) * Math.min(1, c.share / 100)), 5, 'F');
      if (c.delta) { const bad = c.delta > 0; font('normal', 8, bad ? RED : GREEN); T(`${bad ? '+' : '-'}${money0(Math.abs(c.delta))} vs prior`, M + 16, top + 33); }
    });
  }

  // ============ Income (breakdown by source, no chart) ============
  if (sec.income) {
    const srcs = rep.incomeSources.slice(0, topN);
    keepTogether(34 + 12 + Math.min(Math.max(srcs.length, 1), 10) * 26 + 8 + 16);
    sectionHead('Income');
    if (!srcs.length) { font('normal', 9, FAINT); T('No income recorded this period.', M, y + 6); y += 20; }
    else {
      const smax = Math.max(...srcs.map(s => s.total), 1);
      drawRowPanels(srcs, 26, (s, top) => {
        doc.setFillColor(...GREEN); doc.rect(M + 16, top + 1, 9, 9, 'F');
        font('bold', 9.5, INK); T(clip(s.name, 36), M + 32, top + 9);
        font('bold', 9.5, GREEN); T(money(s.total), RIGHT - 16, top + 9, { align: 'right' });
        doc.setFillColor(...HAIR); doc.rect(M + 16, top + 16, CW - 32, 4, 'F');
        doc.setFillColor(...GREEN); doc.rect(M + 16, top + 16, Math.max(2, (CW - 32) * (s.total / smax)), 4, 'F');
      });
    }
  }

  // ============ AI Insights (stat pills + tips + disclaimer) ============
  if (sec.insights && rep.insights.tips.length) {
    const ins = rep.insights;
    const tips = ins.tips.slice(0, 6);
    font('normal', 9, MUTED);
    const tipBlocks = tips.map(t => { const lines = doc.splitTextToSize(safe(t.text), CW - 44); return { t, lines, h: Math.max(48, 32 + lines.length * 12) }; });
    const disclaimer = 'Not financial advice. These observations are generated automatically from your transaction data for informational purposes only. Always consult a qualified financial advisor before making financial decisions.';
    font('normal', 8, FAINT);
    const dl = doc.splitTextToSize(disclaimer, CW - 28); const dh = 12 + dl.length * 11;
    const hasPills = ins.savingsRate > 0 || ins.totalSavePerMonth > 0;
    font('normal', 9, INK);
    const facts = buildFacts(rep, money, money0).slice(0, 6);
    const factBlocks = facts.map(f => { const lines = doc.splitTextToSize(safe(f.text), CW - 28); return { lines, h: 4 + lines.length * 12 }; });
    const factsH = factBlocks.length ? 16 + factBlocks.reduce((s, b) => s + b.h, 0) + 8 : 0;
    const est = 34 + (hasPills ? 66 : 0) + factsH + tipBlocks.reduce((s, b) => s + b.h + 9, 0) + dh + 18;
    keepTogether(est);
    sectionHead('AI Insights');
    if (hasPills) {
      const pills = [
        ins.savingsRate > 0 ? { num: `${ins.savingsRate}%`, lbl: 'savings rate', c: INK } : null,
        ins.totalSavePerMonth > 0 ? { num: money0(ins.totalSavePerMonth), lbl: 'potential savings/mo', c: VIOLETB } : null
      ].filter(Boolean) as { num: string; lbl: string; c: RGB }[];
      const ph = 54, gp = 11, pw = (CW - gp * (pills.length - 1)) / pills.length;
      ensure(ph + 12);
      pills.forEach((p, i) => {
        const x = M + i * (pw + gp); panel(x, y, pw, ph, ACCENT);
        font('bold', 18, p.c); T(p.num, x + pw / 2, y + 28, { align: 'center' });
        font('normal', 8.5, FAINT); T(p.lbl, x + pw / 2, y + 43, { align: 'center' });
      });
      y += ph + 12;
    }
    if (factBlocks.length) {
      ensure(20); font('bold', 9, VIOLETB); T('HIGHLIGHTS', M, y + 8); y += 18;
      facts.forEach((f, i) => {
        const fb = factBlocks[i]; ensure(fb.h + 2);
        doc.setFillColor(...VIOLET); doc.rect(M, y + 2, 5, 5, 'F');
        font('normal', 9, INK); T(fb.lines, M + 12, y + 8);
        y += fb.h;
      });
      y += 8;
    }
    for (const b of tipBlocks) {
      ensure(b.h + 8); panel(M, y, CW, b.h);
      doc.setFillColor(...VIOLET); doc.rect(M, y, 3, b.h, 'F');
      font('bold', 10.5, INK); T(clip(b.t.title, 64), M + 18, y + 22);
      if (b.t.savePerMonth > 0) { font('bold', 9.5, VIOLETB); T(`${money0(b.t.savePerMonth)}/mo`, RIGHT - 14, y + 22, { align: 'right' }); }
      font('normal', 9, MUTED); T(b.lines, M + 18, y + 38);
      y += b.h + 9;
    }
    ensure(dh + 6);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.8); doc.rect(M, y, CW, dh, 'S');
    font('normal', 8, FAINT); T(dl, M + 14, y + 15); y += dh + 18;
  }

  // ============ Top Spending (ranked colored bars) ============
  if (sec.topSpending && rep.biggest.length) {
    const list = rep.biggest.slice(0, topN);
    const max = Math.max(...list.map(b => Math.abs(b.amount)), 1);
    keepTogether(34 + 12 + Math.min(list.length, 12) * 38 + 8 + 16);
    sectionHead('Top Spending');
    drawRowPanels(list, 38, (b, top, idx) => {
      const amt = Math.abs(b.amount); const [r, g, bl] = hexToRgb(color(b.category)); const top3 = idx < 3;
      doc.setFillColor(...(top3 ? VIOLET : HAIR)); doc.rect(M + 14, top, 16, 16, 'F');
      font('bold', 8.5, top3 ? WHITE : FAINT); T(`${idx + 1}`, M + 22, top + 11, { align: 'center' });
      font('bold', 9.5, INK); T(clip(b.name, 40), M + 40, top + 8);
      font('bold', 9.5, INK); T(money(amt), RIGHT - 16, top + 8, { align: 'right' });
      const bw = (RIGHT - 16) - (M + 40);
      doc.setFillColor(...HAIR); doc.rect(M + 40, top + 15, bw, 5, 'F');
      doc.setFillColor(r, g, bl); doc.rect(M + 40, top + 15, Math.max(2, bw * (amt / max)), 5, 'F');
      font('normal', 8, FAINT); T(`${clip(b.category, 30)}${b.count && b.count > 1 ? `  -  x${b.count}` : ''}`, M + 40, top + 29);
    });
  }

  // ============ Subscriptions (per-item cost + monthly/yearly totals) ============
  if (sec.subscriptions && rep.subscriptions.count > 0) {
    const subs = rep.subscriptions;
    keepTogether(34 + 22 + 12 + Math.min(subs.items.length, 12) * 26 + 8 + 16 + 26);
    sectionHead('Subscriptions Detected');
    font('normal', 9.5, MUTED); T(`${subs.count} recurring service${subs.count !== 1 ? 's' : ''}   -   ${money0(subs.monthly)}/mo   -   ${money0(subs.annual)}/yr`, M, y); y += 20;
    drawRowPanels(subs.items, 26, (it, top) => {
      const [r, g, b] = hexToRgb(color(it.name));
      doc.setFillColor(r, g, b); doc.rect(M + 16, top + 1, 9, 9, 'F');
      font('bold', 9.5, INK); T(clip(it.name, 30), M + 32, top + 9);
      font('normal', 8.5, FAINT); T(safe(it.cadence), M + 230, top + 9);
      font('bold', 9.5, INK); T(`${money(it.monthly)}/mo`, RIGHT - 16 - 92, top + 9, { align: 'right' });
      font('normal', 9, MUTED); T(`${money0(it.annual)}/yr`, RIGHT - 16, top + 9, { align: 'right' });
    });
    ensure(24);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.8); doc.line(M, y, RIGHT, y); y += 5;
    font('bold', 9.5, INK); T('Total', M + 16, y + 11);
    font('bold', 9.5, INK); T(`${money(subs.monthly)}/mo`, RIGHT - 16 - 92, y + 11, { align: 'right' });
    font('normal', 9, MUTED); T(`${money0(subs.annual)}/yr`, RIGHT - 16, y + 11, { align: 'right' });
    y += 22;
  }

  // ============ Investments (per-account value + change in value) ============
  if (sec.investments && rep.investments?.hasData) {
    const inv = rep.investments;
    const rows = inv.accounts;
    const pills = [
      { num: money0(inv.totalValue), lbl: 'total value', c: INK },
      inv.totalChange != null ? { num: (inv.totalChange >= 0 ? '+' : '') + money0(inv.totalChange), lbl: 'change this period', c: inv.totalChange >= 0 ? GREEN : RED } : null
    ].filter(Boolean) as { num: string; lbl: string; c: RGB }[];
    keepTogether(34 + 20 + 54 + 14 + 12 + Math.min(rows.length, 10) * 34 + 8 + 16 + 34);
    sectionHead('Investments');
    font('normal', 9.5, MUTED);
    T(`Change in value this period${inv.asOf ? `   -   as of ${fmtDate(inv.asOf)}` : ''}`, M, y); y += 20;
    const ph = 54, gp = 11, pw = (CW - gp * (pills.length - 1)) / pills.length;
    ensure(ph + 12);
    pills.forEach((p, i) => {
      const x = M + i * (pw + gp); panel(x, y, pw, ph, ACCENT);
      font('bold', 18, p.c); T(p.num, x + pw / 2, y + 28, { align: 'center' });
      font('normal', 8.5, FAINT); T(p.lbl, x + pw / 2, y + 43, { align: 'center' });
    });
    y += ph + 14;
    drawRowPanels(rows, 34, (a, top) => {
      const [r, g, b] = hexToRgb(color(a.name));
      doc.setFillColor(r, g, b); doc.rect(M + 16, top + 1, 9, 9, 'F');
      font('bold', 9.5, INK); const nm = clip(a.name, 26); const nmw = doc.getTextWidth(nm); T(nm, M + 32, top + 9);
      font('normal', 8, FAINT); T(`#${safe(a.mask)}`, M + 38 + nmw, top + 9);
      font('bold', 9.5, INK); T(money(a.value), RIGHT - 16, top + 9, { align: 'right' });
      if (a.tracking) {
        font('normal', 8, FAINT); T(`tracking started${a.since ? ` ${fmtDate(a.since)}` : ''} - change shows next period`, M + 16, top + 26);
      } else {
        const up = (a.change || 0) >= 0;
        font('normal', 8, up ? GREEN : RED);
        T(`${up ? '+' : '-'}${money0(Math.abs(a.change || 0))}${a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct}%)` : ''} this period`, M + 16, top + 26);
      }
    });
    const disc = `Balances refresh 3 times a month (1st, 15th, last day)${inv.asOf ? `, values as of ${fmtDate(inv.asOf)}` : ''}. Figures show change in account value, not investment return${inv.contributions > 0 ? `; about ${money0(inv.contributions)} in contributions went to savings or investments this period` : ''}.`;
    font('normal', 8, FAINT);
    const dlines = doc.splitTextToSize(disc, CW - 28); const ddh = 12 + dlines.length * 11;
    ensure(ddh + 6);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.8); doc.rect(M, y, CW, ddh, 'S');
    font('normal', 8, FAINT); T(dlines, M + 14, y + 15); y += ddh + 18;
  }

  // ============ footers ============
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...HAIR); doc.setLineWidth(1); doc.line(M, PH - 34, RIGHT, PH - 34);
    font('normal', 7.5, FAINT);
    T('Generated by Covisor  -  figures reflect the selected time range.  -  Not financial advice.', M, PH - 22);
    T(`Page ${i} of ${pages}`, RIGHT, PH - 22, { align: 'right' });
  }
  doc.save(`covisor-report-${rep.period.from}_to_${rep.period.to}.pdf`);
}
