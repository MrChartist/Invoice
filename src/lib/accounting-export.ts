/**
 * Accounting CSV exports — pure, no browser APIs.
 *
 * Datasets (all dates ISO yyyy-mm-dd by default; pass dateFormat 'dmy' for DD-MM-YYYY):
 *
 *  sales_register     one row per invoice / credit note (credit notes negative)
 *  sales_items        one row per invoice line — Zoho Books / Vyapar / Busy friendly
 *  purchase_register  one row per purchase bill (read defensively)
 *  receipts           one row per payment received
 *  parties            customers + vendors master
 *  items              item master (catalog + items seen on invoices)
 *  gst_summary        GST-rate-wise taxable value / CGST / SGST / IGST
 *
 * CSV is RFC-4180 (CRLF, quoted when needed). Text cells that could be parsed
 * as spreadsheet formulas are neutralised with a leading apostrophe.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import {
  clean,
  filterInvoices,
  filterPayments,
  filterPurchases,
  fixed2,
  fmtDate,
  fyLabel,
  invoiceAmounts,
  invoiceStateCode,
  isoDate,
  partyNameOf,
  slug,
  stateNameOf,
  voucherKindOf,
  type DateFormat,
  type DateRange,
  type ExportSource,
} from './export-shared';
import { generateTallyExport, type TallyOptions } from './tally-xml';
import { csvCell as baseCsvCell, safeText } from './csv';

export * from './export-shared';

/* ── CSV primitives ───────────────────────────────────────────── */

/** A money cell: serialised with exactly two decimals. */
export interface Money {
  money: number;
}
export const money = (n: number): Money => ({ money: round2(num(n)) });

export type Cell = string | number | Money | null | undefined;

export { safeText };

export function csvCell(cell: Cell): string {
  // A money cell is serialised with exactly two decimals; everything else is shared.
  if (cell !== null && cell !== undefined && typeof cell === 'object') return baseCsvCell(fixed2(cell.money));
  return baseCsvCell(cell);
}

export const UTF8_BOM = '﻿';

export interface CsvTable {
  id: DatasetId;
  title: string;
  filename: string;
  description: string;
  /** Which accounting package(s) the layout targets. */
  compatibleWith: string;
  headers: string[];
  rows: Cell[][];
}

export function toCsv(table: Pick<CsvTable, 'headers' | 'rows'>, opts: { bom?: boolean } = {}): string {
  const lines = [table.headers, ...table.rows].map((r) => r.map(csvCell).join(','));
  return `${opts.bom ? UTF8_BOM : ''}${lines.join('\r\n')}\r\n`;
}

/* ── Dataset catalogue ────────────────────────────────────────── */

export type DatasetId =
  | 'sales_register'
  | 'sales_items'
  | 'purchase_register'
  | 'receipts'
  | 'parties'
  | 'items'
  | 'gst_summary';

export interface DatasetInfo {
  id: DatasetId;
  title: string;
  description: string;
  compatibleWith: string;
}

export const DATASETS: DatasetInfo[] = [
  {
    id: 'sales_register',
    title: 'Sales register',
    description: 'One row per invoice and credit note with taxable value, CGST/SGST/IGST, total and balance.',
    compatibleWith: 'Excel, Busy, Vyapar (day book / register import)',
  },
  {
    id: 'sales_items',
    title: 'Sales line items',
    description: 'One row per invoice line with HSN/SAC, quantity, rate, discount and GST rate.',
    compatibleWith: 'Zoho Books invoice import, Vyapar, Busy, Excel',
  },
  {
    id: 'purchase_register',
    title: 'Purchase register',
    description: 'One row per purchase bill with input tax split.',
    compatibleWith: 'Excel, Zoho Books bills, Busy',
  },
  {
    id: 'receipts',
    title: 'Receipts',
    description: 'Every payment received against an invoice, with mode and reference.',
    compatibleWith: 'Zoho Books customer payments, Excel',
  },
  {
    id: 'parties',
    title: 'Party master',
    description: 'Customers and vendors with GSTIN, state, address and contact details.',
    compatibleWith: 'Zoho Books contacts, Vyapar parties, Busy accounts',
  },
  {
    id: 'items',
    title: 'Item master',
    description: 'Catalogue items plus every item used on an invoice, with HSN/SAC, unit, rate, GST%.',
    compatibleWith: 'Zoho Books items, Vyapar items, Busy item master',
  },
  {
    id: 'gst_summary',
    title: 'GST rate-wise summary',
    description: 'Taxable value and tax grouped by GST rate for sales (net of credit notes) and purchases.',
    compatibleWith: 'GSTR-1 / GSTR-3B working, Excel',
  },
];

