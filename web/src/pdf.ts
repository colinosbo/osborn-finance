// Custom report PDF — vector-drawn with jsPDF, styled to the app's dark violet
// aesthetic. jsPDF loads on demand from CDN (its bundle drags in core-js
// internals Vite can't resolve), with fallback mirrors.
import { color } from './api';

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
  subscriptions: { count: number; names: string[]; monthly: number };
  insights: { tips: Tip[]; totalSavePerMonth: number; savingsRate: number };
}
export interface PDFSections { kpis: boolean; trend: boolean; categories: boolean; insights: boolean; merchants: boolean; notable: boolean }
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

const BG: RGB = [18, 14, 29], SURF: RGB = [26, 20, 39], BORDER: RGB = [50, 42, 74], HAIR: RGB = [42, 35, 64];
const INK: RGB = [236, 232, 246], MUTED: RGB = [168, 159, 196], FAINT: RGB = [125, 117, 150];
const VIOLET: RGB = [139, 92, 246], VIOLETB: RGB = [167, 139, 250], GREEN: RGB = [58, 208, 127], RED: RGB = [255, 107, 107];
const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
// keep only glyphs the standard PDF font can render (ASCII + Latin-1)
const safe = (s: string) => (s || '').replace(/[^\x20-\x7E -ÿ]/g, '');
const clip = (s: string, n: number) => { s = safe(s); return s.length > n ? s.slice(0, n - 1) + '...' : s; };
function hexToRgb(hex: string): RGB { const h = hex.replace('#', ''); const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h; return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; }

