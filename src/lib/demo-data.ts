/**
 * Demo / sample data for first-run onboarding.
 *
 * One coherent, clearly fake business: a "Sample Studio (demo)" profile, 6 clients with
 * checksum-valid but fictitious GSTINs, a 12-item catalogue, ~25 invoices spread over the last
 * six months (paid, part-paid, overdue, sent, draft, cancelled), one credit note, two vendors,
 * eight purchases/expenses and a monthly recurring schedule.
 *
 * SAFETY CONTRACT
 *  - Every row written carries `demo: true` (an additive field). `removeDemoData()` deletes
 *    exactly those rows, plus anything the demo recurring schedule generated, and nothing else.
 *  - Demo documents use their own number series (`DEMO/…`, `DEMOCN/…`) so a real invoice number
 *    is never pushed forward and a real series never contains a demo number.
 *  - Money goes through `invoice-calc` and the real `localDb.invoices.save`, so totals, payments
 *    and credit notes behave exactly like user-entered ones. The client / catalogue tables are
 *    restored to their pre-load state afterwards (the save side-effects would otherwise add
 *    un-marked rows) and the demo rows are inserted explicitly.
 *  - Loading refuses when real invoices exist unless the caller passes `confirm: true`, and is
 *    idempotent: a second load changes nothing.
 */

import type { Client, InvoiceItem, InvoiceRecord, Payment, SenderProfile } from '../types/invoice';
import type { PurchaseRecord, Vendor } from '../types/purchases';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, round2 } from './invoice-calc';
import { gstinChecksumChar } from './gstin';
import { localDayOf, shiftDay } from './dates';
import { buildInvoiceNumber, getIndianFY } from './invoice-number';
import { localDb, blankProfile } from './localDb';
import { KEYS, SINGLETON_KEYS, getTable, readRaw, setTable, writeRaw } from './storage';
import { DOC_LINKS_TABLE, buildCreditNote, type DocLink } from './documents';
import { PAYMENTS_TABLE, PURCHASES_TABLE, computePurchaseTotals, type PurchasePayment } from './purchases';
import { VENDORS_TABLE } from './vendors';
import { RECURRING_TABLE, createSchedule, templateFromInvoice, type RecurringSchedule } from './recurring';
import { REMINDERS_TABLE } from './reminders';

/** Marker carried by every demo row. */
export type Demo<T> = T & { demo?: true };

export const DEMO_PROFILE_ID = 'demo-profile';
export const DEMO_PROFILE_NAME = 'Sample Studio (demo)';
/** Table holding e-Invoice details (owned by the e-Invoice module). */
const EINVOICE_META_TABLE = 'einvoice_meta';

export const isDemo = (row: unknown): boolean => !!row && typeof row === 'object' && (row as { demo?: unknown }).demo === true;

export interface DemoCounts {
  profiles: number;
  clients: number;
  items: number;
  /** Invoices incl. credit notes and anything the demo schedule generated. */
  invoices: number;
  creditNotes: number;
  payments: number;
  vendors: number;
  purchases: number;
  schedules: number;
}

export interface DemoStatus {
  /** Any demo row is present. */
  loaded: boolean;
  counts: DemoCounts;
  /** Invoices the user created themselves (not demo). */
  realInvoices: number;
}

export type DemoLoadResult =
  | { ok: true; counts: DemoCounts }
  | { ok: false; reason: 'already_loaded' | 'has_real_data'; realInvoices?: number };

/* ── Deterministic building blocks ────────────────────────────── */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fictitious but structurally valid GSTIN (state + PAN-shaped body + checksum). */
export function fakeGstin(stateCode: string, panBody: string): string {
  const first14 = `${stateCode}${panBody}1Z`;
  return first14 + gstinChecksumChar(first14);
}

interface ClientSpec {
  name: string;
  state: string;
  stateName: string;
  pan: string;
  city: string;
  zip: string;
  tpl: string;
}

