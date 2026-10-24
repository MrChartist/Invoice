/**
 * The double-entry ledger (Phase 6.1): every voucher, automatic or manual, as balanced
 * Dr/Cr lines in integer PAISE.
 *
 * Automatic vouchers are DERIVED in memory from the documents each time — nothing is stored
 * twice. They read the same shared helpers as GST reports, Books and Tally
 * (`export-shared.invoiceAmounts`, `books.normalizePurchase` → `readPurchase`/`splitLumpTax`,
 * `fx.inrValue`), so the numbers agree everywhere.
 *
 * Posting rules (see docs/features/ledger.md):
 *   Sales / debit note  Dr Debtors (party) total | Cr Sales (items), Cr Freight & charges,
 *                       Cr Output CGST/SGST/IGST/GST, Cr Output cess, Cr TCS payable, ± Round off
 *   Credit note         the exact mirror, Sales side debited to "Sales returns"
 *   Receipt             Dr Cash/Bank | Cr Debtors; the receipt that clears the cash due also
 *                       books the customer's TDS: Dr TDS receivable | Cr Debtors. A foreign
 *                       receipt with a realised rate: Dr Bank at the realised rupees, Cr Debtors
 *                       at the invoice rate, difference to "Foreign exchange gain / loss" (6.19).
 *   Purchase / expense  Dr Purchases or the expense account (cost = taxable, + GST when ITC is
 *                       not available), Dr Input CGST/SGST/IGST (ITC) | Cr Creditors (party).
 *                       Reverse charge and import of services: the GST is credited to
 *                       "GST payable — reverse charge" instead of the supplier. Import of goods:
 *                       the IGST is credited to "IGST payable on imports (customs)".
 *                       ITC reversed on the bill: Dr GST input credit reversed | Cr Input heads.
 *   Supplier payment    Dr Creditors | Cr Cash/Bank
 *   Opening (Books)     Dr Cash/Bank | Cr Opening balance difference — sized so the ledger's
 *                       cash/bank balance from that day equals the Books cash/bank book.
 *   Fixed assets        Dr asset | Cr paid-from account; yearly Dr Depreciation | Cr Accumulated depreciation.
 * Foreign-currency documents post in rupees at their `exchange_rate`; receipts clear the debtor
 * at the invoice's rate and, when the receipt carries a `realised_rate`, the exchange difference
 * goes to the FX gain/loss account (`fx-gain.ts`).
 *
 * Pure: no storage. Working papers — verify with your CA.
 */

import type { InvoiceRecord, Payment } from '../../types/invoice';
import { isCreditNote, isSale, normalizePurchase, partyOfInvoice, accountForMethod, toIsoDate, type BooksData } from '../books';
import { allocateProportionally, calcInputFromRecord, calculateInvoice, num } from '../invoice-calc';
import { invoiceAmounts, toPaise } from '../export-shared';
import { fxNarration, inrValue } from '../fx';
import { readPurchase } from '../purchase-normalize';
import { realisedFx } from '../fx-gain';
import { A, EXPENSE_CATEGORY_ACCOUNTS, chartOf, groupOf, type Account } from './accounts';
import { VOUCHER_TYPE_LABELS, type ManualVoucher } from './vouchers';
import { depreciationSchedule, fyLabelOf, type FixedAsset } from './assets';

export interface PostingLine {
  account: string;
  /** Integer paise, >= 0; exactly one of dr / cr is non-zero. */
  dr: number;
  cr: number;
  /** Party sub-ledger (debtors / creditors control accounts). */
  party?: string;
  /**
   * Cost centre id (6.16), copied from the source document / bill / voucher line. Every line of
   * an automatic voucher carries its document's centre; reports only read it on income and
   * expense accounts. Absent = unallocated.
   */
  cost_centre?: string;
}

export type LedgerVoucherKind =
  | 'Opening'
  | 'Sales'
  | 'Debit Note'
  | 'Credit Note'
  | 'Purchase'
  | 'Expense'
  | 'Receipt'
  | 'Payment'
  | 'Journal'
  | 'Contra'
  | 'Fixed Asset'
  | 'Depreciation';

