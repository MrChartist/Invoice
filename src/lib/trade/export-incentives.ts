/**
 * R4-C2 export incentives register: RoDTEP (e-scrip), duty drawback and IGST refund on goods exports
 * (shipping-bill route, roadmap 7.131), typed per shipping bill.
 *
 *   receivable = claimed − credited                  (what the department still owes)
 *   RoDTEP scrip in hand = credited − utilised − transferred
 *
 * Journals (through `saveVoucher`: period lock, roles, audit), on user ledgers created on first use:
 *   claim          Dr Export incentives receivable  | Cr Export incentives income
 *   credit (bank)  Dr Bank                          | Cr Export incentives receivable   (drawback / IGST refund)
 *   scrip used     Dr Customs duty payable          | Cr Export incentives receivable   (entered from the BOE sheet)
 *   scrip sold     Dr Bank (sale value)             | Cr Export incentives receivable (face) ± Export incentives income
 * A RoDTEP scrip credit itself moves no money (the scrip stays in the receivable ledger until used or sold).
 * The accrual point and the tax treatment of incentive income and scrip sales need verification with your CA.
 *
 * Table `export_incentives` (`books.edit`, dated by the claim date).
 */
import type { ExportIncentive, IncentiveKind } from '../../types/trade-r4';
import { round2 } from '../invoice-calc';
import { isoDay } from '../dates';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { ensureTradeLedger } from './ledgers';

export const INCENTIVES_TABLE = 'export_incentives';
export const INCENTIVE_KINDS: readonly IncentiveKind[] = ['rodtep', 'drawback', 'igst_refund'];
export const INCENTIVE_CLASS = 'Export incentive';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const paise = (rupees: number) => Math.round(round2(rupees) * 100);

export interface IncentiveFigures {
  claimed: number;
  credited: number;
  receivable: number;
  utilised: number;
  transferred: number;
  /** RoDTEP: scrip value still available to pay duty or to sell. */
  scripBalance: number;
}

export function incentiveFigures(r: Pick<ExportIncentive, 'kind' | 'claimed' | 'credited' | 'utilised' | 'transferred'>): IncentiveFigures {
  const claimed = round2(n(r.claimed));
  const credited = round2(n(r.credited));
  const utilised = round2((r.utilised ?? []).reduce((s, u) => s + n(u.amount), 0));
  const transferred = round2(n(r.transferred?.amount));
  return {
    claimed,
    credited,
    receivable: round2(Math.max(claimed - credited, 0)),
    utilised,
    transferred,
    scripBalance: r.kind === 'rodtep' ? round2(Math.max(credited - utilised - transferred, 0)) : 0,
  };
}

/** Register totals by kind. */
export function incentiveTotals(rows: readonly ExportIncentive[]): Record<IncentiveKind, IncentiveFigures> {
  const zero = (): IncentiveFigures => ({ claimed: 0, credited: 0, receivable: 0, utilised: 0, transferred: 0, scripBalance: 0 });
  const out = { rodtep: zero(), drawback: zero(), igst_refund: zero() } as Record<IncentiveKind, IncentiveFigures>;
  for (const r of rows) {
    const f = incentiveFigures(r);
    const t = out[r.kind] ?? (out[r.kind] = zero());
    for (const k of Object.keys(f) as (keyof IncentiveFigures)[]) t[k] = round2(t[k] + f[k]);
  }
  return out;
}

/* ── Journal lines (pure, paise) ─────────────────────────────── */

export interface IncentiveLedgers {
  receivable: string;
  income: string;
  bank: string;
  customsPayable: string;
}

const dr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: amount, cr: 0 });
const cr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: 0, cr: amount });

export function claimLines(amount: number, l: IncentiveLedgers): ManualVoucherLine[] {
  const p = paise(amount);
  return [dr(l.receivable, p), cr(l.income, p)];
}
export function creditLines(amount: number, l: IncentiveLedgers): ManualVoucherLine[] {
  const p = paise(amount);
  return [dr(l.bank, p), cr(l.receivable, p)];
}
export function utilisationLines(amount: number, l: IncentiveLedgers): ManualVoucherLine[] {
  const p = paise(amount);
  return [dr(l.customsPayable, p), cr(l.receivable, p)];
}
/** Scrip sold: face value leaves the receivable; the difference to the sale value goes to incentive income. */
export function transferLines(face: number, value: number, l: IncentiveLedgers): ManualVoucherLine[] {
  const f = paise(face);
  const v = paise(value);
  const lines = [dr(l.bank, v), cr(l.receivable, f)];
  if (v > f) lines.push(cr(l.income, v - f));
  if (f > v) lines.push(dr(l.income, f - v));
  return lines;
}

