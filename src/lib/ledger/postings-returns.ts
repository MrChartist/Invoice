/**
 * Ledger postings for purchase returns / supplier notes (WP-3, P0-5). Called once from
 * `buildLedger` (postings.ts); the vouchers it returns go through the same balance / account checks.
 *
 *   Debit note / supplier credit note (Tally "Debit Note"):
 *     Dr Sundry creditors (party)  — the note total less self-assessed GST (less TDS reversed, 7O)
 *     Dr TDS payable (section)     — TDS reversed when the bill had TDS deducted at booking (7O)
 *     Cr Purchase returns (5010)   — taxable value (+ GST when the bill's ITC was not claimed);
 *                                    a note on an expense bill credits that expense account instead
 *     Cr Input CGST / SGST / IGST  — the ITC given back (only when the bill claimed ITC)
 *     Dr GST payable — reverse charge / IGST payable on imports — the self-assessed GST reversed
 *     ± Round off
 *
 * Pure: no storage. Working papers — verify with your CA.
 */

import type { PurchaseReturn } from '../../types/purchases';
import { toPaise } from '../export-shared';
import { num } from '../invoice-calc';
import { isLiveNote, noteSelfTax, noteTdsReversed } from '../purchase-returns-gst';
import { A, EXPENSE_CATEGORY_ACCOUNTS, groupOf, tdsAccountFor, type Account } from './accounts';
import type { LedgerVoucher, PostingLine } from './postings';

/** The account the bill's cost went to: same rule as `expenseAccountFor` in postings.ts; goods → Purchase returns. */
function costAccountFor(n: PurchaseReturn, chart: readonly Account[]): string {
  const isExpense = n.bill_kind === 'EXPENSE';
  const cat = String(n.category ?? '').trim().toLowerCase();
  const own = cat ? chart.find((a) => !a.system && a.name.toLowerCase() === cat) : undefined;
  if (own) {
    const g = groupOf(own.group);
    if (g.nature === 'expense' && !!g.direct === !isExpense) return own.id;
  }
  if (!isExpense) return A.purchaseReturns;
  return EXPENSE_CATEGORY_ACCOUNTS[cat] ?? A.otherExp;
}

function line(account: string, paise: number, debit: boolean, party?: string, costCentre?: string): PostingLine | null {
  const p = Math.round(paise);
  if (p === 0) return null;
  const isDr = p > 0 ? debit : !debit;
  return { account, dr: isDr ? Math.abs(p) : 0, cr: isDr ? 0 : Math.abs(p), ...(party ? { party } : {}), ...(costCentre ? { cost_centre: costCentre } : {}) };
}

/** One Debit Note voucher per purchase return / supplier credit note. */
export function purchaseReturnPostings(notes: readonly PurchaseReturn[] | undefined, chart: readonly Account[]): LedgerVoucher[] {
  const out: LedgerVoucher[] = [];
  for (const n of notes ?? []) {
    if (!isLiveNote(n)) continue;
    const total = toPaise(num(n.total));
    const taxable = toPaise(num(n.taxable));
    const cgst = toPaise(num(n.cgst));
    const sgst = toPaise(num(n.sgst));
    const igst = toPaise(num(n.igst));
    const gst = cgst + sgst + igst;
    const party = String(n.vendor_name ?? '').trim() || 'Unknown vendor';
    const cc = n.cost_centre_id || undefined;
    const self = noteSelfTax(n) > 0 ? gst : 0;
    // 7O (7.94): TDS deducted at booking on the bill comes back off the TDS payable, not the supplier.
    const tds = Math.min(toPaise(noteTdsReversed(n)), Math.max(total - self, 0));
    const lines: (PostingLine | null)[] = [
      line(A.creditors, total - self - tds, true, party, cc),
      line(tdsAccountFor(n.tds_section), tds, true, undefined, cc),
      line(costAccountFor(n, chart), n.itc_eligible ? taxable : taxable + gst, false, undefined, cc),
    ];
    if (n.itc_eligible) lines.push(line(A.inCgst, cgst, false, undefined, cc), line(A.inSgst, sgst, false, undefined, cc), line(A.inIgst, igst, false, undefined, cc));
    if (self) lines.push(line(n.import_type === 'GOODS' ? A.importIgst : A.rcmPayable, self, true, undefined, cc));
    const posted = lines.filter((l): l is PostingLine => !!l);
    const diff = posted.reduce((s, l) => s + l.dr - l.cr, 0);
    const ro = line(A.roundOff, -diff, true, undefined, cc);
    if (ro) posted.push(ro);
    out.push({
      id: `pdn:${n.id}`,
      source: 'auto',
      kind: 'Debit Note',
      date: n.date,
      number: n.note_number,
      party,
      narration: [
        n.kind === 'SUPPLIER_CN' ? `Supplier credit note ${n.supplier_note_number ?? ''}`.trim() : 'Debit note (purchase side)',
        n.bill_number && `against bill ${n.bill_number}`,
        n.goods_returned ? 'goods returned' : 'value only',
        gst > 0 && !n.itc_eligible && 'ITC was not claimed',
      ].filter(Boolean).join(' · '),
      lines: posted,
      link: '/expenses?tab=returns',
    });
  }
  return out;
}
