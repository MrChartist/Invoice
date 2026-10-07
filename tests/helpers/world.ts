/**
 * Builders for end-to-end scenarios. Everything goes through the same public
 * lib/store APIs the UI uses; nothing here reaches into private state.
 */
import { localDb } from '../../src/lib/localDb.ts';
import { useInvoiceStore } from '../../src/store/useInvoiceStore.ts';
import { gstinChecksumChar } from '../../src/lib/gstin.ts';
import type {
  Client,
  DocumentType,
  InvoiceItem,
  InvoiceRecord,
  SenderProfile,
  SupplyType,
} from '../../src/types/invoice.ts';

export const gstin = (first14: string) => first14 + gstinChecksumChar(first14);
export const SELLER_GSTIN = gstin('27AABCU9603R1Z'); // Maharashtra
export const BUYER_MH = gstin('27AAACB2230M1Z');
export const BUYER_KA = gstin('29AABCT1332L1Z');
export const BUYER_SEZ_GJ = gstin('24AAACS1234A1Z'); // Gujarat (stand-in for an SEZ unit)

export const SELLER: SenderProfile = {
  id: 'prof1',
  companyName: 'Mr Chartist Research',
  companyTagline: '',
  companyEmail: 'billing@example.com',
  companyPhone: '+91 98765 43210',
  companyAddress: '12 Dalal Street, Fort, Mumbai, Maharashtra 400001',
  companyGstin: SELLER_GSTIN,
  companyWebsite: '',
  stateCode: '27',
  city: 'Mumbai',
  pin: '400001',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  upiId: 'chartist@upi',
  invoicePrefix: '',
};

export function installSettings(over: Partial<ReturnType<typeof localDb.settings.get>> = {}): void {
  const base = localDb.settings.get();
  localDb.settings.save({
    ...base,
    profiles: [SELLER],
    activeProfileId: SELLER.id as string,
    invoicePrefix: 'INV',
    defaultTaxRate: 18,
    defaultDueDays: 14,
    roundOff: true,
    onboarded: true,
    ...over,
  });
}

export const clientMH: Client = {
  id: 'c-mh',
  name: 'Bharat Traders',
  email: 'accounts@bharat.example',
  address: '5 MG Road, Pune, Maharashtra 411001',
  city: 'Pune',
  zip: '411001',
  gstin: BUYER_MH,
  state_code: '27',
};

export const clientKA: Client = {
  id: 'c-ka',
  name: 'Karnataka Tech',
  email: 'ap@kt.example',
  address: '1 Brigade Road, Bengaluru, Karnataka 560001',
  city: 'Bengaluru',
  zip: '560001',
  gstin: BUYER_KA,
  state_code: '29',
};

export const clientRetail: Client = {
  id: 'c-retail',
  name: 'Walk-in Customer',
  email: '',
  address: '',
  city: 'Mumbai',
  zip: '',
  state_code: '27',
};

export const clientUS: Client = {
  id: 'c-us',
  name: 'Acme Inc',
  email: 'ap@acme.example',
  address: '1 Market St, San Francisco, USA',
  city: 'San Francisco',
  zip: '94105',
  state_code: '99',
};

export interface LineSpec {
  name?: string;
  hsn?: string;
  qty: number;
  rate: number;
  tax?: number;
  disc?: number;
  cess?: number;
  cessPerUnit?: number;
  unit?: string;
}

export interface InvSpec {
  client?: Client;
  date: string;
  due?: string;
  lines: LineSpec[];
  docType?: DocumentType;
  invoiceDiscount?: { type: 'PERCENT' | 'AMOUNT'; value: number };
  shipping?: number;
  other?: number;
  roundMode?: 'nearest' | 'up' | 'down' | 'none';
  supply?: SupplyType;
  inclusive?: boolean;
  tcs?: { rate: number; base?: 'taxable' | 'total' };
  tds?: { rate: number; onTaxable?: boolean };
  reverseCharge?: boolean;
  pos?: string;
  asDraft?: boolean;
  gstMode?: 'NONE' | 'SINGLE' | 'CGST_SGST' | 'IGST';
  currency?: string;
  number?: string;
  /** Per-profile document number prefix (Settings > profile). */
  prefix?: string;
  status?: InvoiceRecord['status'];
}

/** Create + save a document THROUGH THE ZUSTAND STORE, exactly as the creator page does. */
export function createViaStore(spec: InvSpec): InvoiceRecord {
  const s = useInvoiceStore.getState();
  s.newDraft(spec.docType ?? 'INVOICE');
  const st = () => useInvoiceStore.getState();
  st().setSender(spec.prefix ? { ...SELLER, invoicePrefix: spec.prefix } : SELLER);
  st().setClient(spec.client ?? clientMH);
  st().setDates(spec.date, spec.due ?? spec.date);
  if (spec.currency) st().setCurrency(spec.currency);
  if (spec.pos) st().setPlaceOfSupply(spec.pos);
  if (spec.gstMode) st().setGstMode(spec.gstMode);
  if (spec.number) st().setInvoiceNumber(spec.number);

  spec.lines.forEach((l, i) => {
    if (i > 0) st().addItem();
    const id = st().items[i].id;
    const upd = (f: keyof InvoiceItem, v: string | number) => st().updateItem(id, f, v);
    upd('name', l.name ?? `Item ${i + 1}`);
    upd('hsn', l.hsn ?? '998311');
    upd('unit', l.unit ?? 'NOS');
    upd('quantity', l.qty);
    upd('rate', l.rate);
    upd('tax_rate', l.tax ?? 18);
    if (l.disc) upd('discount_percent', l.disc);
    if (l.cess) upd('cess_rate', l.cess);
    if (l.cessPerUnit) upd('cess_per_unit', l.cessPerUnit);
  });

  if (spec.invoiceDiscount) st().setDiscount(spec.invoiceDiscount.type, spec.invoiceDiscount.value);
  if (spec.shipping) st().setShipping(spec.shipping);
  if (spec.other) st().setOtherCharges(spec.other);
  if (spec.roundMode) st().setRoundMode(spec.roundMode);
  if (spec.supply) st().setSupplyType(spec.supply);
  if (spec.inclusive) st().setPriceIncludesTax(true);
  if (spec.tcs) st().setTcs({ enabled: true, rate: spec.tcs.rate, base: spec.tcs.base ?? 'total' });
  if (spec.tds) st().setTds({ enabled: true, rate: spec.tds.rate, onTaxable: spec.tds.onTaxable ?? true });
  if (spec.reverseCharge) st().setReverseCharge(true);

  const result = st().saveInvoice({ asDraft: spec.asDraft });
  if (!result.ok || !result.record) throw new Error(`createViaStore failed: ${result.errors.join('; ')}`);
  let rec = result.record;
  if (spec.status && spec.status !== rec.status) {
    localDb.invoices.setStatus(rec.id, spec.status);
    rec = localDb.invoices.getById(rec.id) as InvoiceRecord;
  }
  return rec;
}

/** Fresh read of a stored invoice. */
export const reload = (id: string): InvoiceRecord => localDb.invoices.getById(id) as InvoiceRecord;
