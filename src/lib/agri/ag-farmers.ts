/**
 * AG-A2 farmers and members. A farmer who sells to us is a **vendor** with the sub-object `ag` (code, village, centre,
 * member no., bank, UPI, Aadhaar last four only, language); a cold-storage depositor or a dealer's farmer customer is a
 * **client** with `ag`; one person may be both, linked by the same `ag.code`. Every farmer vendor carries
 * `principal_kind: 'agriculturist'` (R8) so the RCM prompt, the patti code and the Rule 6DD(e) cash check see him.
 * The full Aadhaar number is never stored (DPDP Act 2023): the field takes exactly four digits.
 * Balances read purchases through the contract (`readPurchase`). Pure above "Storage".
 */
import './ag-registry';
import type { AgParty, FarmerCycle } from '../../types/agri-r12';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { num, round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { requireAccess } from '../access';
import { vendorsDb } from '../vendors';
import { withTablesRollback } from '../table-txn';

export type Farmer = Vendor & { ag: AgParty };
const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** `F-0001` … the next code above every code in use (vendors and clients). */
export function nextFarmerCode(codes: readonly (string | undefined)[]): string {
  const high = codes.reduce((m, c) => Math.max(m, Number(/^F-(\d+)$/i.exec(c ?? '')?.[1] ?? 0)), 0);
  return `F-${String(high + 1).padStart(4, '0')}`;
}

/** Aadhaar: empty or exactly four digits (never the full number). */
export const aadhaarProblem = (v: unknown): string => (v === undefined || v === '' || /^\d{4}$/.test(String(v)) ? '' : 'Type only the last 4 digits of the Aadhaar number (the full number is never stored).');

/** Clean the `ag` sub-object (unknown keys and bad values dropped). Throws on a bad Aadhaar field. */
export function cleanParty(raw: Partial<AgParty> & { code?: string }): AgParty {
  const p = aadhaarProblem(raw.aadhaar_last4);
  if (p) throw new Error(p);
  const code = str(raw.code, 20);
  if (!code) throw new Error('Give the farmer a code.');
  const bank = raw.bank && (str(raw.bank.account) || str(raw.bank.ifsc)) ? { ...(str(raw.bank.name) ? { name: str(raw.bank.name) } : {}), ...(str(raw.bank.account) ? { account: digits(raw.bank.account) } : {}), ...(str(raw.bank.ifsc) ? { ifsc: String(raw.bank.ifsc).trim().toUpperCase() } : {}) } : undefined;
  const out: AgParty = { code: code.toUpperCase(), status: raw.status === 'inactive' ? 'inactive' : 'active', member: !!raw.member };
  for (const k of ['village', 'centre_id', 'route', 'member_no', 'member_since', 'upi', 'kcc_no'] as const) if (str(raw[k])) out[k] = str(raw[k]);
  if (digits(raw.phone).length >= 10) out.phone = digits(raw.phone).slice(-10);
  if (raw.aadhaar_last4) out.aadhaar_last4 = String(raw.aadhaar_last4);
  if (num(raw.land_acres) > 0) out.land_acres = num(raw.land_acres);
  if (raw.crops?.length) out.crops = raw.crops.map((c) => String(c).trim()).filter(Boolean);
  if (raw.animals && (num(raw.animals.cows) || num(raw.animals.buffaloes))) out.animals = { cows: num(raw.animals.cows), buffaloes: num(raw.animals.buffaloes) };
  if (bank) out.bank = bank;
  if (raw.language === 'hi') out.language = 'hi';
  return out;
}

/** The vendor row of a farmer: `ag`, `principal_kind: 'agriculturist'`, bank fields mirrored for e-payment files. */
export function farmerVendor(input: { id?: string; name: string; ag: Partial<AgParty> & { code?: string } }, existing?: Vendor): Omit<Vendor, 'id'> & { id?: string } {
  const ag = cleanParty(input.ag);
  if (!input.name.trim()) throw new Error('Type the farmer\'s name.');
  return {
    ...existing, ...(input.id ? { id: input.id } : {}), name: input.name.trim(), ag, principal_kind: 'agriculturist',
    ...(ag.phone ? { phone: ag.phone } : {}),
    ...(ag.bank?.account ? { bank_account_no: ag.bank.account, bank_ifsc: ag.bank.ifsc, ...(ag.bank.name ? { bank_name: ag.bank.name } : {}) } : {}),
  };
}

export const isFarmer = (v: Partial<Vendor> | undefined): v is Farmer => !!v?.ag?.code;

/** Soft warnings: the same phone or the same bank account on another farmer; a code already used. */
export function duplicateWarnings(f: { id?: string; ag: Partial<AgParty> }, all: readonly Farmer[]): string[] {
  const others = all.filter((x) => x.id !== f.id);
  const out: string[] = [];
  const code = String(f.ag.code ?? '').toUpperCase();
  const hit = (pick: (x: Farmer) => string | undefined, v: string | undefined, what: string) => {
    const o = v && others.find((x) => pick(x) === v);
    if (o) out.push(`Same ${what} as ${o.name} (${o.ag.code}).`);
  };
  if (code && others.some((x) => x.ag.code.toUpperCase() === code)) out.push(`Code ${code} is already used.`);
  hit((x) => x.ag.phone, digits(f.ag.phone).slice(-10) || undefined, 'phone');
  hit((x) => x.ag.bank?.account, digits(f.ag.bank?.account) || undefined, 'bank account');
  return out;
}

/** Search by code, phone or name (case-insensitive). */
export const searchFarmers = (all: readonly Farmer[], q: string): Farmer[] => {
  const s = q.trim().toLowerCase();
  return s ? all.filter((f) => f.ag.code.toLowerCase().includes(s) || f.name.toLowerCase().includes(s) || (f.ag.phone ?? '').includes(s) || (f.ag.village ?? '').toLowerCase().includes(s)) : [...all];
};

export interface FarmerBalance { payable: number; receivable: number }

/**
 * Balances per farmer vendor id: payable = his own vouchers' unpaid amount (read through the purchases contract) + his
 * net on closed, unpaid pooled cycles; receivable = unpaid sales to the client linked by the same `ag.code`.
 */
export function farmerBalances(farmers: readonly Farmer[], purchases: readonly unknown[], cycles: readonly FarmerCycle[], clients: readonly Client[], invoices: readonly InvoiceRecord[], payments: readonly Payment[]): Map<string, FarmerBalance> {
  const out = new Map<string, FarmerBalance>(farmers.map((f) => [f.id, { payable: 0, receivable: 0 }]));
  for (const raw of purchases) {
    const c = readPurchase(raw);
    const vid = (raw as Partial<PurchaseRecord>)?.vendor_id;
    const b = vid ? out.get(vid) : undefined;
    if (!c || !b || isVoidStatus(c.status) || (raw as PurchaseRecord).ag?.cycle_id) continue;
    b.payable = round2(b.payable + Math.max(c.total - c.paid, 0));
  }
  for (const cy of cycles) if (cy.status === 'closed') for (const l of cy.lines) {
    const b = out.get(l.farmer_id);
    if (b) b.payable = round2(b.payable + Math.max(num(l.net), 0));
  }
  const clientCode = new Map(clients.filter((c) => c.ag?.code && c.id).map((c) => [c.id!, c.ag!.code.toUpperCase()]));
  const byCode = new Map(farmers.map((f) => [f.ag.code.toUpperCase(), f.id]));
  const paid = new Map<string, number>();
  for (const p of payments) paid.set(p.invoice_id, round2((paid.get(p.invoice_id) ?? 0) + num(p.amount)));
  for (const inv of invoices) {
    const vid = byCode.get(clientCode.get(inv.client?.id ?? '') ?? '');
    const b = vid ? out.get(vid) : undefined;
    if (!b || inv.status === 'Cancelled' || inv.status === 'Draft' || inv.doc_type === 'QUOTATION' || inv.doc_type === 'PROFORMA') continue;
    b.receivable = round2(b.receivable + Math.max(num(inv.total) - (paid.get(inv.id) ?? 0), 0));
  }
  return out;
}

/** Export rows (no Aadhaar digits beyond the last four, which is all that is stored). */
export function farmersCsv(all: readonly Farmer[], bal?: Map<string, FarmerBalance>): string {
  return toCsv([
    ['Code', 'Name', 'Village', 'Centre', 'Member no.', 'Phone', 'Bank account', 'IFSC', 'UPI', 'Aadhaar (last 4)', 'Status', 'Payable', 'Receivable'],
    ...all.map((f) => [f.ag.code, f.name, f.ag.village ?? '', f.ag.centre_id ?? '', f.ag.member_no ?? '', f.ag.phone ?? '', f.ag.bank?.account ?? '', f.ag.bank?.ifsc ?? '', f.ag.upi ?? '', f.ag.aadhaar_last4 ?? '', f.ag.status ?? 'active', bal?.get(f.id)?.payable ?? 0, bal?.get(f.id)?.receivable ?? 0]),
  ]);
}

/**
 * Import rows (the "Farmers" mapping: code, name, village, member no., phone, account, IFSC, UPI, Aadhaar last 4) →
 * vendor inputs. Rows without a name are skipped; a missing code takes the next one.
 */
export function farmersFromRows(rows: readonly Record<string, string>[], used: readonly string[]): { name: string; ag: Partial<AgParty> & { code: string } }[] {
  const codes = [...used];
  const out: { name: string; ag: Partial<AgParty> & { code: string } }[] = [];
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const [k, v] of Object.entries(r)) if (keys.includes(k.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))) return String(v ?? '').trim();
    return '';
  };
  for (const r of rows) {
    const name = pick(r, 'name', 'farmer', 'farmername', 'member');
    if (!name) continue;
    const code = pick(r, 'code', 'farmercode') || nextFarmerCode(codes);
    codes.push(code);
    const aad = pick(r, 'aadhaarlast4', 'aadhaar', 'aadhar').replace(/\D/g, '').slice(-4);
    out.push({ name, ag: { code, village: pick(r, 'village', 'gaon'), member_no: pick(r, 'memberno', 'membernumber'), phone: pick(r, 'phone', 'mobile'), upi: pick(r, 'upi', 'upiid'), ...(aad.length === 4 ? { aadhaar_last4: aad } : {}), bank: { account: pick(r, 'account', 'bankaccount', 'accountno'), ifsc: pick(r, 'ifsc') } } });
  }
  return out;
}