export interface CsvOptions {
  range?: DateRange;
  dateFormat?: DateFormat;
  includeDrafts?: boolean;
}

/* ── Builders ─────────────────────────────────────────────────── */

const info = (id: DatasetId) => DATASETS.find((d) => d.id === id)!;
const table = (id: DatasetId, headers: string[], rows: Cell[][]): CsvTable => ({
  ...info(id),
  filename: `${id.replace(/_/g, '-')}.csv`,
  headers,
  rows,
});

const docLabel = (inv: InvoiceRecord) =>
  voucherKindOf(inv, true) === 'CREDIT_NOTE' ? 'Credit Note' : inv.doc_type === 'TAX_INVOICE' ? 'Tax Invoice' : 'Invoice';
const sign = (inv: InvoiceRecord) => (voucherKindOf(inv, true) === 'CREDIT_NOTE' ? -1 : 1);
const gstTreatment = (gstin: string) => (clean(gstin).length === 15 ? 'business_gst' : 'consumer');
const placeOfSupply = (code: string) => (code ? `${code}-${stateNameOf(code)}` : '');

export function salesRegister(invoices: InvoiceRecord[], opts: CsvOptions = {}): CsvTable {
  const df = opts.dateFormat ?? 'iso';
  const rows = invoices.map((inv): Cell[] => {
    const a = invoiceAmounts(inv);
    const s = sign(inv);
    const code = invoiceStateCode(inv);
    return [
      fmtDate(isoDate(inv.issue_date), df),
      clean(inv.invoice_number),
      docLabel(inv),
      partyNameOf(inv.client),
      clean(inv.client?.gstin).toUpperCase(),
      placeOfSupply(code),
      inv.reverse_charge ? 'Y' : 'N',
      money(s * a.taxable),
      money(s * a.cgst),
      money(s * a.sgst),
      money(s * (a.igst + a.otherTax)),
      money(s * a.tax),
      money(s * a.cess),
      money(s * a.tcs),
      money(s * a.charges),
      money(s * a.roundOff),
      money(s * a.total),
      money(s * num(inv.amount_paid)),
      money(s * num(inv.balance_due)),
      clean(inv.status),
      clean(inv.currency) || 'INR',
      fmtDate(isoDate(inv.due_date), df),
    ];
  });
  return table(
    'sales_register',
    [
      'Date', 'Voucher No', 'Document Type', 'Party Name', 'Party GSTIN', 'Place of Supply',
      'Reverse Charge', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Cess', 'TCS', 'Other Charges',
      'Round Off', 'Invoice Total', 'Amount Received', 'Balance Due', 'Status', 'Currency', 'Due Date',
    ],
    rows,
  );
}

