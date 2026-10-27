/**
 * Tally export of the rest of the books (WP-7, gaps P0-12 / P1-22). A fragment for `tally-xml.ts`:
 * the vouchers and masters the document export did not carry, so a CA who imports our XML gets the
 * same creditor, bank, expense and opening balances in Tally as in the app.
 *
 *   Supplier payment (`purchase_payments`)  Payment: Dr supplier (Agst Ref the bill number) | Cr bank / cash
 *                                           [+ Cr TDS Payable <section> when TDS was deducted on payment]
 *   Supplier advance / on account           Payment: Dr supplier (Advance / New Ref) | Cr bank / cash.
 *   (`vendor_payments`)                     Later adjustments against bills are bill-wise matching in Tally.
 *   Manual vouchers (`vouchers`)            Journal / Contra / Payment / Receipt with our number and narration;
 *                                           party lines on the supplier / customer ledger; cost-centre
 *                                           allocations; reversing journals with their reversal. Optional,
 *                                           memorandum and not-yet-due post-dated vouchers are left out,
 *                                           as they are not in the books.
 *   Fixed assets (`fixed_assets`)           Journal: acquisition (Dr asset | Cr paid from) and the yearly
 *                                           depreciation (31 March, Dr Depreciation | Cr Accumulated depreciation).
 *   Stock transfers (`stock_transfers`)     Stock Journal: out of one godown, into the other (quantity only).
 *   Masters                                 user groups (GROUP), cost centres, godowns, and ledger opening
 *                                           balances with bill-wise opening bills (`ledger_openings`,
 *                                           `opening_bills`).
 *
 * Pure: everything comes in through `TallyBooksSource` (`loadTallyBooksSource` reads storage for the
 * Export Center). Working papers — verify with your CA before importing into Tally.
 */

import type { Account, UserGroup, PrimaryGroupId } from './ledger/accounts';
import type { ManualVoucher } from './ledger/vouchers';
import type { FixedAsset } from './ledger/assets';
import type { LedgerOpening } from './ledger/openings';
import type { OpeningBill } from './opening-bills';
import type { CostCentre } from './cost-centres';
import type { Godown, StockTransfer } from '../types/stock';
import type { VendorPayment } from '../types/purchases';
import type { Client } from '../types/invoice';
import type { TallyEntry, TallyVoucher } from './tally-xml';
import type { TallyBankResolver } from './tally-bank';
import { A, chartOf, loadUserAccounts, loadUserGroups } from './ledger/accounts';
import { getTable } from './storage';
import { can } from './access';
import { isoDay } from './dates';
import { depreciationSchedule, loadAssets } from './ledger/assets';
import { loadVouchers } from './ledger/vouchers';
import { inBooks, reversalOf } from './ledger/voucher-variants';
import { inRange, normalizePurchase, toPaise, urdCreditorLedger, type DateRange } from './export-shared';
import { PURCHASE_RETURNS_LEDGER } from './tally-debit-notes';

export interface TallyBooksSource {
  /** Raw `purchase_payments` rows (read defensively). */
  purchasePayments?: unknown[];
  vendorPayments?: VendorPayment[];
  manualVouchers?: ManualVoucher[];
  /** The chart (defaults + user + synthesised bank ledgers). */
  chart?: Account[];
  userGroups?: UserGroup[];
  openings?: LedgerOpening[];
  openingBills?: OpeningBill[];
  costCentres?: CostCentre[];
  stockTransfers?: StockTransfer[];
  stockItems?: Array<{ id: string; name: string; unit?: string }>;
  godowns?: Godown[];
  fixedAssets?: FixedAsset[];
  /** Local today (YYYY-MM-DD): post-dated vouchers and depreciation are taken as of this day. */
  today?: string;
  /** Additive (7P): raw `payroll_runs` / `payroll_payments` rows for `tally-payroll.ts` (only when the user may see payroll). */
  payrollRuns?: unknown[];
  payrollPayments?: unknown[];
}