export interface LedgerVoucher {
  /** `<kind>:<source id>` for automatic vouchers, `mv:<id>` for manual ones. */
  id: string;
  source: 'auto' | 'manual';
  kind: LedgerVoucherKind;
  date: string;
  number: string;
  party: string;
  narration: string;
  lines: PostingLine[];
  /** In-app link to the source document, if it has a page. */
  link?: string;
  /** Manual voucher id (editable in the Vouchers tab). */
  manualId?: string;
}

export interface LedgerInput extends BooksData {
  userAccounts: Account[];
  manual: ManualVoucher[];
  assets: FixedAsset[];
  /** Local today, YYYY-MM-DD — depreciation is generated for every FY that has started by then. */
  today: string;
}

export interface Ledger {
  accounts: Account[];
  byId: Map<string, Account>;
  vouchers: LedgerVoucher[];
  warnings: string[];
}

/* ── Voucher builder ───────────────────────────────────────────── */

class Lines {
  readonly lines: PostingLine[] = [];
  /** `costCentre`: the source document's centre, stamped on every line unless a line names its own. */
  private readonly costCentre?: string;
  constructor(costCentre?: string) {
    this.costCentre = costCentre;
  }
  /** Debit `paise` (a negative amount becomes a credit). */
  dr(account: string, paise: number, party?: string, costCentre?: string): this {
    return this.add(account, paise, party, true, costCentre);
  }
  cr(account: string, paise: number, party?: string, costCentre?: string): this {
    return this.add(account, paise, party, false, costCentre);
  }
  private add(account: string, paise: number, party: string | undefined, debit: boolean, costCentre?: string): this {
    const p = Math.round(paise);
    if (p === 0) return this;
    const isDr = p > 0 ? debit : !debit;
    const amt = Math.abs(p);
    const cc = costCentre ?? this.costCentre;
    this.lines.push({ account, dr: isDr ? amt : 0, cr: isDr ? 0 : amt, ...(party ? { party } : {}), ...(cc ? { cost_centre: cc } : {}) });
    return this;
  }
  /** Signed imbalance: debits − credits. */
  diff(): number {
    return this.lines.reduce((s, l) => s + l.dr - l.cr, 0);
  }
  /** Post any residual to `account` so debits equal credits exactly. */
  balanceTo(account: string): this {
    const d = this.diff();
    return d > 0 ? this.cr(account, d) : d < 0 ? this.dr(account, -d) : this;
  }
}

export function voucherDiff(v: Pick<LedgerVoucher, 'lines'>): number {
  return v.lines.reduce((s, l) => s + l.dr - l.cr, 0);
}