const CLIENT_SPECS: ClientSpec[] = [
  { name: 'Orchid Retail Pvt Ltd (demo)', state: '27', stateName: 'Maharashtra', pan: 'AAACO1001A', city: 'Pune', zip: '411001', tpl: 'classic_orange' },
  { name: 'Nimbus Foods LLP (demo)', state: '27', stateName: 'Maharashtra', pan: 'AAACN2002B', city: 'Mumbai', zip: '400051', tpl: 'corporate_navy' },
  { name: 'Kaveri Textiles (demo)', state: '29', stateName: 'Karnataka', pan: 'AAACK3003C', city: 'Bengaluru', zip: '560001', tpl: 'classic_orange' },
  { name: 'Lotus Clinics Pvt Ltd (demo)', state: '07', stateName: 'Delhi', pan: 'AAACL4004D', city: 'New Delhi', zip: '110001', tpl: 'modern_teal' },
  { name: 'Saffron Hospitality (demo)', state: '24', stateName: 'Gujarat', pan: 'AAACS5005E', city: 'Ahmedabad', zip: '380001', tpl: 'corporate_navy' },
  { name: 'Banyan EdTech Pvt Ltd (demo)', state: '33', stateName: 'Tamil Nadu', pan: 'AAACB6006F', city: 'Chennai', zip: '600001', tpl: 'modern_teal' },
];

interface CatalogSpec {
  name: string;
  type: 'Service' | 'Goods';
  hsn: string;
  unit: string;
  rate: number;
  tax: number;
}

const CATALOG_SPECS: CatalogSpec[] = [
  { name: 'Brand identity package', type: 'Service', hsn: '998391', unit: 'NOS', rate: 45000, tax: 18 },
  { name: 'Website design (per page)', type: 'Service', hsn: '998314', unit: 'NOS', rate: 6000, tax: 18 },
  { name: 'Monthly social media management', type: 'Service', hsn: '998361', unit: 'MONTH', rate: 25000, tax: 18 },
  { name: 'SEO audit', type: 'Service', hsn: '998313', unit: 'NOS', rate: 18000, tax: 18 },
  { name: 'Product photography (per day)', type: 'Service', hsn: '998391', unit: 'DAY', rate: 12000, tax: 18 },
  { name: 'Video editing (per hour)', type: 'Service', hsn: '998397', unit: 'HRS', rate: 1500, tax: 18 },
  { name: 'Hosting & maintenance (annual)', type: 'Service', hsn: '998315', unit: 'NOS', rate: 9600, tax: 18 },
  { name: 'Consulting (per hour)', type: 'Service', hsn: '998311', unit: 'HRS', rate: 3000, tax: 18 },
  { name: 'Printed brochures (500 pcs)', type: 'Goods', hsn: '490110', unit: 'BOX', rate: 7500, tax: 12 },
  { name: 'Business cards (box of 500)', type: 'Goods', hsn: '490900', unit: 'BOX', rate: 900, tax: 12 },
  { name: 'Branded T-shirts', type: 'Goods', hsn: '610910', unit: 'NOS', rate: 450, tax: 5 },
  { name: 'Sticker sheets (pack of 100)', type: 'Goods', hsn: '481190', unit: 'PCS', rate: 600, tax: 18 },
];

const SAMPLE_NOTE = 'Sample invoice from the demo data. Not a real transaction.';
const TERMS_PLAIN = 'Payment due by the due date. Please quote the invoice number with your payment.';
const TERMS_INTEREST = 'Payment due by the due date. Interest at 18% p.a. is chargeable on delayed payments.';

const STATUS_PLAN = [
  'paid', 'paid', 'paid', 'part', 'paid', 'paid', 'paid', 'sent', 'paid', 'paid',
  'paid', 'cancelled', 'paid', 'part', 'paid', 'sent', 'paid', 'part', 'paid', 'sent',
  'part', 'sent', 'sent', 'sent', 'draft',
] as const;
type Plan = (typeof STATUS_PLAN)[number];