export async function generateReportPDF(rep: ReportPDFData, opts: PDFOpts = {}): Promise<void> {
  await loadJsPDF();
  const { jsPDF } = (window as unknown as { jspdf: { jsPDF: new (o: object) => Doc } }).jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const PW = 595, PH = 842, M = 40, CW = PW - M * 2, RIGHT = PW - M;
  const sec = opts.sections || { kpis: true, trend: true, categories: true, insights: true, merchants: true, notable: true };
  const topN = opts.topN || 8;

  const T = (s: string | string[], x: number, yy: number, o?: { align?: string }) => doc.text(s, x, yy, o);
  const font = (style: 'normal' | 'bold', size: number, c: RGB = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...c); };
  const fillBg = () => { doc.setFillColor(...BG); doc.rect(0, 0, PW, PH, 'F'); doc.setFillColor(...VIOLET); doc.rect(0, 0, PW, 5, 'F'); };
  let y = 0;
  const newPage = () => { doc.addPage(); fillBg(); y = 52; };
  const ensure = (h: number) => { if (y + h > PH - 52) newPage(); };
  const panel = (x: number, yy: number, w: number, h: number) => { doc.setFillColor(...SURF); doc.setDrawColor(...BORDER); doc.setLineWidth(0.8); doc.roundedRect(x, yy, w, h, 5, 5, 'FD'); };
  const sectionHead = (label: string) => { ensure(78); y += 6; font('bold', 13, INK); T(label, M, y); doc.setDrawColor(...VIOLET); doc.setLineWidth(2.4); doc.line(M, y + 7, M + 28, y + 7); y += 24; };
  // small filled up/down triangle at (x baseline yy)
  const tri = (x: number, yy: number, up: boolean, c: RGB) => { doc.setFillColor(...c); if (up) doc.triangle(x, yy - 6.5, x - 3.4, yy - 1, x + 3.4, yy - 1, 'F'); else doc.triangle(x - 3.4, yy - 6.5, x + 3.4, yy - 6.5, x, yy - 1, 'F'); };
  const deltaInfo = (k: Kpi, goodUp: boolean, rate = false) => {
    if (!k.prev && !k.delta) return { up: null as boolean | null, s: 'no prior data', c: FAINT };
    const up = k.delta >= 0, good = up === goodUp;
    const s = (rate ? `${k.delta > 0 ? '+' : ''}${k.delta} pts` : `${k.delta > 0 ? '+' : ''}${money0(k.delta)}`) + (k.pct != null && !rate ? ` (${k.pct > 0 ? '+' : ''}${k.pct}%)` : '');
    return { up, s, c: good ? GREEN : RED };
  };

  // ---------- header ----------
  fillBg();
  font('bold', 19, INK); T('Osborn', M, 48); const ow = doc.getTextWidth('Osborn');
  font('bold', 19, VIOLETB); T('Finance', M + ow + 5, 48); const fw = doc.getTextWidth('Finance');
  font('normal', 10.5, MUTED); T('Spending Report', M + ow + fw + 16, 48);
  font('normal', 9, FAINT); T(`Generated ${new Date().toISOString().slice(0, 10)}`, RIGHT, 44, { align: 'right' });
  doc.setDrawColor(...HAIR); doc.setLineWidth(1); doc.line(M, 64, RIGHT, 64);

  // ---------- period hero (big + clear) ----------
  font('bold', 22, INK); T(safe(rep.period.label), M, 98);
  font('normal', 11, FAINT); T(`${rep.period.days}-day report  ·  ${rep.period.from} to ${rep.period.to}`, M, 118);
  y = 142;

  // ---------- KPI cards ----------
  if (sec.kpis) {
    const net = rep.kpis.net.value, gain = net >= 0;
    const cards = [
      { label: 'TOTAL INCOME', val: money0(rep.kpis.income.value), col: GREEN, d: deltaInfo(rep.kpis.income, true) },
      { label: 'TOTAL EXPENSES', val: money0(rep.kpis.spend.value), col: INK, d: deltaInfo(rep.kpis.spend, false) },
      { label: gain ? 'NET GAIN' : 'NET LOSS', val: money0(Math.abs(net)), col: gain ? GREEN : RED, d: deltaInfo(rep.kpis.net, true) },
      { label: 'SAVINGS RATE', val: `${rep.kpis.savingsRate.value}%`, col: VIOLETB, d: deltaInfo(rep.kpis.savingsRate, true, true) }
    ];
    const gap = 11, cw = (CW - gap * 3) / 4, ch = 80;
    cards.forEach((c, i) => {
      const x = M + i * (cw + gap);
      panel(x, y, cw, ch);
      font('bold', 7, FAINT); T(c.label, x + 13, y + 21);
      font('bold', 15, c.col); T(c.val, x + 13, y + 45);
      let tx = x + 14;
      if (c.d.up !== null) { tri(x + 15, y + 63, c.d.up, c.d.c); tx = x + 22; }
      font('normal', 7.5, c.d.c); T(c.d.s, tx, y + 64);
    });
    y += ch + 14;
    font('normal', 9, FAINT); T(`${rep.kpis.count.toLocaleString()} transactions in this period`, M, y); y += 22;
  }

  // ---------- expenses donut + legend ----------
  if (sec.categories && rep.categories.length) {
    sectionHead('Expenses by category');
    const top = rep.categories.slice(0, Math.max(topN, 6));
    const restTotal = rep.categories.slice(top.length).reduce((s, c) => s + c.total, 0);
    const slices = restTotal > 0 ? [...top, { name: 'Other', total: restTotal, share: 0, count: 0, prev: 0, delta: 0 } as Cat] : [...top];
    const sum = slices.reduce((s, c) => s + c.total, 0) || 1;
    const rows = Math.min(slices.length, 8);
    const ch = Math.max(200, 36 + rows * 19);
    ensure(ch + 6); panel(M, y, CW, ch);
    const cx = M + 100, cy = y + ch / 2, R = 72, hole = 45;
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
    const lx = M + 204, lw = RIGHT - 16 - lx; let ly = y + 32;
    for (const sl of slices.slice(0, 8)) {
      const [r, g, b] = hexToRgb(color(sl.name)); const share = sl.total / sum;
      doc.setFillColor(r, g, b); doc.roundedRect(lx, ly - 9, 9, 9, 1.5, 1.5, 'F');
      font('normal', 9.5, INK); T(clip(sl.name, 22), lx + 16, ly - 1);
      font('normal', 9, MUTED); T(money0(sl.total), RIGHT - 16 - 46, ly - 1, { align: 'right' });
      font('normal', 9, FAINT); T(`${Math.round(share * 100)}%`, RIGHT - 16, ly - 1, { align: 'right' });
      doc.setFillColor(...HAIR); doc.roundedRect(lx + 16, ly + 4, lw - 16, 4, 2, 2, 'F');
      doc.setFillColor(r, g, b); doc.roundedRect(lx + 16, ly + 4, Math.max(2, (lw - 16) * Math.min(1, share)), 4, 2, 2, 'F');
      ly += 19;
    }
    y += ch + 16;
  }

  // ---------- insights (accent bar, no glyphs) ----------
  if (sec.insights && rep.insights.tips.length) {
    sectionHead('Insights');
    for (const t of rep.insights.tips.slice(0, 6)) {
      const lines = doc.splitTextToSize(safe(t.text), CW - 44);
      const rh = Math.max(46, 30 + lines.length * 12);
      ensure(rh + 8); panel(M, y, CW, rh);
      doc.setFillColor(...VIOLET); doc.roundedRect(M, y + 8, 4, rh - 16, 2, 2, 'F');
      font('bold', 10.5, INK); T(clip(t.title, 70), M + 18, y + 22);
      if (t.savePerMonth > 0) { font('bold', 9, VIOLETB); T(`${money0(t.savePerMonth)}/mo`, RIGHT - 14, y + 22, { align: 'right' }); }
      font('normal', 9, MUTED); T(lines, M + 18, y + 38);
      y += rh + 9;
    }
  }

  // ---------- top merchants ----------
  if (sec.merchants && rep.merchants.length) {
    sectionHead('Top merchants');
    const list = rep.merchants.slice(0, topN); const ch = 32 + list.length * 19; ensure(ch); panel(M, y, CW, ch);
    let ry = y + 24; const px = M + 16;
    font('bold', 7, FAINT); T('MERCHANT', px, ry - 6); T('TXNS', RIGHT - 16 - 96, ry - 6, { align: 'right' }); T('SPENT', RIGHT - 16, ry - 6, { align: 'right' });
    doc.setDrawColor(...HAIR); doc.line(px, ry, RIGHT - 16, ry); ry += 17;
    for (const m of list) {
      font('normal', 9.5, INK); T(clip(m.name, 44), px, ry);
      font('normal', 9.5, FAINT); T(`${m.count}`, RIGHT - 16 - 96, ry, { align: 'right' });
      font('normal', 9.5, INK); T(money(m.total), RIGHT - 16, ry, { align: 'right' });
      ry += 19;
    }
    y += ch + 16;
  }

  // ---------- footers ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...HAIR); doc.setLineWidth(1); doc.line(M, PH - 34, RIGHT, PH - 34);
    font('normal', 7.5, FAINT);
    T('Generated by Osborn Finance  -  figures reflect the selected time range.', M, PH - 22);
    T(`Page ${i} of ${pages}`, RIGHT, PH - 22, { align: 'right' });
  }
  doc.save(`osborn-report-${rep.period.days}d-${rep.period.to}.pdf`);
}