/* ── Storage ── */

/** Farmer vendors. */
export const loadFarmers = (): Farmer[] => vendorsDb.all().filter(isFarmer);

/** Save a farmer (`master.edit`); a blank code takes the next `F-0001` code. */
export function saveFarmer(input: { id?: string; name: string; ag: Partial<AgParty> & { code?: string } }): Farmer {
  requireAccess('master.edit');
  const code = input.ag.code?.trim() || nextFarmerCode(loadFarmers().map((f) => f.ag.code));
  if (loadFarmers().some((f) => f.id !== input.id && f.ag.code.toUpperCase() === code.toUpperCase())) throw new Error(`Code ${code.toUpperCase()} is already used.`);
  const existing = input.id ? vendorsDb.all().find((v) => v.id === input.id) : undefined;
  return vendorsDb.save(farmerVendor({ ...input, ag: { ...input.ag, code } }, existing)) as Farmer;
}

/** Import parsed CSV rows (header → value); returns how many were added. */
export function importFarmers(rows: readonly Record<string, string>[]): number {
  requireAccess('master.edit');
  const list = farmersFromRows(rows, loadFarmers().map((f) => f.ag.code));
  return withTablesRollback(['vendors'], () => {
    for (const f of list) saveFarmer(f);
    return list.length;
  });
}