const METHODS = ['UPI', 'Bank Transfer', 'Cheque', 'Cash'];

/** Index of the invoice carrying the monthly retainer line, and of the one the credit note is raised on. */
const RETAINER_INDEX = 4;
const CREDIT_INDEX = 15;

export interface DemoDataset {
  profile: Demo<SenderProfile>;
  clients: Demo<Client>[];
  items: Demo<InvoiceItem>[];
  invoices: Demo<InvoiceRecord>[];
  payments: Demo<Payment>[];
  vendors: Demo<Vendor>[];
  purchases: Demo<PurchaseRecord>[];
  purchasePayments: Demo<PurchasePayment>[];
}

function applyTotals<T extends InvoiceRecord>(rec: T): T {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    round_off: t.round_off,
    total: t.total,
    balance_due: t.balance_due,
    cess_amount: t.cess_amount,
    tcs_amount: t.tcs_amount,
    tds_amount: t.tds_amount,
  };
}

/**
 * Pure: the whole dataset for "today". Fixed ids and a seeded generator make it reproducible,
 * so loading twice (or on two machines) yields the same records.
 */
export function buildDemoDataset(today: string): DemoDataset {
  const rand = rng(20260401);
  const pick = (n: number) => Math.floor(rand() * n);

  const profile: Demo<SenderProfile> = {
    ...blankProfile(),
    id: DEMO_PROFILE_ID,
    demo: true,
    companyName: DEMO_PROFILE_NAME,
    companyTagline: 'Design & digital marketing (sample)',
    companyEmail: 'hello@sample-studio.invalid',
    companyPhone: '+91 90000 00000',
    companyAddress: '1 Sample Street, Andheri East, Mumbai, Maharashtra 400069',
    companyGstin: fakeGstin('27', 'AAACS0001A'),
    pan: 'AAACS0001A',
    companyWebsite: 'sample-studio.invalid',
    stateCode: '27',
    city: 'Mumbai',
    pin: '400069',
    regLine: 'Demo profile - fictitious details',
    bankName: 'Sample Bank (demo)',
    accountName: DEMO_PROFILE_NAME,
    accountNumber: '000000000000',
    ifsc: 'DEMO0000000',
    upiId: 'sample@demo',
    invoicePrefix: 'DEMO',
    defaultTerms: TERMS_PLAIN,
  };

  const clients: Demo<Client>[] = CLIENT_SPECS.map((c, i) => ({
    id: `demo-client-${i + 1}`,
    demo: true,
    name: c.name,
    company: c.name,
    email: `accounts${i + 1}@example.invalid`,
    phone: `+91 9000000${String(10 + i)}`,
    address: `${i + 1} Demo Road`,
    city: c.city,
    zip: c.zip,
    state: c.stateName,
    state_code: c.state,
    gstin: fakeGstin(c.state, c.pan),
    notes: 'Sample client',
    created_at: `${today}T00:00:00.000Z`,
  }));

  const items: Demo<InvoiceItem>[] = CATALOG_SPECS.map((c, i) => ({
    id: `demo-item-${String(i + 1).padStart(2, '0')}`,
    demo: true,
    name: c.name,
    type: c.type,
    hsn: c.hsn,
    unit: c.unit,
    quantity: 1,
    rate: c.rate,
    tax_rate: c.tax,
    amount: c.rate,
  }));

  /* ── invoices + payments ── */
  const invoices: Demo<InvoiceRecord>[] = [];
  const payments: Demo<Payment>[] = [];
  const seqByFy = new Map<string, number>();

  for (let i = 0; i < STATUS_PLAN.length; i++) {
    const plan: Plan = STATUS_PLAN[i];
    const client = clients[(i * 5 + (i >> 1)) % clients.length];
    const issue = shiftDay(today, -Math.round(176 - i * 7));
    const dueDays = i % 3 === 0 ? 30 : 15;
    const due = shiftDay(issue, dueDays);
    const fy = getIndianFY(issue).label;
    const seq = (seqByFy.get(fy) ?? 0) + 1;
    seqByFy.set(fy, seq);
    const id = `demo-inv-${String(i + 1).padStart(2, '0')}`;

    // Lines: the retainer invoice and the credit-note target get fixed shapes.
    let lineSpecs: [number, number][];
    if (i === RETAINER_INDEX) lineSpecs = [[2, 1]];
    else if (i === CREDIT_INDEX) lineSpecs = [[8, 2], [9, 3]];
    else {
      const n = 1 + pick(3);
      const used = new Set<number>();
      lineSpecs = [];
      while (lineSpecs.length < n) {
        const k = pick(items.length);
        if (used.has(k)) continue;
        used.add(k);
        const goods = items[k].type === 'Goods';
        lineSpecs.push([k, goods ? 2 + pick(9) : items[k].unit === 'HRS' ? 4 + pick(12) : 1 + pick(2)]);
      }
    }
    const lines: InvoiceItem[] = lineSpecs.map(([k, q], li) => {
      const { demo: _marker, ...catalogue } = items[k];
      void _marker;
      return { ...catalogue, id: `${id}-l${li + 1}`, quantity: q, amount: round2(q * catalogue.rate) };
    });

    const gst_mode = deriveGstMode({
      senderStateCode: profile.stateCode,
      placeOfSupply: client.state_code,
      senderHasGstin: true,
      taxEnabled: true,
    });
    const base: Demo<InvoiceRecord> = {
      id,
      demo: true,
      invoice_number: buildInvoiceNumber('DEMO', fy, seq),
      doc_type: 'TAX_INVOICE',
      issue_date: issue,
      due_date: due,
      status: plan === 'draft' ? 'Draft' : plan === 'cancelled' ? 'Cancelled' : 'Sent',
      currency: 'INR',
      template_id: CLIENT_SPECS[clients.indexOf(client)].tpl,
      client: { ...client },
      sender: { ...profile },
      items: lines,
      gst_mode,
      place_of_supply: client.state_code ?? '',
      reverse_charge: false,
      discount_type: 'PERCENT',
      discount_rate: i % 6 === 2 ? 5 : 0,
      tax_rate: 18,
      shipping: 0,
      other_charges: 0,
      round_off_enabled: true,
      amount_paid: 0,
      notes: SAMPLE_NOTE,
      terms: i % 2 === 0 ? TERMS_INTEREST : TERMS_PLAIN,
      po_number: i % 4 === 1 ? `PO-DEMO-${100 + i}` : undefined,
      subtotal: 0,
      discount_amount: 0,
      taxable_value: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      tax_amount: 0,
      round_off: 0,
      total: 0,
      balance_due: 0,
      created_at: `${issue}T09:00:00.000Z`,
    };
    let rec = applyTotals(base);

    const yesterday = shiftDay(today, -1);
    const clampDay = (d: string) => (d > yesterday ? yesterday : d < shiftDay(issue, 1) ? shiftDay(issue, 1) : d);
    const addPayment = (n: number, amount: number, date: string) => {
      payments.push({
        id: `demo-pay-${String(payments.length + 1).padStart(2, '0')}`,
        demo: true,
        invoice_id: id,
        amount: round2(amount),
        method: METHODS[(i + n) % METHODS.length],
        reference: `DEMO-REF-${1000 + payments.length}`,
        note: 'Sample payment',
        date,
      });
    };

    if (plan === 'paid') {
      const late = i % 4 === 1;
      const offset = late ? 12 + pick(14) : -3 + pick(7);
      const lastDate = clampDay(shiftDay(due, offset));
      if (i % 5 === 2 && rec.total >= 2000) {
        const first = Math.round(rec.total / 2 / 100) * 100;
        addPayment(0, first, clampDay(shiftDay(due, -2)));
        addPayment(1, rec.total - first, lastDate);
      } else {
        addPayment(0, rec.total, lastDate);
      }
    } else if (plan === 'part') {
      const share = Math.round((rec.total * (0.35 + rand() * 0.25)) / 100) * 100;
      addPayment(0, Math.min(Math.max(share, 100), rec.total - 100), clampDay(shiftDay(due, -2)));
    }

    if (plan === 'paid' || plan === 'part') {
      const paid = round2(payments.filter((p) => p.invoice_id === id).reduce((s, p) => s + p.amount, 0));
      rec = applyTotals({ ...rec, amount_paid: paid, status: plan === 'paid' ? 'Paid' : 'Partially Paid' });
    }
    invoices.push(rec);
  }

  /* ── vendors + purchases ── */
  const vendors: Demo<Vendor>[] = [
    {
      id: 'demo-vendor-1',
      demo: true,
      name: 'Paper Mill Supplies (demo)',
      gstin: fakeGstin('27', 'AAACP7007G'),
      state_code: '27',
      email: 'sales@paper-mill.invalid',
      phone: '+91 9000000100',
      address: '7 Industrial Estate, Thane',
      notes: 'Sample vendor',
      created_at: `${today}T00:00:00.000Z`,
    },
    {
      id: 'demo-vendor-2',
      demo: true,
      name: 'CloudNet Hosting (demo)',
      gstin: fakeGstin('29', 'AAACC8008H'),
      state_code: '29',
      email: 'billing@cloudnet.invalid',
      phone: '+91 9000000101',
      address: '12 Tech Park, Bengaluru',
      notes: 'Sample vendor',
      created_at: `${today}T00:00:00.000Z`,
    },
  ];

  interface PurchaseSpec {
    ago: number;
    kind: PurchaseRecord['kind'];
    vendor?: 0 | 1;
    category: string;
    lines: { name: string; hsn?: string; qty: number; rate: number; tax: number }[];
    paid: 'full' | 'part' | 'none';
    dueDays: number;
  }
  const purchaseSpecs: PurchaseSpec[] = [
    { ago: 150, kind: 'EXPENSE', category: 'Rent', lines: [{ name: 'Studio rent', qty: 1, rate: 30000, tax: 0 }], paid: 'full', dueDays: 5 },
    { ago: 128, kind: 'PURCHASE', vendor: 0, category: 'Purchases', lines: [{ name: 'Art paper A3 (ream)', hsn: '480256', qty: 20, rate: 650, tax: 12 }], paid: 'full', dueDays: 30 },
    { ago: 105, kind: 'PURCHASE', vendor: 1, category: 'Software & subscriptions', lines: [{ name: 'Cloud hosting (annual)', hsn: '998315', qty: 1, rate: 24000, tax: 18 }], paid: 'full', dueDays: 15 },
    { ago: 84, kind: 'EXPENSE', category: 'Travel', lines: [{ name: 'Client visit travel', qty: 1, rate: 6400, tax: 5 }], paid: 'full', dueDays: 0 },
    { ago: 62, kind: 'PURCHASE', vendor: 0, category: 'Purchases', lines: [{ name: 'Sticker stock', hsn: '481190', qty: 40, rate: 210, tax: 18 }, { name: 'Packaging cartons', hsn: '481920', qty: 30, rate: 85, tax: 12 }], paid: 'part', dueDays: 30 },
    { ago: 41, kind: 'EXPENSE', category: 'Marketing', lines: [{ name: 'Social media ads', qty: 1, rate: 15000, tax: 18 }], paid: 'full', dueDays: 0 },
    { ago: 20, kind: 'PURCHASE', vendor: 1, category: 'Software & subscriptions', lines: [{ name: 'Domain + SSL renewals', hsn: '998315', qty: 3, rate: 1800, tax: 18 }], paid: 'none', dueDays: 30 },
    { ago: 9, kind: 'EXPENSE', category: 'Utilities', lines: [{ name: 'Broadband', qty: 1, rate: 1500, tax: 18 }], paid: 'none', dueDays: 10 },
  ];
  const purchases: Demo<PurchaseRecord>[] = [];
  const purchasePayments: Demo<PurchasePayment>[] = [];
  purchaseSpecs.forEach((s, i) => {
    const vendor = s.vendor === undefined ? undefined : vendors[s.vendor];
    const date = shiftDay(today, -s.ago);
    const pos = vendor?.state_code ?? '27';
    const id = `demo-purchase-${String(i + 1).padStart(2, '0')}`;
    const lines = s.lines.map((l, li) => ({
      id: `${id}-l${li + 1}`,
      name: l.name,
      hsn: l.hsn,
      quantity: l.qty,
      rate: l.rate,
      tax_rate: l.tax,
    }));
    const t = computePurchaseTotals(lines, { placeOfSupply: pos, businessState: '27' });
    const paid = s.paid === 'full' ? t.total : s.paid === 'part' ? round2(Math.round(t.total / 2 / 100) * 100) : 0;
    purchases.push({
      id,
      demo: true,
      kind: s.kind,
      vendor_id: vendor?.id,
      vendor_name: vendor?.name ?? '',
      vendor_gstin: vendor?.gstin,
      bill_number: `DEMO-BILL-${101 + i}`,
      date,
      due_date: shiftDay(date, s.dueDays),
      place_of_supply: pos,
      category: s.category,
      lines,
      taxable: t.taxable,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      itc_eligible: s.kind === 'PURCHASE' && t.tax > 0,
      total: t.total,
      amount_paid: paid,
      notes: 'Sample bill from the demo data.',
    });
    if (paid > 0) {
      const when = shiftDay(date, Math.min(s.dueDays, 3));
      purchasePayments.push({
        id: `demo-ppay-${String(purchasePayments.length + 1).padStart(2, '0')}`,
        demo: true,
        purchase_id: id,
        amount: paid,
        date: when > today ? today : when,
        method: s.kind === 'EXPENSE' ? 'UPI' : 'Bank transfer',
        reference: `DEMO-PREF-${i + 1}`,
      } as Demo<PurchasePayment>);
    }
  });

  return { profile, clients, items, invoices, payments, vendors, purchases, purchasePayments };
}