function ledgers(): IncentiveLedgers {
  return { receivable: ensureTradeLedger('incentivesReceivable'), income: ensureTradeLedger('incentivesIncome'), bank: A.bank, customsPayable: ensureTradeLedger('customsPayable') };
}

/* ── Store ───────────────────────────────────────────────────── */

const KIND_LABEL: Record<IncentiveKind, string> = { rodtep: 'RoDTEP', drawback: 'Duty drawback', igst_refund: 'IGST refund' };
const lock = (date: string, action: 'create' | 'edit' | 'delete') => assertUnlocked({ issue_date: date }, action);
const underAa = (invoiceId: string | undefined) => !!invoiceId && getTable<{ id?: string; mf?: { export_aa?: { authorisation_id?: string } } }>('invoices').some((i) => i?.id === invoiceId && !!i.mf?.export_aa?.authorisation_id);

export const incentivesDb = {
  all: (): ExportIncentive[] => getTable<ExportIncentive>(INCENTIVES_TABLE).filter((r) => r && typeof r.id === 'string'),

  save(input: Omit<ExportIncentive, 'id' | 'voucher_ids'> & { id?: string; voucher_ids?: string[] }): ExportIncentive {
    requireAccess('books.edit');
    if (!INCENTIVE_KINDS.includes(input.kind)) throw new Error('incKindBad');
    if (!isoDay(input.date)) throw new Error('incDateBad');
    if (!(n(input.claimed) > 0)) throw new Error('incClaimedBad');
    if (n(input.credited) > n(input.claimed) + 0.005 && input.kind !== 'rodtep') throw new Error('incCreditOver');
    const rows = incentivesDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (prev) lock(prev.date, 'edit');
    lock(input.date, prev ? 'edit' : 'create');
    if (prev?.claim_voucher_id && round2(n(input.claimed)) !== round2(prev.claimed)) throw new Error('incPostedClaim');
    const now = new Date().toISOString();
    const row: ExportIncentive = {
      ...prev,
      ...input,
      id: prev?.id ?? generateId(),
      claimed: round2(n(input.claimed)),
      ...(input.credited !== undefined ? { credited: round2(n(input.credited)) } : {}),
      ...('appendix' in input ? { appendix: input.kind === 'rodtep' && (input.appendix === '4R' || input.appendix === '4RE') ? input.appendix : undefined } : {}), // MF-D4 (MF18)
      // QA16 P9: a new RoDTEP row on an export made under an Advance Authorisation defaults to Appendix 4RE.
      ...(!prev && !('appendix' in input) && input.kind === 'rodtep' && underAa(input.invoice_id) ? { appendix: '4RE' as const } : {}),
      voucher_ids: prev?.voucher_ids ?? input.voucher_ids ?? [],
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    setTable(INCENTIVES_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },

  remove(id: string): void {
    requireAccess('books.edit');
    const rows = incentivesDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (row.voucher_ids.length) throw new Error('incHasJournals');
    lock(row.date, 'delete');
    setTable(INCENTIVES_TABLE, rows.filter((r) => r.id !== id));
  },
};

function update(id: string, fn: (r: ExportIncentive) => ExportIncentive): ExportIncentive {
  const rows = incentivesDb.all();
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error('incMissing');
  const next = { ...fn(row), updated_at: new Date().toISOString() };
  setTable(INCENTIVES_TABLE, rows.map((r) => (r.id === id ? next : r)));
  return next;
}

const TABLES = [INCENTIVES_TABLE, 'vouchers', 'accounts'];

/** Post the claim journal (once). */
export function postIncentiveClaim(id: string, date: string, ref = ''): ExportIncentive {
  requireAccess('books.edit');
  return withTablesRollback(TABLES, () => {
    const row = incentivesDb.all().find((r) => r.id === id);
    if (!row) throw new Error('incMissing');
    if (row.claim_voucher_id) throw new Error('incPostedClaim');
    const v = saveVoucher({ type: 'JOURNAL', date, narration: `${KIND_LABEL[row.kind]} claimed${ref ? ` on ${ref}` : ''} — accrual and tax treatment: verify with your CA`, lines: claimLines(row.claimed, ledgers()), voucher_class: INCENTIVE_CLASS });
    return update(id, (r) => ({ ...r, claim_voucher_id: v.id, voucher_ids: [...r.voucher_ids, v.id] }));
  });
}

/** Record the credit: RoDTEP scrip (no journal) or drawback / IGST refund received in the bank (journal). */
export function recordIncentiveCredit(id: string, amount: number, date: string, scrip?: { no?: string; date?: string }): ExportIncentive {
  requireAccess('books.edit');
  if (!(amount > 0) || !isoDay(date)) throw new Error('incCreditBad');
  return withTablesRollback(TABLES, () => {
    const row = incentivesDb.all().find((r) => r.id === id);
    if (!row) throw new Error('incMissing');
    const credited = round2(n(row.credited) + amount);
    if (row.kind !== 'rodtep' && credited > row.claimed + 0.005) throw new Error('incCreditOver');
    let vid: string | undefined;
    if (row.kind !== 'rodtep') {
      vid = saveVoucher({ type: 'RECEIPT', date, narration: `${KIND_LABEL[row.kind]} received`, lines: creditLines(amount, ledgers()), voucher_class: INCENTIVE_CLASS }).id;
    } else lock(date, 'create');
    return update(id, (r) => ({
      ...r,
      credited,
      credited_on: date,
      ...(scrip?.no ? { scrip_no: scrip.no } : {}),
      ...(scrip?.date ? { scrip_date: scrip.date } : {}),
      ...(vid ? { credit_voucher_id: r.credit_voucher_id ?? vid, voucher_ids: [...r.voucher_ids, vid] } : {}),
    }));
  });
}

/** RoDTEP scrip used to pay customs duty on a Bill of Entry (from the BOE sheet). */
export function utiliseScrip(id: string, boeId: string, amount: number, date: string): ExportIncentive {
  requireAccess('books.edit');
  return withTablesRollback(TABLES, () => {
    const row = incentivesDb.all().find((r) => r.id === id);
    if (!row || row.kind !== 'rodtep') throw new Error('incMissing');
    if (!(amount > 0) || amount > incentiveFigures(row).scripBalance + 0.005) throw new Error('incScripShort');
    const v = saveVoucher({ type: 'JOURNAL', date, narration: `RoDTEP scrip ${row.scrip_no ?? ''} used against customs duty`.replace(/\s+/g, ' '), lines: utilisationLines(amount, ledgers()), voucher_class: INCENTIVE_CLASS });
    return update(id, (r) => ({ ...r, utilised: [...(r.utilised ?? []), { boe_id: boeId, amount: round2(amount), date, voucher_id: v.id }], voucher_ids: [...r.voucher_ids, v.id] }));
  });
}

/** RoDTEP scrip sold: face `amount` for sale `value`. */
export function transferScrip(id: string, amount: number, value: number, date: string): ExportIncentive {
  requireAccess('books.edit');
  return withTablesRollback(TABLES, () => {
    const row = incentivesDb.all().find((r) => r.id === id);
    if (!row || row.kind !== 'rodtep') throw new Error('incMissing');
    if (row.transferred) throw new Error('incTransferred');
    if (!(amount > 0) || amount > incentiveFigures(row).scripBalance + 0.005 || !(value >= 0)) throw new Error('incScripShort');
    const v = saveVoucher({ type: 'RECEIPT', date, narration: `RoDTEP scrip ${row.scrip_no ?? ''} sold — GST / income-tax treatment: verify with your CA`.replace(/\s+/g, ' '), lines: transferLines(amount, value, ledgers()), voucher_class: INCENTIVE_CLASS });
    return update(id, (r) => ({ ...r, transferred: { date, value: round2(value), amount: round2(amount), voucher_id: v.id }, voucher_ids: [...r.voucher_ids, v.id] }));
  });
}

/** RoDTEP rows with scrip left to pay duty. */
export const scripsAvailable = (rows: readonly ExportIncentive[]) => rows.filter((r) => r.kind === 'rodtep' && incentiveFigures(r).scripBalance > 0.005);

export function incentivesSheet(rows: readonly ExportIncentive[], numberOf: (invoiceId: string) => string): (string | number)[][] {
  return [
    ['Kind', 'Invoice', 'Claim date', 'Rate %', 'Claimed', 'Credited', 'Receivable', 'Scrip no.', 'Utilised', 'Transferred', 'Scrip balance'],
    ...rows.map((r) => {
      const f = incentiveFigures(r);
      return [KIND_LABEL[r.kind], numberOf(r.invoice_id), r.date, r.rate ?? '', f.claimed, f.credited, f.receivable, r.scrip_no ?? '', f.utilised, f.transferred, f.scripBalance];
    }),
  ];
}
