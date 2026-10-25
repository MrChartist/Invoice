/**
 * Tally Prime import XML generator — pure, deterministic, no browser APIs.
 *
 * Output is the standard "Import Data" envelope:
 *
 *   ENVELOPE
 *     HEADER  (VERSION 1, TALLYREQUEST Import, TYPE Data, ID <report>)
 *     BODY
 *       DESC  (STATICVARIABLES: SVCURRENTCOMPANY)
 *       DATA  (TALLYMESSAGE × n)
 *
 * Sign convention (Tally's, easy to get backwards):
 *   - A DEBIT entry has ISDEEMEDPOSITIVE=Yes and a NEGATIVE amount.
 *   - A CREDIT entry has ISDEEMEDPOSITIVE=No and a POSITIVE amount.
 *   - Every voucher's ledger amounts therefore sum to exactly 0.
 *
 * Voucher shapes:
 *   Sales        Dr Party | Cr Sales, Cr Output CGST/SGST/IGST, Cr charges, ± Round Off
 *   Credit Note  Cr Party | Dr Sales, Dr Output taxes, ... (mirror of Sales)
 *   Receipt      Dr Bank/Cash [+ Dr TDS Receivable on the settling receipt] | Cr Party (bill allocation "Agst Ref" the invoice)
 *   Purchase     Cr Party | Dr Purchases, Dr Input CGST/SGST/IGST, ± Round Off
 *   Advance      Receipt: Dr Bank/Cash | Cr Party (bill allocation "Advance", the ADV/… number);
 *                refund: Payment: Dr Party ("Agst Ref" the ADV number) | Cr Bank/Cash. Applying an
 *                advance to an invoice is bill-wise matching inside Tally, so no voucher is sent for
 *                it; GST on advances (Tally's advance receipt / stat adjustment) is not exported (5.3).
 *
 * Any difference between the invoice's stored total and the sum of its
 * component amounts (rounding, legacy rows) is posted to the Round Off ledger,
 * so a voucher can never be rejected by Tally as "Debit and Credit totals differ".
 *
 * Taxable freight (`charges_taxable`): the charges go to the charges ledger and their
 * GST into the same output-tax ledgers; Sales gets only the items' taxable value.
 * Foreign-currency documents are posted in rupees at the invoice's exchange rate
 * (receipts too — realised exchange gain/loss is not computed; post it in Tally).
 * Working papers: verify with your CA before importing.
 */

import type { InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { fxNarration, inrTotals, inrValue } from './fx';
import { receivableTotal } from './rcm';
import { advanceMovements } from './advance-tax';
import { debitNoteVouchers } from './tally-debit-notes';
import {
  clean,
  emptySource,
  filterInvoices,
  filterPayments,
  filterPurchases,
  fixed2,
  invoiceAmounts,
  invoiceStateCode,
  isoDate,
  partyNameOf,
  stateNameOf,
  toPaise,
  voucherKindOf,
  type DateRange,
  type ExportSource,
} from './export-shared';

/* ── XML primitives ───────────────────────────────────────────── */

/** Remove characters that are illegal in XML 1.0 documents. */
export function stripIllegalXmlChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    const ok =
      c === 0x9 ||
      c === 0xa ||
      c === 0xd ||
      (c >= 0x20 && c <= 0xd7ff) ||
      (c >= 0xe000 && c <= 0xfffd) ||
      (c >= 0x10000 && c <= 0x10ffff);
    if (ok) out += ch;
  }
  return out;
}

