/**
 * Party payment score (Round 2, R2-A7 — Refrens average payment time / creditworthiness, QBO payment
 * patterns). How a customer usually pays, from bills settled in the last 12 months:
 *
 *   average days late   amount-weighted days from the bill's due date to the day it was fully settled
 *                       (receipts, advance adjustments, TDS and linked credit notes all count as settlement)
 *   on-time %           share of settled bills settled on or before the due date
 *   longest delay       the worst bill
 *   promises            kept / broken promises-to-pay (R2-A4)
 *   trend               the same average over the previous 12 months
 *
 * Grade: A (on time ≥ 80% and on average not late), B (≤ 15 days late), C (≤ 45), D (later). Broken
 * promises outnumbering kept ones (at least 2) or a written-off bill lower the grade by one step. Fewer than 3
 * settled bills → "Not enough history" (no grade). Pure and cheap: one pass over data the receivables screen
 * already loaded; no storage.
 */
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { receivableTotal } from './rcm';
import { isLiveCreditNote, type CreditLinkRow } from './amount-due';
import { idByNameOf, loadCollectionNotes, partyKeyFor, promiseCounts, receiptsByParty, shiftDay, type CollectionNote, type PartyReceipt } from './collections';
import { KEYS, peekTable } from './storage';
import { isoDay, localDayOf } from './dates';

export type PaymentGrade = 'A' | 'B' | 'C' | 'D';

export interface PaymentScore {
  partyKey: string;
  /** Null with fewer than `MIN_BILLS` settled bills. */
  grade: PaymentGrade | null;
  settledBills: number;
  /** Amount-weighted average days late (negative = early). */
  avgDaysLate: number;
  onTimePct: number;
  longestDelay: number;
  promisesKept: number;
  promisesBroken: number;
  writtenOff: number;
  trend: 'better' | 'worse' | 'steady' | null;
  previousAvg: number | null;
  /** Plain-language reasons, most important first. */
  reasons: string[];
}

export const MIN_BILLS = 3;
const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE']);
const DAY = 86400000;
const dayNum = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, dd || 1) / DAY);
};

export interface ScoreInput {
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  links?: readonly CreditLinkRow[];
  clients?: readonly Client[];
  notes?: readonly CollectionNote[];
  receipts?: readonly PartyReceipt[];
}

interface Settled {
  party: string;
  day: string;
  late: number;
  weight: number;
}