/* ── Status ───────────────────────────────────────────────────── */

function demoScheduleIds(): Set<string> {
  return new Set(getTable<Demo<RecurringSchedule>>(RECURRING_TABLE).filter(isDemo).map((s) => s.id));
}

function isDemoInvoice(inv: Demo<InvoiceRecord>, schedules: Set<string>): boolean {
  return isDemo(inv) || (!!inv.recurring_id && schedules.has(inv.recurring_id));
}

export function demoStatus(): DemoStatus {
  const schedules = demoScheduleIds();
  const invoices = getTable<Demo<InvoiceRecord>>(KEYS.invoices);
  const demoInvoices = invoices.filter((i) => isDemoInvoice(i, schedules));
  const settings = localDb.settings.get();
  const counts: DemoCounts = {
    profiles: settings.profiles.filter(isDemo).length,
    clients: getTable<Demo<Client>>(KEYS.clients).filter(isDemo).length,
    items: getTable<Demo<InvoiceItem>>(KEYS.items).filter(isDemo).length,
    invoices: demoInvoices.length,
    creditNotes: demoInvoices.filter((i) => i.doc_type === 'CREDIT_NOTE').length,
    payments: getTable<Demo<Payment>>(KEYS.transactions).filter(isDemo).length,
    vendors: getTable<Demo<Vendor>>(VENDORS_TABLE).filter(isDemo).length,
    purchases: getTable<Demo<PurchaseRecord>>(PURCHASES_TABLE).filter(isDemo).length,
    schedules: schedules.size,
  };
  const loaded = Object.values(counts).some((n) => n > 0);
  return { loaded, counts, realInvoices: invoices.length - demoInvoices.length };
}