/** Strip illegal characters, then escape the five XML specials. */
export function escapeXml(input: unknown): string {
  return stripIllegalXmlChars(String(input ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' (Tally's date format). */
export function tallyDate(iso: string): string {
  return isoDate(iso).replace(/-/g, '');
}

/** Tally amount text: 2dp, '-' for debit. Paise are integers. */
export function tallyAmount(paise: number): string {
  const v = paise === 0 ? 0 : paise / 100;
  return v.toFixed(2);
}

type Lines = string[];

function el(name: string, content: string | Lines, attrs: Record<string, string> = {}): Lines {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  if (typeof content === 'string') return [`<${name}${a}>${escapeXml(content)}</${name}>`];
  if (!content.length) return [`<${name}${a}/>`];
  return [`<${name}${a}>`, ...content.map((l) => `  ${l}`), `</${name}>`];
}

/** Flatten helper: concatenates line groups. */
const cat = (...groups: Lines[]): Lines => groups.flat();
const yn = (b: boolean) => (b ? 'Yes' : 'No');

/* ── Options ──────────────────────────────────────────────────── */

export interface TallyOptions {
  /** Must match the company name open in Tally exactly (SVCURRENTCOMPANY). */
  companyName: string;
  range?: DateRange;
  includeDrafts?: boolean;
  /** Emit item lines as stock-item inventory entries (needs stock items in Tally). */
  includeInventory?: boolean;
  includeReceipts?: boolean;
  includePurchases?: boolean;

  salesLedger?: string;
  /** Ledger debited on a credit note. Defaults to the sales ledger. */
  creditNoteLedger?: string;
  otherChargesLedger?: string;
  roundOffLedger?: string;
  purchaseLedger?: string;
  bankLedger?: string;
  cashLedger?: string;
  outputCgst?: string;
  outputSgst?: string;
  outputIgst?: string;
  /** Used for legacy single-line tax with no CGST/SGST/IGST split. */
  outputGst?: string;
  /** GST cess collected on sales (Duties & Taxes). */
  outputCess?: string;
  /** TCS collected from the customer (a liability, never income). */
  tcsLedger?: string;
  /** TDS the customer withheld (an asset claimed against your income tax). */
  tdsLedger?: string;
  inputCgst?: string;
  inputSgst?: string;
  inputIgst?: string;
  /** GST we owe under reverse charge on purchases / imports of services (Duties & Taxes). */
  rcmPayableLedger?: string;
  /** IGST on imported goods, paid at customs with the Bill of Entry (Duties & Taxes). */
  customsIgstLedger?: string;
}

export const DEFAULT_LEDGER_NAMES = {
  salesLedger: 'Sales',
  otherChargesLedger: 'Freight and Other Charges',
  roundOffLedger: 'Round Off',
  purchaseLedger: 'Purchases',
  bankLedger: 'Bank Account',
  cashLedger: 'Cash',
  outputCgst: 'Output CGST',
  outputSgst: 'Output SGST',
  outputIgst: 'Output IGST',
  outputGst: 'Output GST',
  outputCess: 'Output Cess',
  tcsLedger: 'TCS Payable',
  tdsLedger: 'TDS Receivable',
  inputCgst: 'Input CGST',
  inputSgst: 'Input SGST',
  inputIgst: 'Input IGST',
  rcmPayableLedger: 'GST Payable on Reverse Charge',
  customsIgstLedger: 'IGST Payable on Imports',
} as const;

type ResolvedOptions = Required<Omit<TallyOptions, 'range'>> & { range: DateRange };

function resolveOptions(o: TallyOptions): ResolvedOptions {
  const n = (v: string | undefined, d: string) => clean(v) || d;
  const salesLedger = n(o.salesLedger, DEFAULT_LEDGER_NAMES.salesLedger);
  return {
    companyName: clean(o.companyName),
    range: o.range ?? {},
    includeDrafts: !!o.includeDrafts,
    includeInventory: !!o.includeInventory,
    includeReceipts: o.includeReceipts !== false,
    includePurchases: o.includePurchases !== false,
    salesLedger,
    creditNoteLedger: n(o.creditNoteLedger, salesLedger),
    otherChargesLedger: n(o.otherChargesLedger, DEFAULT_LEDGER_NAMES.otherChargesLedger),
    roundOffLedger: n(o.roundOffLedger, DEFAULT_LEDGER_NAMES.roundOffLedger),
    purchaseLedger: n(o.purchaseLedger, DEFAULT_LEDGER_NAMES.purchaseLedger),
    bankLedger: n(o.bankLedger, DEFAULT_LEDGER_NAMES.bankLedger),
    cashLedger: n(o.cashLedger, DEFAULT_LEDGER_NAMES.cashLedger),
    outputCgst: n(o.outputCgst, DEFAULT_LEDGER_NAMES.outputCgst),
    outputSgst: n(o.outputSgst, DEFAULT_LEDGER_NAMES.outputSgst),
    outputIgst: n(o.outputIgst, DEFAULT_LEDGER_NAMES.outputIgst),
    outputGst: n(o.outputGst, DEFAULT_LEDGER_NAMES.outputGst),
    outputCess: n(o.outputCess, DEFAULT_LEDGER_NAMES.outputCess),
    tcsLedger: n(o.tcsLedger, DEFAULT_LEDGER_NAMES.tcsLedger),
    tdsLedger: n(o.tdsLedger, DEFAULT_LEDGER_NAMES.tdsLedger),
    inputCgst: n(o.inputCgst, DEFAULT_LEDGER_NAMES.inputCgst),
    inputSgst: n(o.inputSgst, DEFAULT_LEDGER_NAMES.inputSgst),
    inputIgst: n(o.inputIgst, DEFAULT_LEDGER_NAMES.inputIgst),
    rcmPayableLedger: n(o.rcmPayableLedger, DEFAULT_LEDGER_NAMES.rcmPayableLedger),
    customsIgstLedger: n(o.customsIgstLedger, DEFAULT_LEDGER_NAMES.customsIgstLedger),
  };
}

/* ── Voucher model (pure data — what the tests assert on) ─────── */

export type TallyVoucherType = 'Sales' | 'Credit Note' | 'Receipt' | 'Purchase' | 'Payment' | 'Debit Note';
export type Side = 'Dr' | 'Cr';

export interface TallyEntry {
  ledger: string;
  side: Side;
  /** Always positive, integer paise. */
  paise: number;
  /** Bill allocation (party ledgers only). */
  bill?: { name: string; type: 'New Ref' | 'Agst Ref' | 'Advance' };
}

export interface TallyInventoryLine {
  item: string;
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  gstRate: number;
  /** Taxable amount in paise; lines sum to the voucher's sales/purchase entry. */
  paise: number;
}

export interface TallyVoucher {
  type: TallyVoucherType;
  date: string; // YYYY-MM-DD
  number: string;
  party: string;
  partyGstin: string;
  stateName: string;
  narration: string;
  reference: string;
  entries: TallyEntry[];
  inventory: TallyInventoryLine[];
  /** Ledger name of the entry the inventory lines allocate to. */
  inventoryLedger: string;
}

/** Signed paise: debit negative, credit positive. */
export const signedPaise = (e: TallyEntry): number => (e.side === 'Cr' ? e.paise : -e.paise);

/** Sum of signed entry amounts in paise — 0 for a balanced voucher. */
export function voucherImbalance(v: TallyVoucher): number {
  return v.entries.reduce((s, e) => s + signedPaise(e), 0);
}

interface LedgerDef {
  name: string;
  parent: string;
  gstin?: string;
  stateName?: string;
  address?: string[];
  pincode?: string;
  email?: string;
  phone?: string;
  duty?: 'Central Tax' | 'State Tax' | 'Integrated Tax' | 'Cess';
  billwise?: boolean;
}

export interface TallyBuild {
  vouchers: TallyVoucher[];
  ledgers: LedgerDef[];
  stockItems: Array<{ name: string; unit: string; hsn: string; gstRate: number }>;
  warnings: string[];
}

export interface TallyCounts {
  ledgers: number;
  stockItems: number;
  sales: number;
  creditNotes: number;
  receipts: number;
  purchases: number;
}

/** Push an entry; zero amounts are dropped. */
function push(entries: TallyEntry[], ledger: string, side: Side, paise: number, bill?: TallyEntry['bill']) {
  if (paise <= 0) return;
  entries.push({ ledger, side, paise, ...(bill ? { bill } : {}) });
}

/**
 * Post any residual to the Round Off ledger so debits == credits exactly.
 * Returns the (signed, credit-positive) residual that was absorbed.
 */
function balanceWithRoundOff(entries: TallyEntry[], roundOffLedger: string): number {
  const net = entries.reduce((s, e) => s + signedPaise(e), 0);
  if (net > 0) entries.push({ ledger: roundOffLedger, side: 'Dr', paise: net });
  else if (net < 0) entries.push({ ledger: roundOffLedger, side: 'Cr', paise: -net });
  return net;
}

function lineItems(inv: InvoiceRecord): TallyInventoryLine[] {
  const items: InvoiceItem[] = Array.isArray(inv.items) ? inv.items : [];
  if (!items.length) return [];
  try {
    const calc = inrTotals(
      calculateInvoice(calcInputFromRecord(inv, { round_off_enabled: false, round_mode: 'none', amount_paid: 0 })),
      inv,
    );
    return calc.lines
      .filter((l) => clean(l.name))
      .map((l) => ({
        item: clean(l.name),
        hsn: clean(l.hsn),
        unit: clean(l.unit).toUpperCase() || 'NOS',
        qty: num(l.quantity),
        rate: num(l.rate),
        gstRate: num(l.tax_rate),
        paise: toPaise(l.taxable),
      }));
  } catch {
    return [];
  }
}

/** Build the neutral voucher/master model that both XML emitters render. */
export function buildTallyModel(source: ExportSource, options: TallyOptions): TallyBuild {
  const o = resolveOptions(options);
  const warnings: string[] = [];
  const vouchers: TallyVoucher[] = [];
  const ledgerMap = new Map<string, LedgerDef>();
  const stockMap = new Map<string, { name: string; unit: string; hsn: string; gstRate: number }>();

  const addLedger = (def: LedgerDef) => {
    const prev = ledgerMap.get(def.name);
    ledgerMap.set(def.name, prev ? { ...prev, ...stripEmpty(def) } : def);
  };
  const std = (name: string, parent: string, duty?: LedgerDef['duty']) =>
    addLedger({ name, parent, ...(duty ? { duty } : {}) });

  const registerParty = (inv: InvoiceRecord, name: string) => {
    const c = inv.client ?? ({} as InvoiceRecord['client']);
    const code = invoiceStateCode(inv);
    addLedger({
      name,
      parent: 'Sundry Debtors',
      billwise: true,
      gstin: clean(c.gstin).toUpperCase(),
      stateName: stateNameOf(code),
      address: [clean(c.address), clean(c.city)].filter(Boolean),
      pincode: clean(c.zip),
      email: clean(c.email),
      phone: clean(c.phone),
    });
  };

  const invoices = filterInvoices(source.invoices, o.range, o.includeDrafts);
  const taxLedgers = (inv: InvoiceRecord, a: ReturnType<typeof invoiceAmounts>, credit: boolean, entries: TallyEntry[]) => {
    const side: Side = credit ? 'Dr' : 'Cr';
    void inv;
    push(entries, o.outputCgst, side, toPaise(a.cgst));
    push(entries, o.outputSgst, side, toPaise(a.sgst));
    push(entries, o.outputIgst, side, toPaise(a.igst));
    push(entries, o.outputGst, side, toPaise(a.otherTax));
  };

  /* Sales + credit notes */
  for (const inv of invoices) {
    const kind = voucherKindOf(inv, o.includeDrafts)!;
    const credit = kind === 'CREDIT_NOTE';
    const a = invoiceAmounts(inv);
    const total = Math.abs(toPaise(a.total));
    if (total === 0) continue;
    const number = clean(inv.invoice_number) || String(inv.id);
    const party = partyNameOf(inv.client);
    registerParty(inv, party);

    const inventory = o.includeInventory ? lineItems(inv) : [];
    const salesLedger = credit ? o.creditNoteLedger : o.salesLedger;
    const entries: TallyEntry[] = [];
    const abs = (n: number) => Math.abs(n);
    const absA = {
      ...a,
      cgst: abs(a.cgst),
      sgst: abs(a.sgst),
      igst: abs(a.igst),
      otherTax: abs(a.otherTax),
    };

    // Party: Dr on a sale, Cr on a credit note.
    push(entries, party, credit ? 'Cr' : 'Dr', total, { name: number, type: 'New Ref' });
    const taxable = inventory.length
      ? inventory.reduce((s, l) => s + l.paise, 0)
      : Math.abs(toPaise(a.chargesTaxed ? round2(a.taxable - a.charges) : a.taxable));
    push(entries, salesLedger, credit ? 'Dr' : 'Cr', taxable);
    taxLedgers(inv, absA, credit, entries);
    push(entries, o.otherChargesLedger, credit ? 'Dr' : 'Cr', Math.abs(toPaise(a.charges)));
    // Cess and TCS get their own ledgers: left out they would be swallowed by Round Off.
    push(entries, o.outputCess, credit ? 'Dr' : 'Cr', Math.abs(toPaise(a.cess)));
    push(entries, o.tcsLedger, credit ? 'Dr' : 'Cr', Math.abs(toPaise(a.tcs)));
    balanceWithRoundOff(entries, o.roundOffLedger);

    std(salesLedger, 'Sales Accounts');
    std(o.otherChargesLedger, 'Sales Accounts');
    std(o.roundOffLedger, 'Indirect Expenses');
    std(o.outputCgst, 'Duties & Taxes', 'Central Tax');
    std(o.outputSgst, 'Duties & Taxes', 'State Tax');
    std(o.outputIgst, 'Duties & Taxes', 'Integrated Tax');
    if (a.otherTax > 0) std(o.outputGst, 'Duties & Taxes');
    if (a.cess > 0) std(o.outputCess, 'Duties & Taxes', 'Cess');
    if (a.tcs > 0) std(o.tcsLedger, 'Duties & Taxes');
    for (const l of inventory) {
      if (!stockMap.has(l.item)) stockMap.set(l.item, { name: l.item, unit: l.unit, hsn: l.hsn, gstRate: l.gstRate });
    }

    vouchers.push({
      type: credit ? 'Credit Note' : 'Sales',
      date: isoDate(inv.issue_date),
      number,
      party,
      partyGstin: clean(inv.client?.gstin).toUpperCase(),
      stateName: stateNameOf(invoiceStateCode(inv)),
      narration: [
        clean(inv.po_number) && `PO: ${clean(inv.po_number)}`,
        fxNarration(num(inv.total), inv),
        // Outward reverse charge: no output-tax ledger, the recipient pays the GST (Rule 46(p)).
        a.rcmTax > 0 && `Reverse charge: GST ${a.rcmTax.toFixed(2)} payable by the recipient`,
      ].filter(Boolean).join(' | '),
      reference: clean(inv.po_number),
      entries,
      inventory,
      inventoryLedger: salesLedger,
    });
  }

  /* Receipts */
  if (o.includeReceipts) {
    const sales = source.invoices.filter((i) => voucherKindOf(i, true) === 'SALES');
    const byId = new Map(sales.map((i) => [i.id, i]));
    // Stable per-invoice sequence over ALL payments so numbers don't shift with the date filter.
    const seq = new Map<string, number>();
    const allSorted = filterPayments(source.payments, sales, {});
    const seqOf = new Map<Payment, number>();
    for (const p of allSorted) {
      const n = (seq.get(p.invoice_id) ?? 0) + 1;
      seq.set(p.invoice_id, n);
      seqOf.set(p, n);
    }
    const paidRows = new Map<string, number>();
    // TDS the customer withheld is settled on the receipt that clears the cash due (total - TDS):
    // Dr TDS Receivable / Cr Party, so the party ledger closes in Tally.
    const tdsOn = new Map<Payment, number>();
    for (const p of allSorted) {
      const before = paidRows.get(p.invoice_id) ?? 0;
      const after = before + toPaise(p.amount);
      paidRows.set(p.invoice_id, after);
      const inv = byId.get(p.invoice_id)!;
      // Settlement is tracked in the document's currency; the TDS is posted in rupees.
      const tds = Math.min(Math.max(toPaise(inv.tds_amount ?? 0), 0), toPaise(receivableTotal(inv)));
      const cashDue = toPaise(receivableTotal(inv)) - tds;
      if (tds > 0 && before < cashDue && after >= cashDue) tdsOn.set(p, toPaise(inrValue(tds / 100, inv)));
    }

    for (const p of allSorted) {
      if (p.advance_id && tdsOn.has(p)) {
        const inv = byId.get(p.invoice_id)!;
        warnings.push(`${clean(inv.invoice_number) || inv.id}: the customer's TDS is settled by an advance adjustment, which has no voucher here — post the TDS journal in Tally.`);
      }
    }
    for (const p of filterPayments(source.payments, sales, o.range)) {
      // Applying an advance (5.3) is bill-wise matching in Tally: the money came in on the advance.
      if (p.advance_id) continue;
      const inv = byId.get(p.invoice_id)!;
      const party = partyNameOf(inv.client);
      registerParty(inv, party);
      const isCash = /^\s*cash\s*$/i.test(String(p.method ?? ''));
      const bank = isCash ? o.cashLedger : o.bankLedger;
      std(bank, isCash ? 'Cash-in-Hand' : 'Bank Accounts');
      const paise = toPaise(inrValue(num(p.amount), inv));
      const invNo = clean(inv.invoice_number) || String(inv.id);
      const entries: TallyEntry[] = [];
      push(entries, bank, 'Dr', paise);
      const tds = tdsOn.get(p) ?? 0;
      if (tds > 0) {
        std(o.tdsLedger, 'Current Assets');
        push(entries, o.tdsLedger, 'Dr', tds);
      }
      push(entries, party, 'Cr', paise + tds, { name: invNo, type: 'Agst Ref' });
      vouchers.push({
        type: 'Receipt',
        date: isoDate(p.date),
        number: `${invNo}/R${seqOf.get(p) ?? 1}`,
        party,
        partyGstin: '',
        stateName: '',
        narration: [
          clean(p.method),
          clean(p.reference) && `Ref ${clean(p.reference)}`,
          `Against ${invNo}`,
          tds > 0 && `TDS ${fixed2(tds / 100)} withheld${clean(inv.tds_section) ? ` u/s ${clean(inv.tds_section)}` : ''}`,
          fxNarration(num(p.amount), inv),
        ]
          .filter(Boolean)
          .join(' | '),
        reference: clean(p.reference),
        entries,
        inventory: [],
        inventoryLedger: '',
      });
    }
    // Advance receipts and refunds (5.3), dated in range.
    for (const m of advanceMovements(source.advances ?? [], source.payments, source.invoices)) {
      if (m.kind === 'adjusted') continue;
      if ((o.range.from && m.date < o.range.from) || (o.range.to && m.date > o.range.to)) continue;
      const adv = (source.advances ?? []).find((a) => a.id === m.advanceId);
      const party = partyNameOf(adv?.client);
      addLedger({
        name: party,
        parent: 'Sundry Debtors',
        billwise: true,
        gstin: clean(adv?.client?.gstin).toUpperCase(),
        stateName: stateNameOf(adv?.client?.state_code || adv?.place_of_supply || ''),
        address: [clean(adv?.client?.address)].filter(Boolean),
        email: clean(adv?.client?.email),
      });
      const isCash = /^\s*cash\s*$/i.test(String(m.method ?? ''));
      const bank = isCash ? o.cashLedger : o.bankLedger;
      std(bank, isCash ? 'Cash-in-Hand' : 'Bank Accounts');
      const paise = toPaise(m.gross);
      const entries: TallyEntry[] = [];
      const received = m.kind === 'received';
      if (received) {
        push(entries, bank, 'Dr', paise);
        push(entries, party, 'Cr', paise, { name: m.number, type: 'Advance' });
      } else {
        push(entries, party, 'Dr', paise, { name: m.number, type: 'Agst Ref' });
        push(entries, bank, 'Cr', paise);
      }
      vouchers.push({
        type: received ? 'Receipt' : 'Payment',
        date: m.date,
        number: received ? m.number : m.ref || m.number,
        party,
        partyGstin: '',
        stateName: '',
        narration: [
          received ? 'Advance received' : `Refund of advance ${m.number}`,
          clean(m.method),
          m.taxed && `GST on advance ${fixed2(round2(m.igst + m.cgst + m.sgst))} (not posted: record it in Tally)`,
        ].filter(Boolean).join(' | '),
        reference: received ? clean(adv?.reference) : '',
        entries,
        inventory: [],
        inventoryLedger: '',
      });
    }
    for (const inv of invoices) {
      if (voucherKindOf(inv, true) !== 'SALES') continue;
      const rows = paidRows.get(inv.id) ?? 0;
      if (toPaise(inv.amount_paid) > rows) {
        warnings.push(
          `${clean(inv.invoice_number) || inv.id}: amount paid ${fixed2(inv.amount_paid)} is higher than its recorded payments (${fixed2(rows / 100)}) — the difference has no Receipt voucher.`,
        );
      }
    }
  }

  /* Purchases */
  if (o.includePurchases) {
    for (const p of filterPurchases(source.purchases, source.vendors, o.range)) {
      const total = Math.abs(toPaise(p.total));
      if (total === 0) continue;
      const entries: TallyEntry[] = [];
      // Reverse charge / imports: the supplier is owed only what it billed; the GST we pay ourselves
      // goes to its own Duties & Taxes ledger (as the in-app ledger does: 2310 / 2311).
      const selfTax = Math.abs(toPaise(p.selfTax));
      const selfLedger = p.selfTaxKind === 'CUSTOMS' ? o.customsIgstLedger : o.rcmPayableLedger;
      push(entries, p.partyName, 'Cr', Math.abs(toPaise(p.payable)), { name: p.number || p.id || p.partyName, type: 'New Ref' });
      if (selfTax > 0) {
        push(entries, selfLedger, 'Cr', selfTax);
        std(selfLedger, 'Duties & Taxes');
      }
      // TDS deducted on booking the bill: owed to the government, one Duties & Taxes ledger per section.
      const tds = Math.abs(toPaise(p.tds));
      if (tds > 0) {
        const tdsLedger = `TDS Payable ${(p.tdsSection || '').replace(/-.*/, '')}`.trim();
        push(entries, tdsLedger, 'Cr', tds);
        std(tdsLedger, 'Duties & Taxes');
      }
      // GST on a bill whose ITC is blocked is part of the cost, never an "Input" credit.
      push(entries, o.purchaseLedger, 'Dr', Math.abs(toPaise(p.itcEligible ? p.taxable : round2(p.taxable + p.tax))));
      if (p.itcEligible) {
        push(entries, o.inputCgst, 'Dr', Math.abs(toPaise(p.cgst)));
        push(entries, o.inputSgst, 'Dr', Math.abs(toPaise(p.sgst)));
        push(entries, o.inputIgst, 'Dr', Math.abs(toPaise(round2(p.tax - p.cgst - p.sgst))));
      }
      balanceWithRoundOff(entries, o.roundOffLedger);
      addLedger({
        name: p.partyName,
        parent: 'Sundry Creditors',
        billwise: true,
        gstin: p.partyGstin,
        stateName: stateNameOf(p.stateCode),
      });
      std(o.purchaseLedger, 'Purchase Accounts');
      std(o.roundOffLedger, 'Indirect Expenses');
      std(o.inputCgst, 'Duties & Taxes', 'Central Tax');
      std(o.inputSgst, 'Duties & Taxes', 'State Tax');
      std(o.inputIgst, 'Duties & Taxes', 'Integrated Tax');
      vouchers.push({
        type: 'Purchase',
        date: p.date,
        number: p.number || p.id,
        party: p.partyName,
        partyGstin: p.partyGstin,
        stateName: stateNameOf(p.stateCode),
        narration: p.notes,
        reference: p.number,
        entries,
        inventory: [],
        inventoryLedger: '',
      });
    }
    vouchers.push(...debitNoteVouchers(source.purchaseReturns, o, addLedger)); // WP-3: purchase returns (tally-debit-notes.ts)
  }

  // Only keep tax/std ledgers that vouchers actually use.
  const used = new Set(vouchers.flatMap((v) => v.entries.map((e) => e.ledger)));
  const ledgers = [...ledgerMap.values()]
    .filter((l) => used.has(l.name))
    .sort((a, b) => a.parent.localeCompare(b.parent) || a.name.localeCompare(b.name));
  const stockItems = [...stockMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const typeOrder: Record<TallyVoucherType, number> = { Sales: 0, 'Credit Note': 1, Purchase: 2, 'Debit Note': 2.5, Receipt: 3, Payment: 4 };
  vouchers.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      typeOrder[a.type] - typeOrder[b.type] ||
      a.number.localeCompare(b.number),
  );
  return { vouchers, ledgers, stockItems, warnings };
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function countTally(build: TallyBuild): TallyCounts {
  const c = (t: TallyVoucherType) => build.vouchers.filter((v) => v.type === t).length;
  return {
    ledgers: build.ledgers.length,
    stockItems: build.stockItems.length,
    sales: c('Sales'),
    creditNotes: c('Credit Note'),
    receipts: c('Receipt'),
    purchases: c('Purchase'),
  };
}

/* ── XML rendering ────────────────────────────────────────────── */

function gstRegType(gstin: string): string {
  return gstin.length === 15 ? 'Regular' : 'Unregistered/Consumer';
}

function ledgerNameList(name: string): Lines {
  return el('LANGUAGENAME.LIST', [...el('NAME.LIST', el('NAME', name), { TYPE: 'String' }), ...el('LANGUAGEID', '1033')]);
}

function ledgerXml(l: LedgerDef): Lines {
  const body: Lines = [];
  body.push(...el('PARENT', l.parent));
  body.push(...el('ISBILLWISEON', yn(!!l.billwise)));
  body.push(...el('ISCOSTCENTRESON', 'No'));
  if (l.duty) {
    body.push(...el('TAXTYPE', 'GST'));
    body.push(...el('GSTDUTYHEAD', l.duty));
    body.push(...el('GSTTYPE', 'Duty'));
  }
  if (l.parent === 'Sundry Debtors' || l.parent === 'Sundry Creditors') {
    const gstin = l.gstin ?? '';
    if (l.address?.length) {
      body.push(
        ...el('LEDMAILINGDETAILS.LIST', [
          ...el('ADDRESS.LIST', l.address.map((a) => `<ADDRESS>${escapeXml(a)}</ADDRESS>`), { TYPE: 'String' }),
          ...el('APPLICABLEFROM', '20170701'),
          ...(l.pincode ? el('PINCODE', l.pincode) : []),
          ...el('MAILINGNAME', l.name),
          ...(l.stateName ? el('STATE', l.stateName) : []),
          ...el('COUNTRY', 'India'),
        ]),
      );
    }
    body.push(...el('COUNTRYNAME', 'India'));
    body.push(
      ...el('LEDGSTREGDETAILS.LIST', [
        ...el('APPLICABLEFROM', '20170701'),
        ...el('GSTREGISTRATIONTYPE', gstRegType(gstin)),
        ...(l.stateName ? el('PLACEOFSUPPLY', l.stateName) : []),
        ...(gstin ? el('GSTIN', gstin) : []),
      ]),
    );
    if (gstin) body.push(...el('PARTYGSTIN', gstin));
    if (gstin.length === 15) body.push(...el('INCOMETAXNUMBER', gstin.slice(2, 12)));
    if (l.stateName) body.push(...el('LEDSTATENAME', l.stateName));
    body.push(...el('GSTREGISTRATIONTYPE', gstRegType(gstin)));
    if (l.email) body.push(...el('EMAIL', l.email));
    if (l.phone) body.push(...el('LEDGERPHONE', l.phone));
  }
  body.push(...ledgerNameList(l.name));
  return el('TALLYMESSAGE', el('LEDGER', body, { NAME: l.name, ACTION: 'Create' }), { 'xmlns:UDF': 'TallyUDF' });
}

function unitXml(name: string): Lines {
  return el(
    'TALLYMESSAGE',
    el('UNIT', [...el('NAME', name), ...el('ISSIMPLEUNIT', 'Yes')], { NAME: name, ACTION: 'Create' }),
    { 'xmlns:UDF': 'TallyUDF' },
  );
}

function stockItemXml(s: TallyBuild['stockItems'][number], applicableFrom: string): Lines {
  const half = round2(s.gstRate / 2);
  const rate = (head: string, r: number) =>
    el('RATEDETAILS.LIST', [...el('GSTRATEDUTYHEAD', head), ...el('GSTRATE', String(r))]);
  const body: Lines = [
    ...el('PARENT', ''),
    ...el('BASEUNITS', s.unit),
    ...el('GSTAPPLICABLE', 'Applicable'),
    ...(s.hsn
      ? el('HSNDETAILS.LIST', [
          ...el('APPLICABLEFROM', applicableFrom),
          ...el('HSNCODE', s.hsn),
          ...el('SRCOFHSNDETAILS', 'Specify Details Here'),
        ])
      : []),
    ...el('GSTDETAILS.LIST', [
      ...el('APPLICABLEFROM', applicableFrom),
      ...el('TAXABILITY', s.gstRate > 0 ? 'Taxable' : 'Nil Rated'),
      ...el('SRCOFGSTDETAILS', 'Specify Details Here'),
      ...el('STATEWISEDETAILS.LIST', [
        ...el('STATENAME', 'Any'),
        ...rate('Central Tax', half),
        ...rate('State Tax', half),
        ...rate('Integrated Tax', s.gstRate),
      ]),
    ]),
    ...el('NAME.LIST', el('NAME', s.name), { TYPE: 'String' }),
  ];
  return el('TALLYMESSAGE', el('STOCKITEM', body, { NAME: s.name, ACTION: 'Create' }), { 'xmlns:UDF': 'TallyUDF' });
}

function entryXml(e: TallyEntry, tag = 'ALLLEDGERENTRIES.LIST', withBills = true): Lines {
  const debit = e.side === 'Dr';
  const body: Lines = [
    ...el('LEDGERNAME', e.ledger),
    ...el('ISDEEMEDPOSITIVE', yn(debit)),
    ...el('LEDGERFROMITEM', 'No'),
    ...el('REMOVEZEROENTRIES', 'No'),
    ...el('ISPARTYLEDGER', yn(!!e.bill)),
    ...el('AMOUNT', tallyAmount(debit ? -e.paise : e.paise)),
  ];
  if (e.bill && withBills) {
    body.push(
      ...el('BILLALLOCATIONS.LIST', [
        ...el('NAME', e.bill.name),
        ...el('BILLTYPE', e.bill.type),
        ...el('AMOUNT', tallyAmount(debit ? -e.paise : e.paise)),
      ]),
    );
  }
  return el(tag, body);
}

/** Split `total` paise across weights, remainder on the last line, so sums are exact. */
function inventoryAmounts(lines: TallyInventoryLine[], total: number): number[] {
  const out = lines.map((l) => l.paise);
  const diff = total - out.reduce((s, n) => s + n, 0);
  if (out.length && diff !== 0) out[out.length - 1] += diff;
  return out;
}

function qtyText(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function voucherXml(v: TallyVoucher): Lines {
  const isInv = v.inventory.length > 0;
  const credit = v.type === 'Credit Note';
  const isParty = v.type !== 'Receipt' && v.type !== 'Payment';
  const header: Lines = [
    ...el('DATE', tallyDate(v.date)),
    ...el('EFFECTIVEDATE', tallyDate(v.date)),
    ...el('VOUCHERTYPENAME', v.type),
    ...el('VOUCHERNUMBER', v.number),
    ...(v.reference ? el('REFERENCE', v.reference) : []),
    ...el('PARTYLEDGERNAME', v.party),
    ...(isParty
      ? [
          ...el('PARTYNAME', v.party),
          ...el('BASICBUYERNAME', v.party),
          ...(v.partyGstin ? el('PARTYGSTIN', v.partyGstin) : []),
          ...el('GSTREGISTRATIONTYPE', gstRegType(v.partyGstin)),
          ...(v.stateName ? el('PLACEOFSUPPLY', v.stateName) : []),
          ...(v.stateName ? el('STATENAME', v.stateName) : []),
          ...el('COUNTRYOFRESIDENCE', 'India'),
        ]
      : []),
    ...(v.narration ? el('NARRATION', v.narration) : []),
    ...el('ISINVOICE', yn(isParty)),
    ...el('PERSISTEDVIEW', isParty ? (isInv ? 'Invoice Voucher View' : 'Accounting Voucher View') : 'Accounting Voucher View'),
  ];

  const body: Lines = [...header];
  const inventoryEntry = v.entries.find((e) => e.ledger === v.inventoryLedger && !e.bill);

  if (isInv && inventoryEntry) {
    const amts = inventoryAmounts(v.inventory, inventoryEntry.paise);
    v.inventory.forEach((l, i) => {
      const amt = tallyAmount(credit ? -amts[i] : amts[i]);
      const dr = credit;
      body.push(
        ...el('ALLINVENTORYENTRIES.LIST', [
          ...el('STOCKITEMNAME', l.item),
          ...(l.hsn ? el('HSNCODE', l.hsn) : []),
          ...el('ISDEEMEDPOSITIVE', yn(dr)),
          ...el('RATE', `${fixed2(l.rate)}/${l.unit}`),
          ...el('AMOUNT', amt),
          ...el('BILLEDQTY', `${qtyText(l.qty)} ${l.unit}`),
          ...el('ACTUALQTY', `${qtyText(l.qty)} ${l.unit}`),
          ...el('ACCOUNTINGALLOCATIONS.LIST', [
            ...el('LEDGERNAME', inventoryEntry.ledger),
            ...el('ISDEEMEDPOSITIVE', yn(dr)),
            ...el('AMOUNT', amt),
          ]),
        ]),
      );
    });
  }
  for (const e of v.entries) {
    if (isInv && e === inventoryEntry) continue;
    body.push(...entryXml(e));
  }
  return el('TALLYMESSAGE', el('VOUCHER', body, {
    VCHTYPE: v.type,
    ACTION: 'Create',
    OBJVIEW: isInv ? 'Invoice Voucher View' : 'Accounting Voucher View',
  }), { 'xmlns:UDF': 'TallyUDF' });
}

/**
 * Classic Import Data request:
 *   HEADER/TALLYREQUEST "Import Data", BODY/IMPORTDATA/REQUESTDESC/REPORTNAME.
 */
function importDataEnvelope(reportName: string, company: string, messages: Lines): string {
  const doc = el('ENVELOPE', [
    ...el('HEADER', [...el('TALLYREQUEST', 'Import Data')]),
    ...el('BODY', [
      ...el('IMPORTDATA', [
        ...el('REQUESTDESC', [
          ...el('REPORTNAME', reportName),
          ...el('STATICVARIABLES', [...el('SVCURRENTCOMPANY', company)]),
        ]),
        ...el('REQUESTDATA', messages),
      ]),
    ]),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${doc.join('\n')}\n`;
}

function applicableFromOf(build: TallyBuild): string {
  const first = build.vouchers.map((v) => v.date).sort()[0];
  if (!first) return '20170701';
  const [y, m] = first.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}0401`;
}

function mastersMessages(build: TallyBuild): Lines {
  const units = [...new Set(build.stockItems.map((s) => s.unit))].sort();
  const from = applicableFromOf(build);
  return cat(
    ...build.ledgers.map(ledgerXml),
    ...units.map(unitXml),
    ...build.stockItems.map((s) => stockItemXml(s, from)),
  );
}

/** Masters only (REPORTNAME "All Masters"): ledgers, units, stock items. Import this first. */
export function buildTallyMastersXml(build: TallyBuild, options: TallyOptions): string {
  return importDataEnvelope('All Masters', resolveOptions(options).companyName, mastersMessages(build));
}

/** Vouchers only (REPORTNAME "Vouchers"). Masters must already exist in the company. */
export function buildTallyVouchersXml(build: TallyBuild, options: TallyOptions): string {
  return importDataEnvelope('Vouchers', resolveOptions(options).companyName, cat(...build.vouchers.map(voucherXml)));
}

/** Masters + vouchers in one file (REPORTNAME "Vouchers"; Tally creates masters on the fly). */
export function buildTallyCombinedXml(build: TallyBuild, options: TallyOptions): string {
  return importDataEnvelope(
    'Vouchers',
    resolveOptions(options).companyName,
    cat(mastersMessages(build), ...build.vouchers.map(voucherXml)),
  );
}

export interface TallyExport {
  build: TallyBuild;
  counts: TallyCounts;
  mastersXml: string;
  vouchersXml: string;
  combinedXml: string;
}

/** One-call convenience used by the Export Center. */
export function generateTallyExport(source: ExportSource = emptySource(), options: TallyOptions): TallyExport {
  const build = buildTallyModel(source, options);
  return {
    build,
    counts: countTally(build),
    mastersXml: buildTallyMastersXml(build, options),
    vouchersXml: buildTallyVouchersXml(build, options),
    combinedXml: buildTallyCombinedXml(build, options),
  };
}
