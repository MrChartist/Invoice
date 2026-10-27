/**
 * Round 12 (agriculture) record fields by declaration merging. Minimum compatible version written by AG-D before AG-A
 * landed: the `ag` record key (one object, each package owns its sub-object — AG-D: `rent`, `inputs`), the farmer /
 * member sub-object on vendors and clients as AG-D reads it, and item `ag_class` / `ag_subsidised`. AG-A owns this file.
 */
import type { AgInputsSnap, AgRentSnap, AgriSettingsD } from './agri-r12d';

export interface AgSnapshot {
  kind: 'milk_sale' | 'rent' | 'inputs' | 'cmr' | 'produce' | 'job_milling';
  header?: Record<string, unknown>;
  lines?: Record<string, Record<string, unknown>>;
  // AG-D
  rent?: AgRentSnap;
  inputs?: AgInputsSnap;
}

/** The farmer / member master fields AG-D reads (AG-A2 defines the full shape). */
export interface FarmerInfo {
  code: string;
  village?: string;
  member_no?: string;
  member_since?: string;
  member: boolean;
  aadhaar_last4?: string;
  kcc_no?: string;
  phone?: string;
  language?: string;
  status?: 'active' | 'inactive';
}

/** `agri_settings`: AG-D's fields (`types/agri-r12d.ts`); AG-A adds the profile switches, centres and cycles. */
export type AgriSettings = AgriSettingsD & Record<string, unknown>;

// AG-D
declare module './invoice' {
  interface InvoiceRecord {
    /** Round 12 agri snapshot (kept by `normalizeRecord` through `R12_RECORD_KEYS`); printed from the record only. */
    ag?: AgSnapshot;
  }
  interface InvoiceItem {
    ag_class?: string;
    ag_subsidised?: boolean;
  }
  interface Client {
    ag?: FarmerInfo;
  }
}
declare module './purchases' {
  interface Vendor {
    ag?: FarmerInfo;
  }
  interface PurchaseRecord {
    ag?: Record<string, unknown>;
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    ag_class?: string;
    ag_subsidised?: boolean;
  }
}