export function salesItems(invoices: InvoiceRecord[], opts: CsvOptions = {}): CsvTable {
  const df = opts.dateFormat ?? 'iso';
  const rows: Cell[][] = [];
  for (const inv of invoices) {
    const code = invoiceStateCode(inv);
    const items: InvoiceItem[] = Array.isArray(inv.items) ? inv.items : [];
    const calc = items.length
      ? calculateInvoice(
          calcInputFromRecord(inv, { round_off_enabled: false, round_mode: 'none', amount_paid: 0 }),
        )
      : null;
    const s = sign(inv);
    (calc?.lines ?? []).forEach((l, i) => {
      const src = items[i];
      rows.push([
        fmtDate(isoDate(inv.issue_date), df),
        clean(inv.invoice_number),
        docLabel(inv),
        clean(inv.status),
        partyNameOf(inv.client),
        clean(inv.client?.gstin).toUpperCase(),
        gstTreatment(inv.client?.gstin ?? ''),
        placeOfSupply(code),
        fmtDate(isoDate(inv.due_date), df),
        clean(inv.currency) || 'INR',
        clean(l.name),
        clean(src?.description),
        clean(l.hsn),
        l.quantity,
        clean(l.unit) || 'NOS',
        money(l.rate),
        num(src?.discount_percent),
        money(s * l.taxable),
        l.tax_rate,
        money(s * l.cgst),
        money(s * l.sgst),
        money(s * l.igst),
        money(s * (l.taxable + l.tax)),
        clean(inv.po_number),
      ]);
    });
  }
  return table(
    'sales_items',
    [
      'Invoice Date', 'Invoice Number', 'Document Type', 'Invoice Status', 'Customer Name',
      'GST Identification Number (GSTIN)', 'GST Treatment', 'Place of Supply', 'Due Date',
      'Currency Code', 'Item Name', 'Item Desc', 'HSN/SAC', 'Quantity', 'Usage Unit', 'Item Price',
      'Discount(%)', 'Taxable Value', 'Item Tax %', 'CGST', 'SGST', 'IGST', 'Line Total', 'PO Number',
    ],
    rows,
  );
}

export function purchaseRegister(source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const df = opts.dateFormat ?? 'iso';
  const rows = filterPurchases(source.purchases, source.vendors, opts.range ?? {}).map((p): Cell[] => [
    fmtDate(p.date, df),
    p.number,
    p.partyName,
    p.partyGstin,
    placeOfSupply(p.stateCode),
    money(p.taxable),
    money(p.cgst),
    money(p.sgst),
    money(round2(p.tax - p.cgst - p.sgst)),
    money(p.tax),
    money(p.roundOff),
    money(p.total),
    p.status,
    p.notes,
  ]);
  return table(
    'purchase_register',
    [
      'Date', 'Bill No', 'Vendor Name', 'Vendor GSTIN', 'Place of Supply', 'Taxable Value',
      'CGST', 'SGST', 'IGST', 'Total Tax', 'Round Off', 'Bill Total', 'Status', 'Notes',
    ],
    rows,
  );
}

export function receipts(source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const df = opts.dateFormat ?? 'iso';
  const sales = source.invoices.filter((i) => voucherKindOf(i, true) === 'SALES');
  const byId = new Map(sales.map((i) => [i.id, i]));
  const rows = filterPayments(source.payments, sales, opts.range ?? {}).map((p): Cell[] => {
    const inv = byId.get(p.invoice_id)!;
    const cash = /^\s*cash\s*$/i.test(String(p.method ?? ''));
    return [
      fmtDate(isoDate(p.date), df),
      clean(inv.invoice_number),
      partyNameOf(inv.client),
      money(p.amount),
      clean(p.method),
      cash ? 'Cash' : 'Bank',
      clean(p.reference),
      clean(p.note),
    ];
  });
  return table(
    'receipts',
    ['Payment Date', 'Invoice Number', 'Customer Name', 'Amount', 'Payment Mode', 'Deposit To', 'Reference #', 'Notes'],
    rows,
  );
}

