/**
 * Opening-balance postings (WP-1). Called once from `buildLedger` (postings.ts, hot-file protocol:
 * one line), BEFORE the Books cash/bank opening loop so that loop still makes the cash/bank
 * balance at its own `as_of` equal what was typed there.
 *
 * One "Opening" voucher dated the day before the books-beginning date:
 *   each ledger opening      Dr / Cr the account (party lines on Debtors / Creditors with the party)
 *   parties with bills only  the bill total (Tally: bill-wise breakup = the opening balance)
 *   residual                 Opening balance difference (1090) — Tally's "Difference in opening
 *                            balances", never silently dropped; `openingVoucherDifference` reports it.
 * Pure. Working papers — verify with your CA.
 */

import type { Client } from '../../types/invoice';
import { round2 } from '../invoice-calc';
import type { OpeningBill } from '../opening-bills';
import { A, type Account } from './accounts';
import { clientPartyName, parsePartyLedgerId } from './groups';
import type { LedgerOpening } from './openings';
import type { LedgerInput, LedgerVoucher, PostingLine } from './postings';

/** Additive inputs (all optional so older callers and fixtures stay valid). */
export interface OpeningsInput {
  ledgerOpenings?: LedgerOpening[];
  openingBills?: OpeningBill[];
  booksBegin?: string;
  clients?: Client[];
}

export function dayBefore(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) - 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const toPaise = (rupees: number) => Math.round(round2(rupees) * 100);

interface Entry {
  account: string;
  party?: string;
  /** Debit-positive paise. */
  amount: number;
}

/** Effective opening entries: typed openings, plus bill totals for parties with bills and no typed opening. */
export function openingEntries(input: OpeningsInput & Pick<LedgerInput, 'vendors'>, warnings: string[] = []): Entry[] {
  const out: Entry[] = [];
  const clients = new Map((input.clients ?? []).filter((c) => c?.id).map((c) => [c.id!, c]));
  const vendors = new Map((input.vendors ?? []).filter((v) => typeof v?.id === 'string').map((v) => [String(v.id), v]));
  const typedParties = new Set<string>();
  const nameOf = (side: 'debtor' | 'creditor', id: string, snapshot?: string) => {
    if (side === 'debtor') {
      const c = clients.get(id);
      return (c ? clientPartyName(c) : '') || snapshot || '';
    }
    const v = vendors.get(id);
    return (typeof v?.name === 'string' ? v.name.trim() : '') || snapshot || '';
  };
  for (const o of input.ledgerOpenings ?? []) {
    const amount = o.dr - o.cr;
    if (!amount) continue;
    const party = parsePartyLedgerId(o.ledger_id);
    if (party) {
      typedParties.add(o.ledger_id);
      const name = nameOf(party.side, party.id, o.party_name);
      if (!name) {
        warnings.push(`An opening balance belongs to a party that no longer exists (${o.ledger_id}); it was left out.`);
        continue;
      }
      out.push({ account: party.side === 'debtor' ? A.debtors : A.creditors, party: name, amount });
    } else {
      out.push({ account: o.ledger_id, amount });
    }
  }
  // Parties with opening bills but no typed opening: the bill total is the opening.
  const billTotals = new Map<string, { side: 'debtor' | 'creditor'; id: string; name: string; total: number }>();
  for (const b of input.openingBills ?? []) {
    if (!b.party_id) continue;
    const side = b.side === 'payable' ? 'creditor' : 'debtor';
    const key = `party:${side}:${b.party_id}`;
    if (typedParties.has(key)) continue;
    const cur = billTotals.get(key) ?? { side, id: b.party_id, name: b.party_name, total: 0 };
    cur.total += (b.dr_cr === 'Dr' ? 1 : -1) * toPaise(b.amount);
    billTotals.set(key, cur);
  }
  for (const t of billTotals.values()) {
    if (!t.total) continue;
    out.push({ account: t.side === 'debtor' ? A.debtors : A.creditors, party: nameOf(t.side, t.id, t.name) || t.name, amount: t.total });
  }
  return out;
}

/** The ledger's opening voucher(s) — at most one, dated the day before the books begin. */
export function openingVouchers(input: LedgerInput & OpeningsInput, byId: Map<string, Account>, warnings: string[] = []): LedgerVoucher[] {
  const begin = input.booksBegin;
  if (!begin || !/^\d{4}-\d{2}-\d{2}$/.test(begin)) return [];
  const lines: PostingLine[] = [];
  let diff = 0;
  for (const e of openingEntries(input, warnings)) {
    if (!byId.has(e.account)) {
      warnings.push(`An opening balance names an unknown account (${e.account}); it was left out.`);
      continue;
    }
    const amt = Math.abs(e.amount);
    lines.push({ account: e.account, dr: e.amount > 0 ? amt : 0, cr: e.amount < 0 ? amt : 0, ...(e.party ? { party: e.party } : {}) });
    diff += e.amount;
  }
  if (!lines.length) return [];
  if (diff) lines.push({ account: A.openingDiff, dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 });
  return [
    {
      id: `obal:${begin}`,
      source: 'auto',
      kind: 'Opening',
      date: dayBefore(begin),
      number: 'OPENING',
      party: '',
      narration: `Opening balances as at ${begin}${diff ? ` · difference in opening balances ${(Math.abs(diff) / 100).toFixed(2)} ${diff > 0 ? 'Dr' : 'Cr'} carried to Opening balance difference` : ''}`,
      lines,
      link: '/books?tab=coa&m=opening-tb',
    },
  ];
}

/** Difference in opening balances carried by the opening voucher (debit-positive paise of the openings). */
export function openingVoucherDifference(v: Pick<LedgerVoucher, 'lines'> | undefined): number {
  if (!v) return 0;
  const l = v.lines.find((x) => x.account === A.openingDiff);
  return l ? l.cr - l.dr : 0;
}