export const isDemoLoaded = (): boolean => demoStatus().loaded;

/* ── Load ─────────────────────────────────────────────────────── */

export interface LoadDemoOptions {
  /** Proceed even though the user already has invoices of their own. */
  confirm?: boolean;
  /** Anchor for the "last six months" (defaults to now). Tests pass a fixed day. */
  today?: Date | string;
}

export function loadDemoData(opts: LoadDemoOptions = {}): DemoLoadResult {
  const status = demoStatus();
  if (status.loaded) return { ok: false, reason: 'already_loaded' };
  if (status.realInvoices > 0 && !opts.confirm) {
    return { ok: false, reason: 'has_real_data', realInvoices: status.realInvoices };
  }

  const today = typeof opts.today === 'string' ? opts.today : localDayOf(opts.today ?? new Date());
  const data = buildDemoDataset(today);

  // Everything `localDb.invoices.save` is allowed to touch as a side effect, restored afterwards.
  const realClients = getTable<Client>(KEYS.clients);
  const realItems = getTable<InvoiceItem>(KEYS.items);
  const rawSnapshots = new Map<string, string | null>(
    [SINGLETON_KEYS.settings].map((k) => [k, readRaw(k)] as [string, string | null]),
  );

  try {
    // Payments first: `save` keeps the ledger as the floor for what has been received.
    setTable(KEYS.transactions, [...getTable<Payment>(KEYS.transactions), ...data.payments]);

    for (const inv of data.invoices) localDb.invoices.save(inv);

    // One credit note, raised through the same validator the app uses.
    const saved = localDb.invoices.getAll() as Demo<InvoiceRecord>[];
    const target = saved.find((i) => i.id === `demo-inv-${String(CREDIT_INDEX + 1).padStart(2, '0')}`);
    const links: Demo<DocLink>[] = [];
    if (target) {
      const day = shiftDay(target.issue_date, 10) > today ? today : shiftDay(target.issue_date, 10);
      const { record, errors } = buildCreditNote(
        target,
        { lines: [{ itemId: target.items[0].id, quantity: 1 }], reason: 'Sales return' },
        links,
        saved,
        { id: 'demo-cn-01', invoice_number: buildInvoiceNumber('DEMOCN', getIndianFY(day).label, 1), today: day },
      );
      if (!record) throw new Error(`Could not build the sample credit note: ${errors.join(' ')}`);
      localDb.invoices.save({ ...record, demo: true } as Demo<InvoiceRecord>);
      links.push({
        id: 'demo-link-01',
        demo: true,
        from_id: target.id,
        to_id: record.id,
        relation: 'credit_note',
        reason: 'Sales return',
        created_at: `${day}T10:00:00.000Z`,
      });
      setTable(DOC_LINKS_TABLE, [...getTable<DocLink>(DOC_LINKS_TABLE), ...links]);
    }

    // The save side-effects grew the CRM / catalogue with un-marked rows; replace with exact state.
    setTable(KEYS.clients, [...realClients, ...data.clients]);
    setTable(KEYS.items, [...realItems, ...data.items]);

    // Purchase side.
    setTable(VENDORS_TABLE, [...getTable<Vendor>(VENDORS_TABLE), ...data.vendors]);
    setTable(PURCHASES_TABLE, [...getTable<PurchaseRecord>(PURCHASES_TABLE), ...data.purchases]);
    setTable(PAYMENTS_TABLE, [...getTable<PurchasePayment>(PAYMENTS_TABLE), ...data.purchasePayments]);

    // Recurring retainer, first run next month (never in the past: nothing is auto-generated now).
    const retainer = data.invoices[RETAINER_INDEX];
    const next = nextMonthStart(today);
    const schedule: Demo<RecurringSchedule> = {
      ...createSchedule({
        name: 'Monthly retainer (demo)',
        template: templateFromInvoice(retainer),
        frequency: 'monthly',
        start_date: next,
        due_in_days: 15,
        mode: 'draft',
      }),
      id: 'demo-sched-01',
      demo: true,
    };
    setTable(RECURRING_TABLE, [...getTable<RecurringSchedule>(RECURRING_TABLE), schedule]);

    // Business profile: added next to the user's own, activated only over an empty starter profile.
    const settings = localDb.settings.get();
    const active = settings.profiles.find((p) => p.id === settings.activeProfileId);
    const activeIsBlank = !active || !(active.companyName ?? '').trim();
    localDb.settings.save({
      ...settings,
      profiles: [...settings.profiles, data.profile],
      activeProfileId: activeIsBlank ? data.profile.id! : settings.activeProfileId,
    });
  } catch (err) {
    // Roll back: demo rows out, anything the failed run touched back to how it was.
    try {
      removeDemoData();
      setTable(KEYS.clients, realClients);
      setTable(KEYS.items, realItems);
      for (const [k, v] of rawSnapshots) if (v !== null) writeRaw(k, v);
    } catch {
      /* the original error is the useful one */
    }
    throw err;
  }
  return { ok: true, counts: demoStatus().counts };
}