const KIND_ORDER: Record<LedgerVoucherKind, number> = {
  Opening: 0,
  'Fixed Asset': 1,
  Sales: 2,
  'Debit Note': 3,
  Purchase: 4,
  Expense: 5,
  'Credit Note': 6,
  Receipt: 7,
  Payment: 8,
  Contra: 9,
  Journal: 10,
  Depreciation: 11,
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Split an invoice's items amount (paise, >= 0) over cost centres: each line goes to its own
 * `cost_centre_id`, else the document's. Shares follow each line's taxable value (exact to the
 * paisa — the largest share absorbs rounding). One entry when every line shares a centre.
 */
export function itemsByCostCentre(inv: InvoiceRecord, itemsPaise: number): Array<[string | undefined, number]> {
  const doc = str(inv.cost_centre_id) || undefined;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const ccOf = (i: (typeof items)[number]) => str(i?.cost_centre_id) || doc;
  const centres = new Set(items.map(ccOf));
  if (centres.size <= 1 || itemsPaise <= 0) return [[centres.size === 1 ? [...centres][0] : doc, itemsPaise]];
  const calc = calculateInvoice(calcInputFromRecord(inv));
  const taxableById = new Map(calc.lines.map((l) => [l.id, Math.abs(l.taxable)]));
  const weights = items.map((i) => taxableById.get(i.id) ?? 0);
  if (!weights.some((w) => w > 0)) return [[doc, itemsPaise]];
  const shares = allocateProportionally(weights, itemsPaise / 100).map((x) => toPaise(x));
  const out = new Map<string | undefined, number>();
  items.forEach((i, k) => out.set(ccOf(i), (out.get(ccOf(i)) ?? 0) + shares[k]));
  return [...out.entries()].filter(([, p]) => p !== 0);
}

/* ── Sales side ────────────────────────────────────────────────── */

function salesVoucher(inv: InvoiceRecord): LedgerVoucher | null {
  const sale = isSale(inv);
  if (!sale && !isCreditNote(inv)) return null;
  const date = toIsoDate(inv.issue_date);
  if (!date) return null;
  const a = invoiceAmounts(inv);
  const total = Math.abs(toPaise(a.total));
  if (total === 0) return null;
  const party = partyOfInvoice(inv);
  const debitNote = inv.doc_type === 'DEBIT_NOTE';
  const l = new Lines(str(inv.cost_centre_id) || undefined);
  // Sales: Dr party / Cr everything else. A credit note is the mirror image.
  const side = sale ? 1 : -1;
  l.dr(A.debtors, side * total, party);
  const items = Math.abs(toPaise(a.chargesTaxed ? a.taxable - a.charges : a.taxable));
  for (const [cc, p] of itemsByCostCentre(inv, items)) l.cr(sale ? A.sales : A.salesReturns, side * p, undefined, cc);
  l.cr(A.freightOut, side * Math.abs(toPaise(a.charges)));
  l.cr(A.outCgst, side * Math.abs(toPaise(a.cgst)));
  l.cr(A.outSgst, side * Math.abs(toPaise(a.sgst)));
  l.cr(A.outIgst, side * Math.abs(toPaise(a.igst)));
  l.cr(A.outGst, side * Math.abs(toPaise(a.otherTax)));
  l.cr(A.outCess, side * Math.abs(toPaise(a.cess)));
  l.cr(A.tcsPayable, side * Math.abs(toPaise(a.tcs)));
  l.balanceTo(A.roundOff);
  const kind: LedgerVoucherKind = !sale ? 'Credit Note' : debitNote ? 'Debit Note' : 'Sales';
  return {
    id: `${sale ? 'sale' : 'cn'}:${inv.id}`,
    source: 'auto',
    kind,
    date,
    number: str(inv.invoice_number),
    party,
    narration: [kind === 'Sales' ? 'Sales invoice' : kind, fxNarration(num(inv.total), inv)].filter(Boolean).join(' · '),
    lines: l.lines,
    link: `/invoice/${inv.id}`,
  };
}

/** Which receipt books the customer's TDS: the one that takes cumulative receipts past total − TDS. */
function tdsSettlements(invoices: InvoiceRecord[], transactions: Payment[]): Map<string, number> {
  const out = new Map<string, number>();
  const byId = new Map(invoices.filter((i) => isSale(i) && num(i.tds_amount) > 0).map((i) => [i.id, i]));
  const sorted = transactions
    .filter((t) => byId.has(t.invoice_id))
    .slice()
    .sort((a, b) => toIsoDate(a.date).localeCompare(toIsoDate(b.date)) || String(a.id).localeCompare(String(b.id)));
  const paid = new Map<string, number>();
  for (const t of sorted) {
    const inv = byId.get(t.invoice_id)!;
    const before = paid.get(inv.id) ?? 0;
    const after = before + Math.abs(toPaise(num(t.amount)));
    paid.set(inv.id, after);
    // Settlement is tracked in the document's currency; the TDS is booked in rupees.
    const tds = Math.min(Math.max(toPaise(num(inv.tds_amount)), 0), Math.abs(toPaise(num(inv.total))));
    const cashDue = Math.abs(toPaise(num(inv.total))) - tds;
    if (tds > 0 && before < cashDue && after >= cashDue) out.set(String(t.id), toPaise(inrValue(tds / 100, inv)));
  }
  return out;
}

function receiptVoucher(t: Payment, inv: InvoiceRecord | undefined, tds: number): LedgerVoucher | null {
  const date = toIsoDate(t.date);
  const amount = Math.abs(toPaise(inrValue(num(t.amount), inv)));
  if (!date || amount === 0) return null;
  const party = inv ? partyOfInvoice(inv) : 'Unknown customer';
  const cashAcc = accountForMethod(t.method) === 'cash' ? A.cash : A.bank;
  // Realised exchange difference (6.19): the bank gets the realised rupees, the debtor is
  // cleared at the invoice rate, the difference is a gain (Cr) or a loss (Dr).
  const fx = realisedFx(t, inv);
  const received = fx ? Math.abs(toPaise(fx.realisedInr)) : amount;
  const l = new Lines().dr(cashAcc, received);
  if (tds > 0) l.dr(A.tdsReceivable, tds);
  l.cr(A.debtors, amount + tds, party);
  if (fx) l.cr(A.fxGain, received - amount);
  const invNo = inv?.invoice_number || 'invoice';
  return {
    id: `rcpt:${t.id}`,
    source: 'auto',
    kind: 'Receipt',
    date,
    number: str(t.reference) || str(inv?.invoice_number),
    party,
    narration: [
      `Against ${invNo}`,
      str(t.method),
      tds > 0 && `TDS ${(tds / 100).toFixed(2)} withheld${str(inv?.tds_section) ? ` u/s ${str(inv?.tds_section)}` : ''}`,
      inv ? fxNarration(num(t.amount), inv) : '',
      fx && `realised @ ₹${fx.realisedRate} (exchange ${fx.gain >= 0 ? 'gain' : 'loss'} ${Math.abs(fx.gain).toFixed(2)})`,
    ]
      .filter(Boolean)
      .join(' · '),
    lines: l.lines,
    link: inv ? `/invoice/${inv.id}` : undefined,
  };
}

/* ── Purchase side ─────────────────────────────────────────────── */

function expenseAccountFor(isExpense: boolean, category: string, chart: Account[]): string {
  const cat = category.trim().toLowerCase();
  // A user account named exactly like the category wins, if it sits on the right side of gross profit.
  const own = cat ? chart.find((a) => !a.system && a.name.toLowerCase() === cat) : undefined;
  if (own) {
    const g = groupOf(own.group);
    if (g.nature === 'expense' && !!g.direct === !isExpense) return own.id;
  }
  if (!isExpense) return A.purchases;
  return EXPENSE_CATEGORY_ACCOUNTS[cat] ?? A.otherExp;
}

function purchaseVoucher(raw: BooksData['purchases'][number], vendors: BooksData['vendors'], chart: Account[]): LedgerVoucher | null {
  const n = normalizePurchase(raw, vendors);
  const c = readPurchase(raw, vendors);
  if (!n || !c) return null;
  const total = Math.abs(toPaise(n.total));
  if (total === 0) return null;
  const taxable = toPaise(n.taxable);
  const gst = toPaise(n.gst);
  const cgst = toPaise(n.cgst);
  const sgst = toPaise(n.sgst);
  const igst = gst - cgst - sgst;
  const party = n.party;
  const expAcc = expenseAccountFor(n.isExpense, n.category, chart);
  const l = new Lines(str(raw.cost_centre_id) || undefined);
  l.dr(expAcc, n.itcEligible ? taxable : taxable + gst);
  if (n.itcEligible) {
    l.dr(A.inCgst, cgst);
    l.dr(A.inSgst, sgst);
    l.dr(A.inIgst, igst);
  }
  // Tax we pay ourselves (reverse charge, imports) is owed to the government, not the supplier —
  // as long as the bill total actually includes it (an imported row may carry only the taxable value).
  const selfTax = (c.reverseCharge || c.importType !== '') && gst > 0 ? gst : 0;
  const totalIncludesTax = Math.abs(total - (taxable + gst)) <= Math.abs(total - taxable);
  const supplier = selfTax && totalIncludesTax ? total - selfTax : total;
  l.cr(A.creditors, supplier, party);
  if (selfTax) l.cr(c.importType === 'GOODS' ? A.importIgst : A.rcmPayable, selfTax);
  // ITC reversed against the bill (Rules 42/43/37 …): spread over the heads, charged to P&L.
  if (n.itcEligible && c.itcReversed > 0 && gst > 0) {
    const rev = Math.min(toPaise(c.itcReversed), gst);
    const [rc, rs, ri] = allocateProportionally([cgst, sgst, igst].map((p) => p / 100), rev / 100).map((x) => toPaise(x));
    l.dr(A.itcReversed, rc + rs + ri);
    l.cr(A.inCgst, rc);
    l.cr(A.inSgst, rs);
    l.cr(A.inIgst, ri);
  }
  l.balanceTo(A.roundOff);
  const tags = [
    n.category || (n.isExpense ? 'Expense' : 'Purchase'),
    c.reverseCharge && 'reverse charge',
    c.importType === 'GOODS' && 'import of goods',
    c.importType === 'SERVICES' && 'import of services (RCM)',
    gst > 0 && !n.itcEligible && 'ITC not claimed',
  ].filter(Boolean);
  return {
    id: `${n.isExpense ? 'exp' : 'pur'}:${n.id}`,
    source: 'auto',
    kind: n.isExpense ? 'Expense' : 'Purchase',
    date: n.date,
    number: n.number,
    party,
    narration: tags.join(' · '),
    lines: l.lines,
    link: '/expenses',
  };
}

function supplierPaymentVoucher(
  pp: BooksData['purchasePayments'][number],
  bill: { number: string; party: string } | undefined,
): LedgerVoucher | null {
  const date = toIsoDate(pp.date);
  const amount = Math.abs(toPaise(num(pp.amount)));
  if (!date || amount === 0) return null;
  const party = bill?.party ?? 'Unknown vendor';
  const cashAcc = accountForMethod(pp.method) === 'cash' ? A.cash : A.bank;
  return {
    id: `pay:${pp.id ?? `${pp.purchase_id}-${date}-${amount}`}`,
    source: 'auto',
    kind: 'Payment',
    date,
    number: str(pp.reference) || bill?.number || '',
    party,
    narration: [`Against ${bill?.number || 'bill'}`, str(pp.method)].filter(Boolean).join(' · '),
    lines: new Lines().dr(A.creditors, amount, party).cr(cashAcc, amount).lines,
    link: '/expenses',
  };
}

/* ── Fixed assets ──────────────────────────────────────────────── */

function assetVouchers(assets: FixedAsset[], today: string, byId: Map<string, Account>): LedgerVoucher[] {
  const out: LedgerVoucher[] = [];
  const depByFy = new Map<number, number>();
  for (const a of assets) {
    const cost = toPaise(a.cost);
    if (cost > 0 && a.paid_from && byId.has(a.paid_from) && byId.has(a.account_id)) {
      const party = a.paid_from === A.creditors ? a.party || 'Unknown vendor' : undefined;
      out.push({
        id: `fa:${a.id}`,
        source: 'auto',
        kind: 'Fixed Asset',
        date: a.acquired_on,
        number: '',
        party: party ?? '',
        narration: `Fixed asset: ${a.name}`,
        lines: new Lines().dr(a.account_id, cost).cr(a.paid_from, cost, party).lines,
      });
    }
    for (const r of depreciationSchedule(a, today)) depByFy.set(r.fyStartYear, (depByFy.get(r.fyStartYear) ?? 0) + r.depreciation);
  }
  for (const [fy, dep] of depByFy) {
    if (dep <= 0) continue;
    out.push({
      id: `dep:${fy}`,
      source: 'auto',
      kind: 'Depreciation',
      date: `${fy + 1}-03-31`,
      number: `DEP/${fyLabelOf(fy)}`,
      party: '',
      narration: `Depreciation for ${fyLabelOf(fy)} — Income-tax Act WDV rates`,
      lines: new Lines().dr(A.depreciation, dep).cr(A.accDep, dep).lines,
    });
  }
  return out;
}

/* ── Build ─────────────────────────────────────────────────────── */

export function manualToLedger(v: ManualVoucher): LedgerVoucher {
  const parties = v.lines.map((l) => l.party).filter(Boolean);
  return {
    id: `mv:${v.id}`,
    source: 'manual',
    kind: VOUCHER_TYPE_LABELS[v.type] as LedgerVoucherKind,
    date: v.date,
    number: v.number,
    party: parties[0] ?? '',
    narration: v.narration,
    lines: v.lines.map((l) => ({
      account: l.account_id,
      dr: l.dr,
      cr: l.cr,
      ...(l.party ? { party: l.party } : {}),
      ...(l.cost_centre_id ? { cost_centre: l.cost_centre_id } : {}),
    })),
    manualId: v.id,
  };
}

function sortVouchers(list: LedgerVoucher[]): LedgerVoucher[] {
  return list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.number.localeCompare(b.number) ||
      a.id.localeCompare(b.id),
  );
}