export function parties(source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const inRangeInv = filterInvoices(source.invoices, opts.range ?? {}, opts.includeDrafts);
  const seen = new Map<string, Cell[]>();
  const add = (
    type: string, name: string, company: string, gstin: string, stateCode: string,
    address: string, city: string, zip: string, email: string, phone: string,
  ) => {
    const key = `${type}|${name.toLowerCase()}`;
    if (!name) return;
    const g = gstin.toUpperCase();
    const row: Cell[] = [
      type, name, company, g, g.length === 15 ? 'Registered' : 'Unregistered',
      g.length === 15 ? g.slice(2, 12) : '', stateCode, stateNameOf(stateCode), address, city, zip, email, phone,
    ];
    const prev = seen.get(key);
    // Prefer the row with more filled cells.
    if (!prev || row.filter(Boolean).length > prev.filter(Boolean).length) seen.set(key, row);
  };
  for (const c of source.clients) {
    const code = clean(c.state_code) || stateCodeFrom(c.gstin, c.state);
    add('Customer', partyNameOf(c), clean(c.company), clean(c.gstin), code, clean(c.address), clean(c.city), clean(c.zip), clean(c.email), clean(c.phone));
  }
  for (const inv of inRangeInv) {
    const c = inv.client;
    add('Customer', partyNameOf(c), clean(c.company), clean(c.gstin), invoiceStateCode(inv), clean(c.address), clean(c.city), clean(c.zip), clean(c.email), clean(c.phone));
  }
  for (const p of filterPurchases(source.purchases, source.vendors, opts.range ?? {})) {
    add('Vendor', p.partyName, '', p.partyGstin, p.stateCode, '', '', '', '', '');
  }
  for (const raw of source.vendors) {
    const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = clean(v.company) || clean(v.name);
    add('Vendor', name, clean(v.company), clean(v.gstin), clean(v.state_code) || stateCodeFrom(String(v.gstin ?? ''), String(v.state ?? '')),
      clean(v.address), clean(v.city), clean(v.zip), clean(v.email), clean(v.phone));
  }
  const rows = [...seen.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  return table(
    'parties',
    ['Contact Type', 'Contact Name', 'Company Name', 'GSTIN', 'GST Treatment', 'PAN', 'State Code', 'Place of Contact', 'Address', 'City', 'Pincode', 'Email', 'Phone'],
    rows,
  );
}

function stateCodeFrom(gstin?: string, name?: string): string {
  const code = clean(gstin).slice(0, 2);
  if (/^\d{2}$/.test(code) && stateNameOf(code)) return code;
  const n = clean(name).toLowerCase();
  if (!n) return '';
  for (let i = 1; i <= 38; i++) {
    const c = String(i).padStart(2, '0');
    if (stateNameOf(c).toLowerCase() === n) return c;
  }
  return '';
}

export function itemMaster(source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const seen = new Map<string, Cell[]>();
  const add = (name: string, desc: string, hsn: string, unit: string, rate: number, tax: number, type: string, src: string) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.set(key, [name, desc, hsn, unit || 'NOS', money(rate), tax, type, src]);
  };
  for (const raw of source.items) {
    add(clean(raw.name), clean(raw.description), clean(raw.hsn), clean(raw.unit).toUpperCase(), num(raw.rate), num(raw.tax_rate), clean(raw.type), 'Catalogue');
  }
  for (const inv of filterInvoices(source.invoices, opts.range ?? {}, opts.includeDrafts)) {
    for (const it of inv.items ?? []) {
      add(clean(it.name), clean(it.description), clean(it.hsn), clean(it.unit).toUpperCase(), num(it.rate), num(it.tax_rate ?? inv.tax_rate), clean(it.type), 'Invoices');
    }
  }
  const rows = [...seen.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return table('items', ['Item Name', 'Description', 'HSN/SAC', 'Usage Unit', 'Selling Price', 'Tax %', 'Item Type', 'Source'], rows);
}

interface Bucket { taxable: number; cgst: number; sgst: number; igst: number; docs: Set<string> }

export function gstSummary(source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const range = opts.range ?? {};
  const buckets = new Map<string, { section: string; rate: number; b: Bucket }>();
  const bump = (section: string, rate: number, taxable: number, cgst: number, sgst: number, igst: number, doc: string) => {
    const key = `${section}|${rate}`;
    const cur = buckets.get(key) ?? { section, rate, b: { taxable: 0, cgst: 0, sgst: 0, igst: 0, docs: new Set<string>() } };
    cur.b.taxable += taxable;
    cur.b.cgst += cgst;
    cur.b.sgst += sgst;
    cur.b.igst += igst;
    cur.b.docs.add(doc);
    buckets.set(key, cur);
  };
  for (const inv of filterInvoices(source.invoices, range, opts.includeDrafts)) {
    const s = sign(inv);
    const section = s < 0 ? 'Credit Notes' : 'Sales';
    const doc = clean(inv.invoice_number) || inv.id;
    const items: InvoiceItem[] = Array.isArray(inv.items) ? inv.items : [];
    const calc = items.length
      ? calculateInvoice(
          calcInputFromRecord(inv, {
            shipping: 0,
            other_charges: 0,
            round_off_enabled: false,
            round_mode: 'none',
            amount_paid: 0,
          }),
        )
      : null;
    if (calc && calc.lines.length) {
      for (const l of calc.lines) {
        // SINGLE mode has no split — report it under IGST/"tax" so the total tax column stays right.
        const split = l.cgst + l.sgst + l.igst;
        bump(section, l.tax_rate, l.taxable, l.cgst, l.sgst, l.igst + Math.max(0, l.tax - split), doc);
      }
    } else {
      const a = invoiceAmounts(inv);
      const rate = a.taxable > 0 ? round2((a.tax / a.taxable) * 100) : 0;
      bump(section, rate, a.taxable, a.cgst, a.sgst, a.igst + a.otherTax, doc);
    }
  }
  for (const p of filterPurchases(source.purchases, source.vendors, range)) {
    const rate = p.taxable > 0 ? round2((p.tax / p.taxable) * 100) : 0;
    bump('Purchases', rate, p.taxable, p.cgst, p.sgst, p.igst + Math.max(0, p.tax - p.cgst - p.sgst - p.igst), p.number || p.id);
  }
  const order: Record<string, number> = { Sales: 0, 'Credit Notes': 1, Purchases: 2 };
  const entries = [...buckets.values()].sort((a, b) => order[a.section] - order[b.section] || a.rate - b.rate);
  const rows: Cell[][] = entries.map(({ section, rate, b }) => {
    const mult = section === 'Credit Notes' ? -1 : 1;
    return [
      section, rate, b.docs.size, money(mult * b.taxable), money(mult * b.cgst), money(mult * b.sgst),
      money(mult * b.igst), money(mult * (b.cgst + b.sgst + b.igst)),
    ];
  });
  // Net sales (sales minus credit notes) per rate — what goes in GSTR-1 totals.
  const net = new Map<number, number[]>();
  for (const { section, rate, b } of entries) {
    if (section === 'Purchases') continue;
    const m = section === 'Credit Notes' ? -1 : 1;
    const cur = net.get(rate) ?? [0, 0, 0, 0];
    cur[0] += m * b.taxable; cur[1] += m * b.cgst; cur[2] += m * b.sgst; cur[3] += m * b.igst;
    net.set(rate, cur);
  }
  for (const [rate, v] of [...net.entries()].sort((a, b) => a[0] - b[0])) {
    rows.push(['Net Sales', rate, '', money(v[0]), money(v[1]), money(v[2]), money(v[3]), money(v[1] + v[2] + v[3])]);
  }
  return table('gst_summary', ['Section', 'GST Rate %', 'Documents', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax'], rows);
}

/** Build one dataset by id. */
export function buildDataset(id: DatasetId, source: ExportSource, opts: CsvOptions = {}): CsvTable {
  const invoices = () => filterInvoices(source.invoices, opts.range ?? {}, opts.includeDrafts);
  switch (id) {
    case 'sales_register': return salesRegister(invoices(), opts);
    case 'sales_items': return salesItems(invoices(), opts);
    case 'purchase_register': return purchaseRegister(source, opts);
    case 'receipts': return receipts(source, opts);
    case 'parties': return parties(source, opts);
    case 'items': return itemMaster(source, opts);
    case 'gst_summary': return gstSummary(source, opts);
  }
}

export function buildAllDatasets(source: ExportSource, opts: CsvOptions = {}): CsvTable[] {
  return DATASETS.map((d) => buildDataset(d.id, source, opts));
}

/* ── Accountant bundle ────────────────────────────────────────── */

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

export interface BundleOptions extends CsvOptions {
  companyName: string;
  datasets: DatasetId[];
  /** Tally files to include. */
  tally?: { masters?: boolean; vouchers?: boolean; options?: Partial<TallyOptions> };
  bom?: boolean;
  /** Label used in file names, e.g. "FY25-26". */
  rangeLabel?: string;
}

export interface Bundle {
  /** Files to download one after another. */
  files: ExportFile[];
  /** The same content as a single self-describing JSON document. */
  combined: ExportFile;
  warnings: string[];
}

export function rangeLabelOf(range: DateRange, fyStart?: number): string {
  if (fyStart) return fyLabel(fyStart);
  if (range.from || range.to) return `${range.from ?? 'start'}_to_${range.to ?? 'today'}`;
  return 'all-time';
}

/**
 * Everything an accountant needs: CSVs, Tally XML and one combined JSON file
 * (zip is intentionally avoided — no dependencies).
 */
export function buildAccountantBundle(source: ExportSource, o: BundleOptions): Bundle {
  const label = slug(o.rangeLabel ?? rangeLabelOf(o.range ?? {}));
  const base = slug(o.companyName || 'company');
  const files: ExportFile[] = [];
  const warnings: string[] = [];

  const tables = o.datasets.map((id) => buildDataset(id, source, o));
  for (const t of tables) {
    files.push({
      filename: `${base}_${label}_${t.filename}`,
      mime: 'text/csv;charset=utf-8',
      content: toCsv(t, { bom: o.bom }),
    });
  }

  let tallyCounts: unknown = null;
  if (o.tally?.masters || o.tally?.vouchers) {
    const tallyOpts: TallyOptions = {
      companyName: o.companyName,
      range: o.range,
      includeDrafts: o.includeDrafts,
      ...o.tally.options,
    };
    const t = generateTallyExport(source, tallyOpts);
    warnings.push(...t.build.warnings);
    tallyCounts = t.counts;
    if (o.tally.masters) {
      files.push({ filename: `${base}_${label}_tally-masters.xml`, mime: 'application/xml;charset=utf-8', content: t.mastersXml });
    }
    if (o.tally.vouchers) {
      files.push({ filename: `${base}_${label}_tally-vouchers.xml`, mime: 'application/xml;charset=utf-8', content: t.vouchersXml });
    }
  }

  const combinedDoc = {
    generator: 'MrChartist Invoice Creator — Export Center',
    company: o.companyName,
    range: o.range ?? {},
    datasets: Object.fromEntries(
      tables.map((t) => [t.id, { title: t.title, headers: t.headers, rows: t.rows.map((r) => r.map(plainCell)) }]),
    ),
    tally: tallyCounts,
    files: files.map((f) => f.filename),
    warnings,
  };
  const combined: ExportFile = {
    filename: `${base}_${label}_accountant-bundle.json`,
    mime: 'application/json;charset=utf-8',
    content: `${JSON.stringify(combinedDoc, null, 2)}\n`,
  };
  return { files, combined, warnings };
}

function plainCell(c: Cell): string | number {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return round2(c.money);
  return c;
}