function nextMonthStart(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/* ── Remove ───────────────────────────────────────────────────── */

/** Deletes exactly the demo rows (and what the demo schedule generated). Returns what was removed. */
export function removeDemoData(): DemoCounts {
  const before = demoStatus().counts;
  const schedules = demoScheduleIds();

  const invoices = getTable<Demo<InvoiceRecord>>(KEYS.invoices);
  const goneInvoices = new Set(invoices.filter((i) => isDemoInvoice(i, schedules)).map((i) => i.id));

  const filterTable = <T>(table: string, drop: (row: T) => boolean): void => {
    const rows = getTable<T>(table);
    const kept = rows.filter((r) => !drop(r));
    if (kept.length !== rows.length) setTable(table, kept);
  };

  filterTable<Demo<InvoiceRecord>>(KEYS.invoices, (i) => goneInvoices.has(i.id));
  filterTable<Demo<Payment>>(KEYS.transactions, (p) => isDemo(p) || goneInvoices.has(p.invoice_id));
  filterTable<Demo<DocLink>>(DOC_LINKS_TABLE, (l) => isDemo(l) || goneInvoices.has(l.from_id) || goneInvoices.has(l.to_id));
  filterTable<{ invoice_id: string }>(EINVOICE_META_TABLE, (m) => goneInvoices.has(m.invoice_id));
  filterTable<{ invoice_id: string }>(REMINDERS_TABLE, (r) => goneInvoices.has(r.invoice_id));
  filterTable<Demo<Client>>(KEYS.clients, isDemo);
  filterTable<Demo<InvoiceItem>>(KEYS.items, isDemo);

  const gonePurchases = new Set(getTable<Demo<PurchaseRecord>>(PURCHASES_TABLE).filter(isDemo).map((p) => p.id));
  filterTable<Demo<PurchaseRecord>>(PURCHASES_TABLE, isDemo);
  filterTable<Demo<PurchasePayment>>(PAYMENTS_TABLE, (p) => isDemo(p) || gonePurchases.has(p.purchase_id));
  filterTable<Demo<Vendor>>(VENDORS_TABLE, isDemo);
  filterTable<Demo<RecurringSchedule>>(RECURRING_TABLE, isDemo);

  // Profile(s): keep the settings object otherwise untouched; fix the active id if it pointed at demo.
  if (readRaw(SINGLETON_KEYS.settings) !== null) {
    const settings = localDb.settings.get();
    if (settings.profiles.some(isDemo)) {
      const profiles = settings.profiles.filter((p) => !isDemo(p));
      const next = profiles.length ? profiles : [blankProfile()];
      localDb.settings.save({
        ...settings,
        profiles: next,
        activeProfileId: next.some((p) => p.id === settings.activeProfileId) ? settings.activeProfileId : next[0].id!,
      });
    }
  }
  return before;
}