/** Ledger names the document export already uses (same names, so Tally sees one ledger each). */
export interface BooksLedgerNames {
  range: DateRange;
  salesLedger: string;
  purchaseLedger: string;
  bankLedger: string;
  cashLedger: string;
  roundOffLedger: string;
  otherChargesLedger: string;
  outputCgst: string;
  outputSgst: string;
  outputIgst: string;
  outputGst: string;
  outputCess: string;
  tcsLedger: string;
  tdsLedger: string;
  inputCgst: string;
  inputSgst: string;
  inputIgst: string;
  /** Additive (7O): input cess ledger name (default "Input Cess"). */
  inputCess?: string;
  rcmPayableLedger: string;
  customsIgstLedger: string;
}

type Duty = 'Central Tax' | 'State Tax' | 'Integrated Tax' | 'Cess';
export interface BooksLedgerDef {
  name: string;
  parent: string;
  billwise?: boolean;
  duty?: Duty;
  gstin?: string;
  /** Debit-positive paise. */
  opening?: number;
  bills?: Array<{ name: string; date: string; paise: number }>;
  costCentres?: boolean;
}
export type RegisterBooksLedger = (def: BooksLedgerDef) => void;

/** Schedule III primary → the Tally group a ledger goes under. */
export const TALLY_GROUP_OF: Readonly<Record<PrimaryGroupId, string>> = {
  CAPITAL: 'Capital Account',
  RESERVES: 'Reserves & Surplus',
  LOANS_LT: 'Loans (Liability)',
  LOANS_ST: 'Loans (Liability)',
  TRADE_PAYABLES: 'Sundry Creditors',
  DUTIES_TAXES: 'Duties & Taxes',
  OTHER_CL: 'Current Liabilities',
  PROVISIONS: 'Provisions',
  FIXED_ASSETS: 'Fixed Assets',
  INVESTMENTS: 'Investments',
  LOANS_ADV_LT: 'Deposits (Asset)',
  INVENTORIES: 'Stock-in-Hand',
  TRADE_RECEIVABLES: 'Sundry Debtors',
  CASH_BANK: 'Bank Accounts',
  LOANS_ADV_ST: 'Loans & Advances (Asset)',
  OTHER_CA: 'Current Assets',
  SALES: 'Sales Accounts',
  OTHER_INCOME: 'Indirect Incomes',
  PURCHASES: 'Purchase Accounts',
  DIRECT_EXPENSES: 'Direct Expenses',
  EMPLOYEE: 'Indirect Expenses',
  FINANCE: 'Indirect Expenses',
  DEPRECIATION: 'Indirect Expenses',
  INDIRECT_EXPENSES: 'Indirect Expenses',
};

const TDS_SECTION_LEDGER: Readonly<Record<string, string>> = {
  [A.tds194c]: 'TDS Payable 194C',
  [A.tds194j]: 'TDS Payable 194J',
  [A.tds194i]: 'TDS Payable 194I',
  [A.tds194h]: 'TDS Payable 194H',
  [A.tds194q]: 'TDS Payable 194Q',
  [A.tds194a]: 'TDS Payable 194A',
};