/** One pass: every settled sales bill with its settlement day and days late; plus written-off bills per party. */
function settledBills(input: ScoreInput): { settled: Settled[]; writtenOff: Map<string, number> } {
  const idByName = idByNameOf(input.clients ?? []);
  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  const events = new Map<string, { day: string; amount: number }[]>();
  const writeOffs = new Set<string>();
  for (const p of input.payments) {
    if (!p?.invoice_id || !(num(p.amount) > 0)) continue;
    if (p.write_off) {
      writeOffs.add(p.invoice_id);
      continue;
    }
    const list = events.get(p.invoice_id) ?? [];
    list.push({ day: isoDay(p.date), amount: num(p.amount) });
    events.set(p.invoice_id, list);
  }
  for (const l of input.links ?? []) {
    if (l.relation !== 'credit_note') continue;
    const note = byId.get(l.to_id);
    if (!note || !isLiveCreditNote(note)) continue;
    if (note.financial_reason === 'bad_debt') {
      writeOffs.add(l.from_id);
      continue;
    }
    const list = events.get(l.from_id) ?? [];
    list.push({ day: isoDay(note.issue_date), amount: receivableTotal(note) });
    events.set(l.from_id, list);
  }
  const settled: Settled[] = [];
  const writtenOff = new Map<string, number>();
  for (const inv of input.invoices) {
    if (!SALES.has(inv.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const party = partyKeyFor(inv.client, idByName);
    if (writeOffs.has(inv.id)) {
      writtenOff.set(party, (writtenOff.get(party) ?? 0) + 1);
      continue;
    }
    if (inv.status !== 'Paid') continue;
    const total = receivableTotal(inv);
    const tds = Math.min(Math.max(num(inv.tds_amount), 0), total);
    const payable = round2(total - tds);
    const due = isoDay(inv.due_date) || isoDay(inv.issue_date);
    if (!(payable > 0) || !due) continue;
    let acc = 0;
    let day = '';
    for (const e of (events.get(inv.id) ?? []).filter((x) => x.day).sort((a, b) => a.day.localeCompare(b.day))) {
      acc = round2(acc + e.amount);
      if (acc >= payable - 0.005) {
        day = e.day;
        break;
      }
    }
    // Legacy rows marked Paid with no receipt rows: the last change of the record is the best guess.
    if (!day) day = isoDay(inv.updated_at) || isoDay(inv.issue_date);
    if (!day) continue;
    settled.push({ party, day, late: dayNum(day) - dayNum(due), weight: total });
  }
  return { settled, writtenOff };
}

function summarise(rows: readonly Settled[]): { n: number; avg: number; onTime: number; longest: number } {
  const w = rows.reduce((s, r) => s + r.weight, 0);
  const avg = w > 0 ? rows.reduce((s, r) => s + r.late * r.weight, 0) / w : 0;
  return {
    n: rows.length,
    avg: Math.round(avg * 10) / 10,
    onTime: rows.length ? Math.round((rows.filter((r) => r.late <= 0).length / rows.length) * 100) : 0,
    longest: rows.reduce((m, r) => Math.max(m, r.late), 0),
  };
}

const STEP: PaymentGrade[] = ['A', 'B', 'C', 'D'];

/** Grade from the figures (exported for the threshold tests). */
export function gradeFor(avg: number, onTimePct: number): PaymentGrade {
  if (avg <= 0 && onTimePct >= 80) return 'A';
  if (avg <= 15) return 'B';
  if (avg <= 45) return 'C';
  return 'D';
}

/** Scores for every party with sales, keyed by party key (client id, else `name:<lower>`). */
export function paymentScores(input: ScoreInput, today: string): Map<string, PaymentScore> {
  const { settled, writtenOff } = settledBills(input);
  const from = shiftDay(today, -365);
  const prevFrom = shiftDay(today, -730);
  const parties = new Set<string>([...settled.map((s) => s.party), ...writtenOff.keys()]);
  // PERF-2: group once (order kept) instead of filtering every bill / note per party.
  const settledBy = new Map<string, Settled[]>();
  for (const s of settled) {
    const list = settledBy.get(s.party);
    if (list) list.push(s);
    else settledBy.set(s.party, [s]);
  }
  const notesBy = new Map<string, CollectionNote[]>();
  for (const n of input.notes ?? []) {
    const list = notesBy.get(n.party_key);
    if (list) list.push(n);
    else notesBy.set(n.party_key, [n]);
  }
  const out = new Map<string, PaymentScore>();
  for (const party of parties) {
    const mine = settledBy.get(party) ?? [];
    const cur = summarise(mine.filter((s) => s.day > from && s.day <= today));
    const prev = summarise(mine.filter((s) => s.day > prevFrom && s.day <= from));
    const { kept, broken } = promiseCounts(party, notesBy.get(party) ?? [], input.receipts ?? [], today, from);
    const wo = writtenOff.get(party) ?? 0;
    const reasons: string[] = [];
    let grade: PaymentGrade | null = null;
    if (cur.n >= MIN_BILLS) {
      let g = STEP.indexOf(gradeFor(cur.avg, cur.onTime));
      if (cur.avg > 0) reasons.push(`pays ${cur.avg} days late on average`);
      else reasons.push(cur.avg < 0 ? `pays ${Math.abs(cur.avg)} days early on average` : 'pays on the due date on average');
      reasons.push(`${cur.onTime}% of ${cur.n} bills on time`);
      if (cur.longest > 0) reasons.push(`longest delay ${cur.longest} days`);
      if (broken >= 2 && broken > kept) {
        g = Math.min(g + 1, 3);
        reasons.push(`${broken} broken promises`);
      } else if (kept + broken > 0) reasons.push(`${kept} of ${kept + broken} promises kept`);
      if (wo > 0) {
        g = Math.min(g + 1, 3);
        reasons.push(`${wo} bill${wo === 1 ? '' : 's'} written off`);
      }
      grade = STEP[g];
    } else {
      reasons.push('Not enough history');
    }
    const trend = cur.n >= MIN_BILLS && prev.n >= MIN_BILLS ? (cur.avg < prev.avg - 3 ? 'better' : cur.avg > prev.avg + 3 ? 'worse' : 'steady') : null;
    out.set(party, {
      partyKey: party, grade, settledBills: cur.n, avgDaysLate: cur.avg, onTimePct: cur.onTime, longestDelay: cur.longest,
      promisesKept: kept, promisesBroken: broken, writtenOff: wo, trend, previousAvg: prev.n >= MIN_BILLS ? prev.avg : null, reasons,
    });
  }
  return out;
}

/** One party's score (null when it has no sales at all). */
export function paymentScore(partyKey: string, input: ScoreInput, today: string): PaymentScore | null {
  return paymentScores(input, today).get(partyKey) ?? null;
}

/** "B · pays 6 days late on average · 80% of 5 bills on time" — tooltip text. */
export function scoreSummary(s: PaymentScore): string {
  return [s.grade ?? '-', ...s.reasons, s.trend ? `trend ${s.trend}` : ''].filter(Boolean).join(' · ');
}

/**
 * `gradeOf` for `pendingReminders` (R2-A7): reads receipts, links, clients and follow-ups once (storage, inside
 * the call) and grades each invoice's party.
 */
export function gradeLookup(invoices: readonly InvoiceRecord[], today: Date = new Date()): (inv: InvoiceRecord) => PaymentGrade | null {
  const clients = peekTable<Client>(KEYS.clients);
  const payments = peekTable<Payment>(KEYS.transactions);
  const notes = loadCollectionNotes();
  const scores = paymentScores(
    { invoices, payments, links: peekTable<CreditLinkRow>('doc_links'), clients, notes, receipts: notes.length ? receiptsByParty(invoices, payments, clients) : [] },
    localDayOf(today),
  );
  const idByName = idByNameOf(clients);
  return (inv) => scores.get(partyKeyFor(inv.client, idByName))?.grade ?? null;
}
