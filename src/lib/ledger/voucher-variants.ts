/**
 * Voucher variants (Tally parity) on the manual vouchers of `vouchers.ts`:
 *
 *  - Optional    — saved but kept OUT of the books (trial balance, statements) until the user makes
 *                  it regular. Listed in the Optional vouchers register.
 *  - Memorandum  — never in the books; listed in the Memorandum register (a note of a provisional
 *                  entry, e.g. an advance to staff pending bills).
 *  - Post-dated  — dated in the future and flagged: left out of the books until `today` reaches
 *                  its date, then it counts automatically. Post-dated summary lists them with the
 *                  post-dated cheques from the cheque register (read-only).
 *  - Reversing   — a journal with `reverse_on`: the ledger posts an automatic mirror-image journal
 *                  on that day (provisions, accruals). Unlike Tally's scenario-only "Reversing
 *                  Journal" voucher type, both entries are in the books — documented in ledger.md.
 *
 * Everything here is pure except `makeRegular`, which writes through the period lock, access
 * check and audit log like `saveVoucher`. Working papers — verify with your CA.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { assertUnlocked } from '../period-lock';
import { getTable, setTable } from '../storage';
import { loadVouchers, voucherTotals, VOUCHER_TYPE_LABELS, VOUCHERS_TABLE, VoucherError, type ManualVoucher } from './vouchers';

export type VariantKind = 'regular' | 'optional' | 'memo' | 'postdated';

/** What a manual voucher is on `today`. A post-dated voucher whose day has come is regular. */
export function variantOf(v: Pick<ManualVoucher, 'variant' | 'post_dated' | 'date'>, today: string): VariantKind {
  if (v.variant === 'MEMO') return 'memo';
  if (v.variant === 'OPTIONAL') return 'optional';
  if (v.post_dated && v.date > today) return 'postdated';
  return 'regular';
}

/** True when the voucher belongs in the books on `today`. */
export function inBooks(v: Pick<ManualVoucher, 'variant' | 'post_dated' | 'date'>, today: string): boolean {
  return variantOf(v, today) === 'regular';
}

/**
 * The automatic reversal of a reversing journal: same accounts, debits and credits swapped, dated
 * `reverse_on`. Null when the voucher does not reverse or is not in the books.
 */
export function reversalOf(v: ManualVoucher, today: string): ManualVoucher | null {
  if (v.type !== 'JOURNAL' || !v.reverse_on || !(v.reverse_on > v.date) || !inBooks(v, today)) return null;
  return {
    id: `${v.id}~rev`,
    type: 'JOURNAL',
    number: `${v.number}-R`,
    date: v.reverse_on,
    narration: `Reversal of ${v.number}${v.narration ? ` — ${v.narration}` : ''}`,
    lines: v.lines.map((l) => ({ ...l, dr: l.cr, cr: l.dr })),
    created_at: v.created_at,
  };
}

export interface VariantRegisterRow {
  voucher: ManualVoucher;
  kind: VariantKind;
  /** Total debits, paise. */
  amount: number;
}

/** Register rows of one kind (optional / memo / post-dated / reversing), filtered by class, by date. */
export function variantRegister(
  manual: readonly ManualVoucher[],
  kind: 'optional' | 'memo' | 'postdated' | 'reversing',
  today: string,
  voucherClass = '',
): VariantRegisterRow[] {
  return manual
    .filter((v) => (kind === 'reversing' ? !!v.reverse_on && v.type === 'JOURNAL' : kind === 'postdated' ? !!v.post_dated : variantOf(v, today) === kind))
    .filter((v) => !voucherClass || (v.voucher_class ?? '') === voucherClass)
    .map((v) => ({ voucher: v, kind: variantOf(v, today), amount: voucherTotals(v.lines).dr }))
    .sort((a, b) => a.voucher.date.localeCompare(b.voucher.date) || a.voucher.number.localeCompare(b.voucher.number));
}

/** Distinct voucher classes in use (for the register filter). */
export function voucherClasses(manual: readonly ManualVoucher[]): string[] {
  return [...new Set(manual.map((v) => v.voucher_class ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export interface PostDatedRow {
  source: 'voucher' | 'cheque';
  id: string;
  date: string;
  number: string;
  party: string;
  /** Paise. */
  amount: number;
  /** 'pending' until the date arrives, then 'matured' (counted in the books / due for deposit). */
  status: 'pending' | 'matured';
  direction?: 'in' | 'out';
}

interface ChequeLike {
  id?: unknown;
  direction?: unknown;
  cheque_date?: unknown;
  number?: unknown;
  party_name?: unknown;
  amount?: unknown;
  status?: unknown;
}

/**
 * Post-dated summary: flagged post-dated vouchers plus cheques from the cheque register dated after
 * the day they were recorded and not yet cleared / bounced / cancelled (read-only integration).
 */
export function postDatedSummary(manual: readonly ManualVoucher[], today: string, cheques: readonly unknown[] = []): PostDatedRow[] {
  const out: PostDatedRow[] = [];
  for (const v of manual) {
    if (!v.post_dated || v.variant) continue;
    out.push({
      source: 'voucher',
      id: v.id,
      date: v.date,
      number: v.number,
      party: v.lines.find((l) => l.party)?.party ?? '',
      amount: voucherTotals(v.lines).dr,
      status: v.date > today ? 'pending' : 'matured',
    });
  }
  for (const raw of cheques) {
    const c = (raw ?? {}) as ChequeLike;
    const date = typeof c.cheque_date === 'string' ? c.cheque_date.slice(0, 10) : '';
    const status = String(c.status ?? '').toLowerCase();
    if (!date || ['cleared', 'bounced', 'cancelled'].includes(status) || date <= today) continue;
    out.push({
      source: 'cheque',
      id: String(c.id ?? ''),
      date,
      number: String(c.number ?? ''),
      party: String(c.party_name ?? ''),
      amount: Math.round(Math.abs(Number(c.amount) || 0) * 100),
      status: 'pending',
      direction: c.direction === 'issued' ? 'out' : 'in',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

/** Make an optional voucher regular (it enters the books on its own date). Period lock + audit. */
export function makeRegular(id: string): ManualVoucher {
  const all = loadVouchers();
  const row = all.find((v) => v.id === id);
  if (!row) throw new VoucherError('Voucher not found.');
  if (row.variant !== 'OPTIONAL') throw new VoucherError('Only an optional voucher can be made regular.');
  requireAccess('books.edit');
  const lock = assertUnlocked({ id, issue_date: row.date, invoice_number: row.number }, 'edit');
  const next: ManualVoucher = { ...row, regularised_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  delete next.variant;
  // Keep every other stored field (unknown future fields included) — rewrite only this row.
  const stored = getTable<Record<string, unknown>>(VOUCHERS_TABLE);
  setTable(
    VOUCHERS_TABLE,
    stored.map((r) => {
      if (!r || r.id !== id) return r;
      const copy: Record<string, unknown> = { ...r, regularised_at: next.regularised_at, updated_at: next.updated_at };
      delete copy.variant;
      return copy;
    }),
  );
  audit.record({
    entity: 'voucher',
    entity_id: id,
    action: 'update',
    doc_number: row.number,
    summary: `Optional ${VOUCHER_TYPE_LABELS[row.type].toLowerCase()} voucher ${row.number} dated ${row.date} made regular${lock === 'overridden' ? ' (period lock overridden)' : ''}`,
    changes: [{ field: 'Variant', from: 'Optional', to: 'Regular' }],
  });
  return next;
}
