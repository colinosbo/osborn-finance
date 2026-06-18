// CSV parsing engine — ported from the client app (FR2.x), server-side.
export function parseCSV(text: string): string[][] {
  text = String(text).replace(/^﻿/, '');
  const head = text.slice(0, 4000).split('\n').slice(0, 5).join('\n');
  let best = ',', bestC = 0;
  for (const d of [',', ';', '\t', '|']) {
    const c = head.split(d).length - 1;
    if (c > bestC) { bestC = c; best = d; }
  }
  const rows: string[][] = []; let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === best) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || (row[0] || '').trim() !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || (row[0] || '').trim() !== '') rows.push(row); }
  return rows;
}

const MN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function parseDateStr(s: string): string | null {
  s = String(s || '').trim();
  if (!s) return null;
  const iso = (y: number, mo: number, d: number) => (mo < 1 || mo > 12 || d < 1 || d > 31) ? null : `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    return (a > 12 && b <= 12) ? iso(y, b, a) : iso(y, a, b);
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mi = MN.indexOf(m[1].toLowerCase().slice(0, 3));
    if (mi >= 0) return iso(+m[3], mi + 1, +m[2]);
  }
  return null;
}
export function parseAmtStr(s: unknown): number | null {
  if (s === undefined || s === null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[$,\s]/g, '');
  if (!/^[+\-]?\d*\.?\d+$/.test(t)) return null;
  const v = parseFloat(t);
  return isNaN(v) ? null : (neg ? -v : v);
}

// Some banks export a single always-positive amount plus a separate word column
// giving the direction ("Debit"/"Credit", "Withdrawal"/"Deposit"). Map that word
// to a sign so debits import as expenses (negative) and credits as income.
// Anchored to whole words: "ACH Debit" still reads as a debit, but a stray "Dr"
// in an address or description never flips a sign.
export function debitCreditSign(v: unknown): -1 | 0 | 1 {
  const t = String(v ?? '').toLowerCase();
  if (/\b(debit|withdrawal|withdraw)\b/.test(t)) return -1;
  if (/\b(credit|deposit)\b/.test(t)) return 1;
  return 0;
}

export interface ColMap { headers: string[]; date: number; desc: number; amt: number; debit: number; credit: number; bal: number; dir: number; acct: number; }
export function autoMap(rows: string[][]): ColMap {
  const headers = rows[0].map(h => String(h || '').trim());
  const data = rows.slice(1, 21);
  const score = { date: [] as number[], desc: [] as number[], amt: [] as number[], bal: [] as number[], debit: [] as number[], credit: [] as number[], dir: [] as number[], acct: [] as number[] };
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c].toLowerCase();
    let dateS = 0, amtS = 0, descS = 0, balS = 0, debS = 0, credS = 0, dirS = 0, acctS = 0;
    if (/date|posted/.test(h)) dateS += 3;
    if (/amount|\bamt\b/.test(h)) amtS += 3;
    if (/balance|running/.test(h)) balS += 4;
    if (/desc|memo|payee|detail|narrat|transaction\b|name/.test(h)) descS += 3;
    if (/debit|withdraw/.test(h)) debS += 4;
    if (/credit|deposit/.test(h) && !/card/.test(h)) credS += 4;
    if (/\btype\b|debit.{0,3}credit|cr.?dr/.test(h)) dirS += 2;
    // Which of the user's accounts a row belongs to (header-driven; the values are
    // free text like "Checking (0114)" so content can't reliably distinguish it
    // from the description). Avoid "account number" columns.
    if (/\baccount\b|\bacct\b/.test(h) && !/number|num\b|no\.?$|#/.test(h)) acctS += 5;
    let dateHit = 0, numHit = 0, negHit = 0, lenSum = 0, filled = 0, dirHit = 0;
    for (const r of data) {
      const v = r[c];
      if (v === undefined || String(v).trim() === '') continue;
      filled++;
      if (parseDateStr(v)) dateHit++;
      const a = parseAmtStr(v);
      if (a !== null) { numHit++; if (a < 0) negHit++; }
      // A direction column is one whose values are the words debit/credit/etc.
      // (not numbers, not dates); that lets us sign a positive-only amount.
      if (a === null && debitCreditSign(v) !== 0) dirHit++;
      lenSum += String(v).length;
    }
    if (filled) {
      dateS += (dateHit / filled) * 5;
      const nf = numHit / filled;
      amtS += nf * 2 + (negHit > 0 ? 1.5 : 0);
      balS += nf * 1.5; debS += nf; credS += nf;
      dirS += (dirHit / filled) * 5;
      if (dateHit / filled > .6) { amtS = 0; balS = 0; debS = 0; credS = 0; descS = 0; }
      descS += Math.min(3, lenSum / filled / 12);
    }
    score.date.push(dateS); score.desc.push(descS); score.amt.push(amtS);
    score.bal.push(balS); score.debit.push(debS); score.credit.push(credS); score.dir.push(dirS); score.acct.push(acctS);
  }
  const best = (arr: number[], excl: number[], min: number) => {
    let bi = -1, bv = min;
    arr.forEach((v, i) => { if (!excl.includes(i) && v > bv) { bv = v; bi = i; } });
    return bi;
  };
  const date = best(score.date, [], 3);
  const bal = best(score.bal, [date], 3.5);
  // A direction column (>60% debit/credit words) means the amount is positive-only
  // and the sign lives elsewhere; detect it before deciding how to read amounts.
  const dir = best(score.dir, [date, bal], 3);
  const acct = best(score.acct, [date, bal, dir], 3);
  let amt = best(score.amt, [date, bal, dir, acct], 2);
  // With a direction column present the amount column can be all-positive, so it
  // may not clear the usual threshold; recover the strongest numeric column.
  if (amt < 0 && dir >= 0) amt = best(score.amt, [date, bal, dir, acct], 1);
  const desc = best(score.desc, [date, bal, amt, dir, acct], 1);
  let debit = -1, credit = -1;
  // Only look for separate debit/credit AMOUNT columns when there's neither a
  // single signed amount column nor a direction column to sign a positive amount.
  if (amt < 0 && dir < 0) {
    debit = best(score.debit, [date, bal, desc], 3.5);
    credit = best(score.credit, [date, bal, desc, debit], 3.5);
  }
  return { headers, date, desc, amt, debit, credit, bal, dir, acct };
}
