/** Vendor (supplier) master — table `vendors`. */

import type { PurchaseRecord, Vendor } from '../types/purchases';
import { checkGstin } from './gstin';
import { resolveStateCode } from './india-states';
import { balanceOf } from './purchases';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';

export const VENDORS_TABLE = 'vendors';

/** Returns an error message for an invalid vendor draft, or ''. GSTIN is optional (unregistered suppliers). */
export function validateVendor(v: Pick<Vendor, 'name' | 'gstin' | 'email'>): string {
  if (!v.name?.trim()) return 'Vendor name is required.';
  const gstin = (v.gstin ?? '').trim();
  if (gstin) {
    const check = checkGstin(gstin);
    if (!check.valid) return check.message ?? 'GSTIN is invalid.';
  }
  if (v.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) return 'Email address looks invalid.';
  return '';
}

export interface VendorBalance {
  vendor_id: string;
  bills: number;
  billed: number;
  outstanding: number;
}

/** Billed / outstanding totals per vendor id (bills without a vendor link are skipped). */
export function vendorBalances(purchases: PurchaseRecord[]): Map<string, VendorBalance> {
  const map = new Map<string, VendorBalance>();
  for (const p of purchases) {
    if (!p.vendor_id) continue;
    const row = map.get(p.vendor_id) ?? { vendor_id: p.vendor_id, bills: 0, billed: 0, outstanding: 0 };
    row.bills += 1;
    row.billed = round2(row.billed + p.total);
    row.outstanding = round2(row.outstanding + balanceOf(p));
    map.set(p.vendor_id, row);
  }
  return map;
}

export function searchVendors(vendors: Vendor[], query: string): Vendor[] {
  const q = query.trim().toLowerCase();
  const rows = q
    ? vendors.filter((v) => [v.name, v.gstin, v.phone, v.email].some((f) => (f ?? '').toLowerCase().includes(q)))
    : vendors;
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

export const vendorsDb = {
  all: (): Vendor[] => getTable<Vendor>(VENDORS_TABLE),
  get: (id: string): Vendor | undefined => vendorsDb.all().find((v) => v.id === id),

  save(input: Omit<Vendor, 'id'> & { id?: string }): Vendor {
    const problem = validateVendor(input);
    if (problem) throw new Error(problem);
    const rows = vendorsDb.all();
    const existing = input.id ? rows.find((v) => v.id === input.id) : undefined;
    const gstin = (input.gstin ?? '').trim().toUpperCase();
    const vendor: Vendor = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? generateId(),
      name: input.name.trim(),
      gstin: gstin || undefined,
      state_code: resolveStateCode({ code: input.state_code, gstin }) || undefined,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    setTable(VENDORS_TABLE, existing ? rows.map((v) => (v.id === vendor.id ? vendor : v)) : [...rows, vendor]);
    return vendor;
  },

  /** Deleting a vendor keeps its bills (they carry vendor_name / GSTIN snapshots). */
  remove: (id: string): void => setTable(VENDORS_TABLE, vendorsDb.all().filter((v) => v.id !== id)),
};
