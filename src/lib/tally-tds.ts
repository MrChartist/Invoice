/**
 * Tally export of TDS / TCS challans (ROADMAP 7.49). A fragment for `tally-xml.ts` (one call line in its
 * books block), rendered by the same `voucherXml`:
 *
 *   ITNS 281 challan  Payment: Dr TDS Payable <section> for each linked deduction (TCS payable for TCS),
 *                     the unlinked rest to TDS / TCS payable, interest / fee / others to "Interest & fees
 *                     on TDS / TCS" | Cr bank / cash. Number `<BSR>/<challan serial>`.
 *
 * The lines are exactly what the ledger posts (`postings.ts` challanVoucher), taken from `loadLedger()`
 * by `withTdsChallans` when the Export Center builds its source, so Books and Tally agree. Pure below
 * the loader. Working papers — verify with your CA before importing into Tally.
 */
import { inRange } from './export-shared';
import { ledgerResolver, type BooksLedgerNames, type RegisterBooksLedger, type TallyBooksSource } from './tally-books';
import type { TallyEntry, TallyVoucher } from './tally-xml';

/** A challan's ledger voucher (subset of `LedgerVoucher`). */
export interface ChallanPosting {
  id: string;
  date: string;
  number: string;
  narration: string;
  lines: Array<{ account: string; dr: number; cr: number }>;
}

type WithChallans = TallyBooksSource & { tdsChallanPostings?: ChallanPosting[] };

/** Add the challan postings to an Export Center books source (reads the ledger; lazy-load friendly). */
export async function withTdsChallans(src: TallyBooksSource): Promise<TallyBooksSource> {
  try {
    const { loadLedger } = await import('./ledger/index');
    const postings = loadLedger().vouchers.filter((v) => v.id.startsWith('tdsch:')).map((v) => ({ id: v.id, date: v.date, number: v.number, narration: v.narration, lines: v.lines.map((l) => ({ account: l.account, dr: l.dr, cr: l.cr })) }));
    return Object.assign({}, src, { tdsChallanPostings: postings });
  } catch {
    return src;
  }
}

/** Payment vouchers for the challans dated in `o.range`; registers the ledgers they use. */
export function tdsChallanTallyVouchers(src: TallyBooksSource, o: BooksLedgerNames, addLedger: RegisterBooksLedger): TallyVoucher[] {
  const postings = (src as WithChallans).tdsChallanPostings ?? [];
  if (!postings.length) return [];
  const resolve = ledgerResolver(src, o, addLedger);
  const out: TallyVoucher[] = [];
  for (const p of postings) {
    if (!inRange(p.date, o.range)) continue;
    const byKey = new Map<string, TallyEntry>();
    for (const l of p.lines) {
      const side = l.dr > 0 ? 'Dr' : 'Cr';
      const paise = l.dr > 0 ? l.dr : l.cr;
      if (!(paise > 0)) continue;
      const ledger = resolve(l.account);
      const key = `${ledger}|${side}`;
      const cur = byKey.get(key) ?? { ledger, side, paise: 0 };
      cur.paise += paise;
      byKey.set(key, cur);
    }
    const entries = [...byKey.values()].sort((a, b) => (a.side === b.side ? a.ledger.localeCompare(b.ledger) : a.side === 'Dr' ? -1 : 1));
    if (entries.length < 2) continue;
    out.push({ type: 'Payment', date: p.date, number: p.number, party: '', partyGstin: '', stateName: '', narration: `${p.narration} (verify with your CA)`, reference: p.number, entries, inventory: [], inventoryLedger: '' });
  }
  return out;
}