/** Every voucher (automatic + manual), checked to balance, sorted by date. */
export function buildLedger(input: LedgerInput): Ledger {
  const accounts = chartOf(input.userAccounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const warnings: string[] = [];
  const out: LedgerVoucher[] = [];
  const push = (v: LedgerVoucher | null) => {
    if (!v || !v.lines.length) return;
    if (voucherDiff(v) !== 0) {
      warnings.push(`${v.kind} ${v.number || v.id} does not balance and was left out.`);
      return;
    }
    const unknown = v.lines.find((l) => !byId.has(l.account));
    if (unknown) {
      warnings.push(`${v.kind} ${v.number || v.id} uses an unknown account (${unknown.account}) and was left out.`);
      return;
    }
    out.push(v);
  };

  const invById = new Map(input.invoices.map((i) => [i.id, i]));
  for (const inv of input.invoices) push(salesVoucher(inv));
  const tds = tdsSettlements(input.invoices, input.transactions);
  for (const t of input.transactions) push(receiptVoucher(t, invById.get(t.invoice_id), tds.get(String(t.id)) ?? 0));

  const bills = new Map<string, { number: string; party: string }>();
  for (const raw of input.purchases) {
    const v = purchaseVoucher(raw, input.vendors, accounts);
    const n = v ? normalizePurchase(raw, input.vendors) : null;
    if (n) bills.set(n.id, { number: n.number, party: n.party });
    push(v);
  }
  for (const pp of input.purchasePayments) push(supplierPaymentVoucher(pp, bills.get(str(pp.purchase_id))));
  for (const v of assetVouchers(input.assets, input.today, byId)) push(v);
  for (const m of input.manual) push(manualToLedger(m));

  // Openings from the Books "opening balance" dialog: the cash/bank balance AT THE START of
  // `as_of` is what the user typed, whatever came before (same rule as the Books cash book).
  const openings = [...input.openings].filter((o) => o.as_of).sort((a, b) => a.as_of.localeCompare(b.as_of));
  for (const o of openings) {
    const acc = o.account === 'cash' ? A.cash : A.bank;
    let before = 0;
    for (const v of out) {
      if (v.date >= o.as_of) continue;
      for (const l of v.lines) if (l.account === acc) before += l.dr - l.cr;
    }
    const adj = toPaise(num(o.amount)) - before;
    push({
      id: `open:${o.id}`,
      source: 'auto',
      kind: 'Opening',
      date: o.as_of,
      number: '',
      party: '',
      narration: `Opening ${o.account === 'cash' ? 'cash in hand' : 'bank balance'} ${num(o.amount).toFixed(2)} as entered in Books${before ? ' (adjusted for earlier entries)' : ''}`,
      lines: new Lines().dr(acc, adj).cr(A.openingDiff, adj).lines,
    });
  }

  return { accounts, byId, vouchers: sortVouchers(out), warnings };
}