/** Resolves our account ids (+ party) to a Tally ledger, registering the ledger master. */
export function ledgerResolver(src: TallyBooksSource, o: BooksLedgerNames, addLedger: RegisterBooksLedger) {
  const chart = new Map((src.chart ?? []).map((a) => [a.id, a]));
  const groupName = new Map((src.userGroups ?? []).map((g) => [g.id, g.name]));
  const fixed: Record<string, BooksLedgerDef> = {
    [A.cash]: { name: o.cashLedger, parent: 'Cash-in-Hand' },
    [A.bank]: { name: o.bankLedger, parent: 'Bank Accounts' },
    [A.sales]: { name: o.salesLedger, parent: 'Sales Accounts' },
    [A.freightOut]: { name: o.otherChargesLedger, parent: 'Sales Accounts' },
    [A.purchases]: { name: o.purchaseLedger, parent: 'Purchase Accounts' },
    [A.purchaseReturns]: { name: PURCHASE_RETURNS_LEDGER, parent: 'Purchase Accounts' },
    [A.roundOff]: { name: o.roundOffLedger, parent: 'Indirect Expenses' },
    [A.outCgst]: { name: o.outputCgst, parent: 'Duties & Taxes', duty: 'Central Tax' },
    [A.outSgst]: { name: o.outputSgst, parent: 'Duties & Taxes', duty: 'State Tax' },
    [A.outIgst]: { name: o.outputIgst, parent: 'Duties & Taxes', duty: 'Integrated Tax' },
    [A.outGst]: { name: o.outputGst, parent: 'Duties & Taxes' },
    [A.outCess]: { name: o.outputCess, parent: 'Duties & Taxes', duty: 'Cess' },
    [A.inCgst]: { name: o.inputCgst, parent: 'Duties & Taxes', duty: 'Central Tax' },
    [A.inSgst]: { name: o.inputSgst, parent: 'Duties & Taxes', duty: 'State Tax' },
    [A.inIgst]: { name: o.inputIgst, parent: 'Duties & Taxes', duty: 'Integrated Tax' },
    [A.inCess]: { name: o.inputCess || 'Input Cess', parent: 'Duties & Taxes', duty: 'Cess' },
    [A.tcsPayable]: { name: o.tcsLedger, parent: 'Duties & Taxes' },
    [A.tdsReceivable]: { name: o.tdsLedger, parent: 'Current Assets' },
    [A.rcmPayable]: { name: o.rcmPayableLedger, parent: 'Duties & Taxes' },
    [A.importIgst]: { name: o.customsIgstLedger, parent: 'Duties & Taxes' },
  };
  for (const [id, name] of Object.entries(TDS_SECTION_LEDGER)) fixed[id] = { name, parent: 'Duties & Taxes' };

  return (accountId: string, party?: string): string => {
    if ((accountId === A.debtors || accountId === A.creditors) && party) {
      addLedger({ name: party, parent: accountId === A.debtors ? 'Sundry Debtors' : 'Sundry Creditors', billwise: true });
      return party;
    }
    const f = fixed[accountId];
    if (f) {
      addLedger(f);
      return f.name;
    }
    const a = chart.get(accountId);
    if (!a) {
      addLedger({ name: accountId, parent: 'Suspense A/c' });
      return accountId;
    }
    let parent = a.under && groupName.has(a.under) ? groupName.get(a.under)! : TALLY_GROUP_OF[a.group] ?? 'Suspense A/c';
    if (accountId.startsWith('bank:')) parent = a.group === 'LOANS_ST' ? 'Bank OD A/c' : 'Bank Accounts';
    if (accountId === A.bankOd) parent = 'Bank OD A/c';
    addLedger({ name: a.name, parent });
    return a.name;
  };
}

function push(entries: TallyEntry[], ledger: string, side: 'Dr' | 'Cr', paise: number, extra: Partial<TallyEntry> = {}) {
  if (paise <= 0) return;
  entries.push({ ledger, side, paise, ...extra });
}

function voucher(type: TallyVoucher['type'], date: string, number: string, party: string, narration: string, entries: TallyEntry[], reference = ''): TallyVoucher {
  return { type, date, number, party, partyGstin: '', stateName: '', narration, reference, entries, inventory: [], inventoryLedger: '' };
}

const fmt = (p: number) => (p / 100).toFixed(2);

/** Every books voucher the document export does not carry, dated in `o.range`. */
export function booksVouchers(
  src: TallyBooksSource,
  base: { purchases: unknown[]; vendors: unknown[] },
  o: BooksLedgerNames,
  addLedger: RegisterBooksLedger,
  bankOf: TallyBankResolver,
  warnings: string[],
): TallyVoucher[] {
  const out: TallyVoucher[] = [];
  const ledgerOf = ledgerResolver(src, o, addLedger);
  const today = src.today ?? isoDay(new Date());
  const centres = new Map((src.costCentres ?? []).map((c) => [c.id, c.name]));
  const bankLedger = (rec: { method?: string; bank_account_id?: string }) => {
    const b = bankOf(rec);
    addLedger({ name: b.ledger, parent: b.parent });
    return b.ledger;
  };

  /* Supplier payments against bills. */
  const bills = new Map<string, ReturnType<typeof normalizePurchase>>();
  for (const raw of base.purchases) {
    const n = normalizePurchase(raw, base.vendors);
    const urd = n && urdCreditorLedger(raw, base.vendors); // QA10 R5: a URD voucher's own creditor ledger
    if (n) bills.set(n.id, urd ? { ...n, partyName: urd } : n);
  }
  const seq = new Map<string, number>();
  const rows = (src.purchasePayments ?? [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice()
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  for (const r of rows) {
    const bill = bills.get(String(r.purchase_id ?? ''));
    const n = (seq.get(String(r.purchase_id)) ?? 0) + 1;
    seq.set(String(r.purchase_id), n);
    const date = String(r.date ?? '');
    if (!bill || !inRange(date, o.range)) {
      if (!bill && inRange(date, o.range)) warnings.push(`Supplier payment ${String(r.id ?? '')} of ${date}: its bill is missing, so it was left out.`);
      continue;
    }
    const cash = toPaise(Number(r.amount) || 0);
    const tds = toPaise(Number(r.tds_amount) || 0);
    if (cash + tds <= 0) continue;
    const party = bill.partyName;
    addLedger({ name: party, parent: 'Sundry Creditors', billwise: true, ...(bill.partyGstin ? { gstin: bill.partyGstin } : {}) });
    const entries: TallyEntry[] = [];
    const billNo = bill.number || bill.id;
    push(entries, party, 'Dr', cash + tds, { bill: { name: billNo, type: 'Agst Ref' } });
    push(entries, bankLedger({ method: String(r.method ?? ''), bank_account_id: r.bank_account_id ? String(r.bank_account_id) : undefined }), 'Cr', cash);
    if (tds > 0) {
      const sec = (bill.tdsSection || '').replace(/-.*/, '');
      const tdsLedger = `TDS Payable ${sec}`.trim();
      addLedger({ name: tdsLedger, parent: 'Duties & Taxes' });
      push(entries, tdsLedger, 'Cr', tds);
    }
    out.push(voucher('Payment', date, `${billNo}/P${n}`, party, [String(r.method ?? ''), r.reference ? `Ref ${String(r.reference)}` : '', `Against bill ${billNo}`, tds > 0 ? `TDS ${fmt(tds)} deducted` : ''].filter(Boolean).join(' | '), entries, String(r.reference ?? '')));
  }

  /* Supplier advances / on-account / new-ref payments. */
  for (const vp of src.vendorPayments ?? []) {
    if (!vp || !inRange(vp.date, o.range)) continue;
    const paise = toPaise(Number(vp.amount) || 0);
    if (paise <= 0) continue;
    const party = String(vp.vendor_name ?? '').trim() || 'Unknown vendor';
    addLedger({ name: party, parent: 'Sundry Creditors', billwise: true });
    const ref = vp.kind === 'NEW_REF' ? vp.ref_name || vp.reference || vp.id : vp.reference || vp.id;
    const entries: TallyEntry[] = [];
    push(entries, party, 'Dr', paise, { bill: { name: ref, type: vp.kind === 'NEW_REF' ? 'New Ref' : 'Advance' } });
    push(entries, bankLedger(vp), 'Cr', paise);
    out.push(voucher('Payment', vp.date, `VP/${vp.id.slice(0, 8)}`, party, [vp.kind === 'ADVANCE' ? 'Advance to supplier' : vp.kind === 'ON_ACCOUNT' ? 'On account' : `New Ref ${ref}`, vp.method, vp.reference ? `Ref ${vp.reference}` : ''].filter(Boolean).join(' | '), entries, vp.reference ?? ''));
  }

  /* Manual vouchers (+ the reversal of a reversing journal). */
  const typeOf = { JOURNAL: 'Journal', CONTRA: 'Contra', PAYMENT: 'Payment', RECEIPT: 'Receipt' } as const;
  const manual: ManualVoucher[] = [];
  for (const v of src.manualVouchers ?? []) {
    if (!inBooks(v, today)) continue;
    manual.push(v);
    const rev = reversalOf(v, today);
    if (rev) manual.push(rev);
  }
  for (const v of manual) {
    if (!inRange(v.date, o.range)) continue;
    const entries: TallyEntry[] = [];
    for (const l of v.lines) {
      const ledger = ledgerOf(l.account_id, l.party);
      const amt = l.dr > 0 ? l.dr : l.cr;
      const cc = l.cost_centre_id ? centres.get(l.cost_centre_id) : undefined;
      if (cc) addLedger({ name: ledger, parent: '', costCentres: true });
      push(entries, ledger, l.dr > 0 ? 'Dr' : 'Cr', amt, {
        ...(l.party && (l.account_id === A.debtors || l.account_id === A.creditors) ? { bill: { name: v.number, type: 'New Ref' as const } } : {}),
        ...(cc ? { costCentres: [{ name: cc, paise: amt }] } : {}),
      });
    }
    const party = v.lines.find((l) => l.party)?.party ?? '';
    out.push(voucher(typeOf[v.type], v.date, v.number, party, v.narration, entries));
  }

  /* Fixed assets: acquisition and yearly depreciation journals. */
  const depByFy = new Map<string, number>();
  for (const a of src.fixedAssets ?? []) {
    const cost = toPaise(Number(a.cost) || 0);
    if (a.paid_from && cost > 0 && inRange(a.acquired_on, o.range)) {
      const entries: TallyEntry[] = [];
      push(entries, ledgerOf(a.account_id), 'Dr', cost);
      push(entries, ledgerOf(a.paid_from, a.party), 'Cr', cost);
      out.push(voucher('Journal', a.acquired_on, `FA/${a.id.slice(0, 8)}`, a.party ?? '', `Fixed asset acquired: ${a.name}`, entries));
    }
    for (const r of depreciationSchedule(a, today)) {
      if (r.depreciation > 0 && inRange(r.date, o.range)) depByFy.set(r.date, (depByFy.get(r.date) ?? 0) + r.depreciation);
    }
  }
  for (const [date, dep] of [...depByFy].sort((a, b) => a[0].localeCompare(b[0]))) {
    const entries: TallyEntry[] = [];
    push(entries, ledgerOf(A.depreciation), 'Dr', dep);
    push(entries, ledgerOf(A.accDep), 'Cr', dep);
    out.push(voucher('Journal', date, `DEP/${date.slice(0, 4)}`, '', 'Depreciation for the year (Income-tax Act WDV, fixed-asset register)', entries));
  }

  /* Stock transfers → Stock Journal (quantity only). */
  const items = new Map((src.stockItems ?? []).map((i) => [i.id, i]));
  const godownName = (id: string) => (src.godowns ?? []).find((g) => g.id === id)?.name ?? (id === 'main' || !id ? 'Main Location' : id);
  for (const t of src.stockTransfers ?? []) {
    if (!t || !inRange(t.date, o.range)) continue;
    const lines = t.lines
      .map((l) => ({ item: items.get(l.item_id)?.name ?? '', unit: (items.get(l.item_id)?.unit ?? 'NOS').toUpperCase(), qty: Number(l.qty) || 0, batch: l.batch_no ?? '' }))
      .filter((l) => l.item && l.qty > 0);
    if (!lines.length) continue;
    const v = voucher('Stock Journal', t.date, t.transfer_number, '', [`Transfer ${godownName(t.from_godown)} → ${godownName(t.to_godown)}`, t.notes].filter(Boolean).join(' | '), []);
    v.stock = { from: godownName(t.from_godown), to: godownName(t.to_godown), lines };
    out.push(v);
  }
  return out;
}

/** Ledger masters with opening balances and bill-wise opening bills (P1-22 "opening balances in masters"). */
export function openingLedgers(src: TallyBooksSource, clients: readonly Client[], vendors: readonly unknown[], o: BooksLedgerNames, addLedger: RegisterBooksLedger): void {
  const ledgerOf = ledgerResolver(src, o, addLedger);
  const clientName = new Map(clients.filter((c) => c?.id).map((c) => [c.id!, (c.company ?? '').trim() || (c.name ?? '').trim()]));
  const vendorName = new Map(
    vendors
      .filter((v): v is { id: string; name: string } => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string')
      .map((v) => [v.id, String(v.name ?? '').trim()]),
  );
  const billsOf = (partyId: string, side: 'receivable' | 'payable') =>
    (src.openingBills ?? [])
      .filter((b) => b.party_id === partyId && b.side === side)
      .map((b) => ({ name: b.ref_no, date: b.date, paise: (b.dr_cr === 'Dr' ? 1 : -1) * toPaise(b.amount) }));
  for (const op of src.openings ?? []) {
    const amount = (op.dr ?? 0) - (op.cr ?? 0);
    if (!amount) continue;
    const m = /^party:(debtor|creditor):(.+)$/.exec(op.ledger_id);
    if (m) {
      const debtor = m[1] === 'debtor';
      const name = (debtor ? clientName.get(m[2]) : vendorName.get(m[2])) || op.party_name || '';
      if (!name) continue;
      const bills = billsOf(m[2], debtor ? 'receivable' : 'payable');
      addLedger({ name, parent: debtor ? 'Sundry Debtors' : 'Sundry Creditors', billwise: true, opening: amount, ...(bills.length ? { bills } : {}) });
    } else {
      const name = ledgerOf(op.ledger_id);
      addLedger({ name, parent: '', opening: amount });
    }
  }
}

/** GROUP masters for user groups, parents first (Tally needs the parent to exist). */
export function groupMasters(src: TallyBooksSource): Array<{ name: string; parent: string }> {
  const groups = src.userGroups ?? [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: Array<{ name: string; parent: string }> = [];
  const done = new Set<string>();
  const visit = (g: UserGroup, depth = 0) => {
    if (done.has(g.id) || depth > 32) return;
    const p = byId.get(g.parent);
    if (p) visit(p, depth + 1);
    done.add(g.id);
    out.push({ name: g.name, parent: p ? p.name : TALLY_GROUP_OF[g.parent as PrimaryGroupId] ?? 'Primary' });
  };
  for (const g of groups) visit(g);
  return out;
}

/** Everything above, read from storage for the Export Center (fail-soft: a table that cannot be read is left out). */
export function loadTallyBooksSource(today: string): TallyBooksSource {
  const safe = <T,>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  return {
    purchasePayments: safe(() => getTable<unknown>('purchase_payments')),
    vendorPayments: safe(() => getTable<VendorPayment>('vendor_payments')),
    manualVouchers: safe(loadVouchers),
    chart: safe(() => chartOf(loadUserAccounts())),
    userGroups: safe(loadUserGroups),
    openings: safe(() => getTable<LedgerOpening>('ledger_openings')),
    openingBills: safe(() => getTable<OpeningBill>('opening_bills')),
    costCentres: safe(() => getTable<CostCentre>('cost_centres')),
    stockTransfers: safe(() => getTable<StockTransfer>('stock_transfers')),
    stockItems: safe(() => getTable<{ id: string; name: string; unit?: string }>('stock_items')),
    godowns: safe(() => getTable<Godown>('godowns')),
    fixedAssets: safe(loadAssets),
    // 7P: payroll is confidential (owner-only `payroll.view`), so it joins the export only for those who may see it.
    payrollRuns: safe(() => (can('payroll.view') ? getTable<unknown>('payroll_runs') : undefined)),
    payrollPayments: safe(() => (can('payroll.view') ? getTable<unknown>('payroll_payments') : undefined)),
    today,
  };
}
