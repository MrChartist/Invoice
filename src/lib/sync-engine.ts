/**
 * Folder sync (roadmap 5.7): change detection, merge and conflict handling. Loaded on demand only.
 *
 * Model (docs/features/sync.md):
 *  - Change detection happens at sync time, not on every write: each row's content hash is compared
 *    with the hash recorded at the last sync (`sync_state`). Nothing is added to the save path, so the
 *    5,000-row performance caps are untouched and every writer (localDb, purchases, imports, restore…)
 *    is covered without wiring. An idle run (no data key and no peer file changed) stops after hashing.
 *  - Every row / singleton version carries a version vector (`vv`: device id → that device's Lamport
 *    counter when it made the change). Merge compares vectors, never wall clocks: remote dominates →
 *    take it; local dominates → keep; neither → concurrent → CONFLICT (rows: keep local, store remote;
 *    singletons: last writer by Lamport time wins, the other version is listed). Tombstones are rows
 *    too, so a delete wins only when it causally follows the other side's last edit.
 *  - Rows are matched by table + id. Each device writes only its own snapshot file, so the cloud
 *    client never sees two writers on one file.
 */

import { mergeRows as mergeFields, validateMerged, type FieldPicks } from './trust/field-merge';
// R4-C7: the conflict screen reads the merge helpers through this module, so they stay in the sync chunk.
export * as fieldMerge from './trust/field-merge';
import { AUDIT_MAX_ROWS, audit, canonical } from './audit';
import { noteExternalChange } from './cross-tab';
import { attachmentKey, parseStoredAttachment, referencedAttachmentIds, storedAttachmentIds, ATTACHMENT_KEY_PREFIX } from './attachments';
import { numberKey, parseDocNumber } from './invoice-number';
import { LATEST_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from './migrations';
import { isDateLocked, normalizeLockDate } from './period-lock';
import { openingDayFor, storedBooksBegin } from './ledger/openings';
import { activeCompanyId } from './company-registry';
import { asSystem, requireAccess, requireTableWrite, type AccessAction } from './access';
import { SNAPSHOT_TABLES, ASSET_TABLE, parseAssets, referencedAssets } from './assets';
import { companySyncPrefs, setCompanySyncPrefs, type SyncRunSummary } from './sync-device';
import {
  DB_PREFIX,
  DEVICE_LOCAL_KEYS,
  SINGLETON_KEYS,
  SYNC_META_KEYS,
  DEVICE_DRAFT_KEYS,
  isLocalOnlyKey,
  listKeys,
  readRaw,
  removeRaw,
  writeRaw,
} from './storage';
import {
  BLOB_EXT,
  SYNC_APP,
  deviceFileName,
  isAttachmentId,
  listDeviceIds,
  openGroup,
  openSealed,
  readFileText,
  readSealed,
  SyncFileError,
  withRetry,
  writeSealed,
  type GroupDirs,
  type SyncDir,
  type SyncKey,
} from './sync-files';
import type { AuditEntry } from '../types/audit';
import './trade/tr-registry'; // R8-C: Round 8 tables' rights and audit labels (lazy registration)
import './hotel/hotel-registry'; // R7: hotel tables' rights and audit labels (lazy registration)
import './retail/rt-registry'; // R9: retail tables' rights and audit labels (lazy registration)
import './construction/cn-registry'; // R11: construction tables' rights and audit labels (lazy registration)
import './services/sv-registry'; // R10: service tables' rights and audit labels (lazy registration)
import './agri/ag-registry'; // R12: agri tables' rights and audit labels (lazy registration)
import './mfg/mf-registry'; // R13: manufacturing tables' rights and audit labels (lazy registration)
import './prof/ps-registry'; // R14: professional tables' rights and audit labels (lazy registration)
import './travel/tv-registry'; // R15: travel tables' rights and audit labels (lazy registration)
import './manpower/mp-registry'; // R17: manpower tables' rights and audit labels (lazy registration)
import './society/hs-registry'; // R18: society tables' rights and audit labels (lazy registration)

export const [SYNC_STATE_KEY, SYNC_CONFLICTS_KEY, SYNC_AUDIT_KEY] = SYNC_META_KEYS;

/* ── Types ─────────────────────────────────────────────────────── */

export type VV = Record<string, number>;

/** One version of a row or singleton. */
export interface RowMeta {
  /** Content hash of the stored JSON ('' for a tombstone). */
  h: string;
  /** Lamport time of the change. */
  t: number;
  /** Device that made it. */
  d: string;
  vv: VV;
  /** Device that first introduced the row (numbering-series warnings). */
  o: string;
  /** Tombstone. */
  del?: 1;
}

type KeyState = { mode: 'rows'; rows: Record<string, RowMeta> } | { mode: 'single'; meta: RowMeta };

export interface PeerInfo {
  name: string;
  clock: number;
  /** The peer's own clock when it wrote its file (display only; never used for ordering). */
  written_at: string;
  seen_at: string;
  status: 'ok' | 'unreadable' | 'version' | 'stale' | 'skipped';
  message?: string;
  prefix?: string;
  blobs?: string[];
  /** Hash of the file text last merged: an unchanged file is not decrypted or merged again. */
  file_hash?: string;
}

export interface SyncReport {
  ok: boolean;
  at: string;
  added: number;
  updated: number;
  deleted: number;
  conflicts: number;
  newConflicts: number;
  peers: number;
  unreadable: { device: string; name?: string; message: string }[];
  wrote: boolean;
  blobsIn: number;
  blobsOut: number;
  /** Nothing changed anywhere: the run stopped after hashing. */
  idle?: boolean;
  reason?: 'permission' | 'no-folder' | 'unsupported' | 'error' | 'busy' | 'passphrase' | 'denied';
  message?: string;
}

export interface SyncState {
  v: 1;
  group: string;
  clock: number;
  keys: Record<string, KeyState>;
  peers: Record<string, PeerInfo>;
  blobs_written: string[];
  dup_ack: string[];
  /** Locked-period changes the user chose not to take: `key|row id` → remote content hash. */
  declined: Record<string, string>;
  /** Hash of every synced key's stored text at the end of the last run (idle detection). */
  key_h?: Record<string, string>;
  /** Referenced attachment files still missing after the last run. */
  blobs_missing?: number;
  last_sync?: string;
  last_written?: string;
  last_written_hash?: string;
}

export interface ConflictSide {
  meta: RowMeta | null;
  /** Rows: the row object (null = deleted / absent). Singletons: the stored string (null = removed). */
  value: unknown;
}

export type SyncConflict =
  | {
      id: string;
      kind: 'row' | 'single';
      key: string;
      row_id?: string;
      /**
       * concurrent edits / a change into a locked period / singleton last-writer-wins / a settings
       * change to the payment details printed on invoices (UPI, bank account), held for the owner.
       */
      reason: 'concurrent' | 'locked' | 'lww' | 'payment';
      /** Taking the other version would write into a locked period (or loosen the lock): needs the PIN. */
      locked?: boolean;
      device: string;
      device_name: string;
      at: string;
      local: ConflictSide;
      remote: ConflictSide;
      /** Singletons: which version is in use now. */
      applied?: 'local' | 'remote';
    }
  | {
      id: string;
      kind: 'duplicate';
      /** Table the documents are in (invoices, advances, vouchers, stock transfers). */
      key: string;
      number: string;
      ids: string[];
      sig: string;
      at: string;
      docs: { id: string; number: string; client: string; date: string; total: number; device: string }[];
    };

export type RowConflict = Extract<SyncConflict, { kind: 'row' | 'single' }>;

interface RemoteKey {
  mode: 'rows' | 'single';
  rows?: Record<string, [RowMeta, unknown]>;
  meta?: RowMeta;
  value?: string | null;
}

export interface RemoteFile {
  app: typeof SYNC_APP;
  kind: 'state';
  v: 1;
  device: { id: string; name: string };
  group: string;
  schema: number;
  clock: number;
  written_at: string;
  prefix?: string;
  vv_max: VV;
  keys: Record<string, RemoteKey>;
  audit: AuditEntry[];
  blobs: string[];
}

/* ── Pure helpers ──────────────────────────────────────────────── */

/** Own-property lookup: row ids such as `constructor` must never resolve to Object.prototype members. */
const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/** 64-bit non-cryptographic string hash (cyrb53 variant) + length: cheap per-row change detection. */
export function hashStr(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}.${(h1 >>> 0).toString(36)}.${s.length.toString(36)}`;
}

export type VVOrder = 'eq' | 'gt' | 'lt' | 'cc';

/** Compare version vectors: a dominates b ('gt'), b dominates a ('lt'), equal, or concurrent ('cc'). */
export function compareVV(a: VV, b: VV): VVOrder {
  let gt = false;
  let lt = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = own(a, k) ?? 0;
    const y = own(b, k) ?? 0;
    if (x > y) gt = true;
    else if (x < y) lt = true;
    if (gt && lt) return 'cc';
  }
  return gt ? 'gt' : lt ? 'lt' : 'eq';
}

export const vvCovers = (a: VV, b: VV) => {
  const o = compareVV(a, b);
  return o === 'gt' || o === 'eq';
};

export function mergeVV(a: VV, b: VV): VV {
  const out: VV = { ...a };
  for (const [k, v] of Object.entries(b)) if (v > (own(out, k) ?? 0)) out[k] = v;
  return out;
}

const minStr = (a: string, b: string) => (a && b ? (a < b ? a : b) : a || b);
const cloneMeta = (m: RowMeta): RowMeta => ({ h: m.h, t: m.t, d: m.d, vv: { ...m.vv }, o: m.o, ...(m.del ? { del: 1 as const } : {}) });
/** Same content (hash + tombstone flag). */
const sameVersion = (a: RowMeta | null | undefined, b: RowMeta | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.h === b.h && !!a.del === !!b.del);

/** Per-device data and bookkeeping that must not travel between devices. */
const EXCLUDED = new Set<string>([
  // R4-C4: `recycle_bin` — a delete already syncs as a tombstone and a restore as a new version.
  ...['draft', 'schema_version', 'audit_log', 'recycle_bin', 'timer', 'backup_snooze', 'auto_backup', 'install_dismissed', 'notif_state', 'export_prefs', '__probe'].map((k) => DB_PREFIX + k),
  ...SYNC_META_KEYS,
  ...DEVICE_DRAFT_KEYS, // POS bills on hold (8.21) belong to this counter
  ...DEVICE_LOCAL_KEYS,
]);

export function isSyncedKey(key: string): boolean {
  // Audit archive segments (WP-7) belong to this device's own chain, like `audit_log`.
  return key.startsWith(DB_PREFIX) && !EXCLUDED.has(key) && !key.startsWith(ATTACHMENT_KEY_PREFIX) && !key.startsWith(`${DB_PREFIX}audit_archive_`) && !isLocalOnlyKey(key);
}

/** Opening balances post on the day before the books begin (local books-beginning date). */
const openingDay = (): string | undefined => {
  const begin = storedBooksBegin();
  return begin ? openingDayFor(begin) : undefined;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** A cheque is in the books from its latest banking event (deposit / clearing / bounce / cancel). */
const chequeDay = (r: Record<string, unknown>): string | undefined =>
  ['deposited_on', 'presented_on', 'cleared_on', 'bounced_on', 'cancelled_on'].map((k) => str(r[k])).filter(Boolean).sort().pop();

/**
 * Tables whose rows carry a document date that the period lock protects: the date field, or a
 * function of the row. Every table that reaches the ledger belongs here (security review M5).
 */
const DATED: Record<string, string | ((row: Record<string, unknown>) => string | undefined)> = {
  [`${DB_PREFIX}invoices`]: 'issue_date',
  [`${DB_PREFIX}transactions`]: 'date',
  [`${DB_PREFIX}purchases`]: 'date',
  [`${DB_PREFIX}purchase_payments`]: 'date',
  [`${DB_PREFIX}vouchers`]: 'date',
  [`${DB_PREFIX}stock_moves`]: 'date',
  [`${DB_PREFIX}stock_transfers`]: 'date',
  [`${DB_PREFIX}manufacturing_vouchers`]: 'date',
  [`${DB_PREFIX}stock_journals`]: 'date',
  [`${DB_PREFIX}physical_stock`]: 'date',
  [`${DB_PREFIX}job_work_orders`]: 'date',
  [`${DB_PREFIX}job_work_out`]: 'date',
  [`${DB_PREFIX}job_work_in`]: 'date',
  [`${DB_PREFIX}job_work_principal`]: 'date',
  [`${DB_PREFIX}rejections_in`]: 'date',
  [`${DB_PREFIX}production_plans`]: 'date',
  [`${DB_PREFIX}advances`]: 'date',
  [`${DB_PREFIX}fixed_assets`]: 'acquired_on',
  [`${DB_PREFIX}purchase_returns`]: 'date',
  [`${DB_PREFIX}receipt_notes`]: 'date',
  [`${DB_PREFIX}vendor_payments`]: 'date',
  [`${DB_PREFIX}tds_challans`]: 'date',
  [`${DB_PREFIX}gst_setoffs`]: 'date',
  [`${DB_PREFIX}gst_challans`]: (r) => str(r.deposited_on) || str(r.generated_on) || undefined,
  // 7R: PMT-09 transfers (filing day), refund claims (filing day, else the period end), ISD documents.
  [`${DB_PREFIX}gst_pmt09`]: 'date',
  [`${DB_PREFIX}gst_refunds`]: (r) => str(r.filed_on) || str(r.period_to) || undefined,
  [`${DB_PREFIX}isd_documents`]: 'date',
  // Review L2: RCM self-invoices / payment vouchers (7O) post to the ledger on their date.
  [`${DB_PREFIX}rcm_documents`]: 'date',
  [`${DB_PREFIX}payroll_runs`]: 'date',
  [`${DB_PREFIX}payroll_payments`]: 'date',
  [`${DB_PREFIX}actuarial_valuations`]: 'date',
  [`${DB_PREFIX}employee_loans`]: 'date',
  [`${DB_PREFIX}deposit_slips`]: 'date',
  [`${DB_PREFIX}fx_bank_moves`]: 'date',
  [`${DB_PREFIX}epay_batches`]: 'date',
  [`${DB_PREFIX}commission_postings`]: 'date',
  // 8F: van settlements, breakage / expiry claims and receipts
  [`${DB_PREFIX}van_settlements`]: 'date',
  [`${DB_PREFIX}expiry_claims`]: 'date',
  [`${DB_PREFIX}expiry_receipts`]: 'date',
  [`${DB_PREFIX}business_loans`]: 'date',
  [`${DB_PREFIX}pos_returns`]: 'day',
  [`${DB_PREFIX}pos_shifts`]: 'day', // 8E cashier shifts
  [`${DB_PREFIX}cheques`]: chequeDay,
  [`${DB_PREFIX}ledger_openings`]: openingDay,
  [`${DB_PREFIX}opening_bills`]: openingDay,
  [`${DB_PREFIX}books_begin`]: (r) => (str(r.date) ? openingDayFor(str(r.date)) : undefined),
  // R2-C: deferral schedules (their journals are `vouchers` rows, locked on their own dates) and packing lists
  [`${DB_PREFIX}deferrals`]: (r) => str((r.source as Record<string, unknown> | undefined)?.date) || str(r.start) || undefined,
  [`${DB_PREFIX}packing_lists`]: 'date',
  // R2-A: collection follow-ups (the day logged) and bad-debt recoveries (the day the money came in)
  [`${DB_PREFIX}collection_notes`]: 'date',
  [`${DB_PREFIX}write_off_recoveries`]: 'date',
  // R2-B: batch invoice runs (issue date of the run's invoices)
  [`${DB_PREFIX}batch_runs`]: 'date',
  // R3-A: running table orders, dated by the local day they were opened (`day`, else the `opened_at` date)
  [`${DB_PREFIX}table_orders`]: (r) => str(r.day) || str(r.opened_at).slice(0, 10) || undefined,
  // R3-B: retainers (start day; their period closes stamp time entries)
  [`${DB_PREFIX}retainers`]: 'start',
  // R4-A: production orders (order date), QC decisions, recall notices, landed-cost vouchers
  [`${DB_PREFIX}production_orders`]: 'date',
  [`${DB_PREFIX}qc_results`]: 'date',
  [`${DB_PREFIX}recall_notices`]: 'date',
  [`${DB_PREFIX}landed_cost_vouchers`]: 'date',
  // R4-B: gift vouchers (sale / issue date) and transfer requests (request date)
  [`${DB_PREFIX}gift_vouchers`]: 'issued_on',
  [`${DB_PREFIX}transfer_requests`]: 'date',
  // R4-C: export IRMs (remittance date), incentives (claim date), realisation write-offs
  [`${DB_PREFIX}export_irms`]: 'date',
  [`${DB_PREFIX}export_incentives`]: 'date',
  [`${DB_PREFIX}export_writeoffs`]: 'date',
  // R5-A: marketplace imports (import day), settlements (deposit date), GST TCS / TDS credit rows (month), returns desk
  [`${DB_PREFIX}marketplace_imports`]: (r) => str(r.imported_at).slice(0, 10) || undefined,
  [`${DB_PREFIX}settlements`]: 'deposit_date',
  [`${DB_PREFIX}eco_credits`]: (r) => (/^\d{4}-\d{2}$/.test(str(r.month)) ? `${str(r.month)}-01` : undefined),
  [`${DB_PREFIX}marketplace_returns`]: (r) => str(r.expected_on) || str(r.created_at).slice(0, 10) || undefined,
  // R5-C: fee runs (issue date), common-credit runs (journal date), donations, leases (start), security deposits
  [`${DB_PREFIX}fee_runs`]: 'date',
  [`${DB_PREFIX}common_credit_runs`]: 'date',
  [`${DB_PREFIX}donations`]: 'date',
  [`${DB_PREFIX}leases`]: 'start',
  [`${DB_PREFIX}security_deposits`]: 'date',
  // R5-B: consignment notes, trip sheets (start day), RA measurements
  [`${DB_PREFIX}consignment_notes`]: 'date',
  [`${DB_PREFIX}trips`]: 'start_date',
  [`${DB_PREFIX}ra_measurements`]: 'date',
  // R6-C3: import runs (the day the file was imported)
  [`${DB_PREFIX}import_runs`]: (r) => str(r.at).slice(0, 10) || undefined,
  // R7-A: hotel bookings (arrival), folios (opened on), night audits (business date)
  [`${DB_PREFIX}hotel_reservations`]: 'arrival',
  [`${DB_PREFIX}hotel_folios`]: 'opened_on',
  [`${DB_PREFIX}hotel_night_audits`]: 'business_date',
  // R8-A: trade claims, price-drop runs, interest runs, packaging movements
  [`${DB_PREFIX}trade_claims`]: 'date',
  [`${DB_PREFIX}price_drops`]: 'date',
  [`${DB_PREFIX}interest_runs`]: 'date',
  [`${DB_PREFIX}packaging_moves`]: 'date',
  // R8-B: brokerage postings (period end)
  [`${DB_PREFIX}brokerage_postings`]: 'to',
  // R8-C: arrivals, bikri pattis, indents
  [`${DB_PREFIX}arrivals`]: 'date',
  [`${DB_PREFIX}sale_pattis`]: 'date',
  [`${DB_PREFIX}indents`]: 'date',
  // R9-A: rider settlements, short book; R9-B: refills (next due); R9-C: alterations; R9-D: IMEI checks, finance deals,
  // service jobs; R9-E: metal rates, karigar moves (RT_DATED in retail/rt-shared.ts)
  [`${DB_PREFIX}rider_settlements`]: 'date',
  [`${DB_PREFIX}short_book`]: 'date',
  [`${DB_PREFIX}rx_refills`]: 'next_due',
  [`${DB_PREFIX}alteration_jobs`]: 'date',
  [`${DB_PREFIX}imei_checks`]: 'date',
  [`${DB_PREFIX}finance_deals`]: 'date',
  [`${DB_PREFIX}service_jobs`]: 'date',
  [`${DB_PREFIX}metal_rates`]: 'date',
  [`${DB_PREFIX}karigar_moves`]: 'date',
  // R11-B: secured advances, price-variation statements, bank guarantees (issued on)
  [`${DB_PREFIX}secured_advances`]: 'date',
  [`${DB_PREFIX}price_variations`]: 'date',
  [`${DB_PREFIX}bank_guarantees`]: 'issued_on',
  // R11-C: bookings, stage certificates, RERA account entries
  [`${DB_PREFIX}realty_bookings`]: 'date',
  [`${DB_PREFIX}stage_certificates`]: 'certified_on',
  [`${DB_PREFIX}rera_withdrawals`]: 'date',
  // R10-A: appointments, staff payouts, payer claims
  [`${DB_PREFIX}appointments`]: 'date',
  [`${DB_PREFIX}staff_payouts`]: 'date',
  [`${DB_PREFIX}payer_claims`]: 'date',
  // R10-B: OPD visits, admissions (admitted on), lab orders
  [`${DB_PREFIX}clinic_visits`]: 'date',
  [`${DB_PREFIX}admissions`]: 'admit_date',
  [`${DB_PREFIX}lab_orders`]: 'date',
  // R10-C: memberships (by start), check-ins, class attendance
  [`${DB_PREFIX}memberships`]: 'start',
  [`${DB_PREFIX}checkins`]: 'date',
  [`${DB_PREFIX}class_attendance`]: 'date',
  // R11-D: work orders, sub-contractor bills, muster days, plant log sheets
  [`${DB_PREFIX}sub_work_orders`]: 'date',
  [`${DB_PREFIX}sub_measurements`]: 'date',
  [`${DB_PREFIX}muster_days`]: 'date',
  [`${DB_PREFIX}plant_logs`]: 'date',
  // R12-A: farm batches (by start), pooled farmer cycles (by period end)
  [`${DB_PREFIX}farm_batches`]: 'start',
  [`${DB_PREFIX}farmer_cycles`]: 'period_to',
  // R12-B: rate charts (by effective date), milk shifts, milk dispatches
  [`${DB_PREFIX}milk_rate_charts`]: 'effective_from',
  [`${DB_PREFIX}milk_shifts`]: 'date',
  [`${DB_PREFIX}milk_dispatches`]: 'date',
  // R12-C: weighbridge slips
  [`${DB_PREFIX}weighbridge_slips`]: 'date',
  // R12-D: cold-storage lots (by date in), loans against stored produce, members' share ledger
  [`${DB_PREFIX}cold_lots`]: 'date_in',
  [`${DB_PREFIX}agri_loans`]: 'date',
  [`${DB_PREFIX}member_shares`]: 'date',
  // R13-A: job cards (by the first entry's day)
  [`${DB_PREFIX}job_cards`]: 'date',
  // R13-B: inspection reports, job quotes, moulding runs, print estimates
  [`${DB_PREFIX}inspection_reports`]: 'date',
  [`${DB_PREFIX}job_quotes`]: 'date',
  [`${DB_PREFIX}process_runs`]: 'date',
  [`${DB_PREFIX}print_estimates`]: 'date',
  // R13-C: cut plans (the cutting day)
  [`${DB_PREFIX}cut_plans`]: 'date',
  // R13-D: cost cards (by effective date), export authorisations (by issue date), incentive claims (by period end)
  [`${DB_PREFIX}cost_cards`]: 'effective_from',
  [`${DB_PREFIX}export_authorisations`]: 'date',
  [`${DB_PREFIX}incentive_claims`]: 'period_to',
  // R14-A: engagements (by start), conflict checks (by date)
  [`${DB_PREFIX}engagements`]: 'start',
  [`${DB_PREFIX}conflict_checks`]: 'date',
  // R14-D: partner runs (year-end and monthly credits), UDIN register
  [`${DB_PREFIX}partner_runs`]: 'date',
  [`${DB_PREFIX}udin_register`]: 'date',
  // R14-B: client-money vouchers
  [`${DB_PREFIX}client_money`]: 'date',
  // R14-C: EDF register (the end of the invoice month)
  [`${DB_PREFIX}edf_register`]: 'date',
  // R15-B: travel bookings (by start)
  [`${DB_PREFIX}travel_bookings`]: 'start',
  // R15-C: supplier statements (by period end)
  [`${DB_PREFIX}supplier_statements`]: 'period_end',
  // R17-B: site musters (the month's last day)
  [`${DB_PREFIX}site_musters`]: 'date',
  // R17-C: site compliance proof (the month's last day)
  [`${DB_PREFIX}site_compliance`]: 'date',
};

const INVOICES_KEY = `${DB_PREFIX}invoices`;
const PURCHASES_KEY = `${DB_PREFIX}purchases`;
const BAD_ID = '__proto__';

export const tableLabel = (key: string) => key.slice(DB_PREFIX.length).replace(/_/g, ' ');

function lockOf(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return normalizeLockDate((JSON.parse(value) as { lock_until?: unknown } | null)?.lock_until);
  } catch {
    return '';
  }
}

/** Taking `after` over `before` (settings text) moves the lock earlier or removes it. */
const loosensLock = (before: string | null, after: string | null) => {
  const b = lockOf(before);
  const a = lockOf(after);
  return b !== '' && (a === '' || a < b);
};

/** Payment details printed on invoices (and in the UPI QR): who gets paid. */
const PAYMENT_FIELDS = ['bankName', 'accountName', 'accountNumber', 'ifsc', 'upiId'] as const;

/** Every profile's payment details, by profile id (settings text → comparable string). */
function paymentPrint(value: string | null): string {
  if (!value) return '';
  try {
    const s = JSON.parse(value) as { profiles?: unknown } | null;
    const profiles = Array.isArray(s?.profiles) ? (s!.profiles as Array<Record<string, unknown> | null>) : [];
    const out: Record<string, string[]> = {};
    profiles.forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const id = typeof p.id === 'string' && p.id ? p.id : `#${i}`;
      out[id] = PAYMENT_FIELDS.map((f) => (typeof p[f] === 'string' ? (p[f] as string).trim() : ''));
    });
    return JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
  } catch {
    return '';
  }
}

/**
 * Taking `after` over `before` (settings text) changes where customers are told to pay (a UPI ID or
 * bank detail added, changed or removed). Never taken silently from another device: a device synced
 * by someone else (or a doctored sync folder) must not be able to redirect payments; the owner reviews it.
 */
export const changesPaymentDetails = (before: string | null, after: string | null): boolean => paymentPrint(before) !== paymentPrint(after);

const rowDate = (key: string, row: unknown): string | undefined => {
  const f = own(DATED, key);
  if (!f || !row || typeof row !== 'object') return undefined;
  const r = row as Record<string, unknown>;
  return typeof f === 'function' ? f(r) : (r[f] as string | undefined);
};

/** Bill payment roll-ups touch only these fields; the local layer lets them through a lock (the payment row is checked by its own date). */
const ROLLUP_FIELDS = new Set(['amount_paid', 'updated_at']);
function onlyRollup(key: string, before: unknown, after: unknown): boolean {
  if (key !== PURCHASES_KEY || !before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ROLLUP_FIELDS.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/** Would writing `after` over `before` touch a document inside the locked period? */
export function touchesLock(lock: string, key: string, before: unknown, after: unknown): boolean {
  if (!lock || !own(DATED, key)) return false;
  if (onlyRollup(key, before, after)) return false;
  return isDateLocked(rowDate(key, before), lock) || isDateLocked(rowDate(key, after), lock);
}

/* ── Working copy of the local data ────────────────────────────── */

type Work =
  | { mode: 'rows'; ids: string[]; rows: Map<string, unknown>; dirty: boolean }
  | { mode: 'single'; value: string | null; dirty: boolean };

/** Stable row ids: the row's own `id`, else (missing / duplicate) a content id. */
function assignIds(list: unknown[]): { ids: string[]; rows: Map<string, unknown> } {
  const ids: string[] = [];
  const rows = new Map<string, unknown>();
  for (const row of list) {
    const raw = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;
    let id = (typeof raw === 'string' && raw !== '') || typeof raw === 'number' ? String(raw) : '';
    if (!id || id === BAD_ID || rows.has(id)) {
      const base = `~${hashStr(JSON.stringify(row))}`;
      id = base;
      for (let n = 1; rows.has(id); n++) id = `${base}#${n}`;
    }
    ids.push(id);
    rows.set(id, row);
  }
  return { ids, rows };
}

function syncedKeys(): string[] {
  return listKeys(DB_PREFIX).filter(isSyncedKey).sort();
}

/** Hash of every synced key's stored text (cheap: no parsing). */
function keyHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of syncedKeys()) {
    const raw = readRaw(key);
    if (raw !== null) out[key] = hashStr(raw);
  }
  return out;
}

function loadWork(): Map<string, Work> {
  const work = new Map<string, Work>();
  for (const key of syncedKeys()) {
    const raw = readRaw(key);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = raw.startsWith('[') ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (Array.isArray(parsed)) work.set(key, { mode: 'rows', ...assignIds(parsed), dirty: false });
    else work.set(key, { mode: 'single', value: raw, dirty: false });
  }
  return work;
}

function upsertRow(w: Extract<Work, { mode: 'rows' }>, id: string, row: unknown): void {
  if (!w.rows.has(id)) w.ids.push(id);
  w.rows.set(id, row);
  w.dirty = true;
}

function removeRow(w: Extract<Work, { mode: 'rows' }>, id: string): void {
  if (!w.rows.delete(id)) return;
  w.ids = w.ids.filter((x) => x !== id);
  w.dirty = true;
}

const serializeWork = (w: Work): string | null => (w.mode === 'rows' ? JSON.stringify(w.ids.map((id) => w.rows.get(id))) : w.value);

/* ── Persistent state ──────────────────────────────────────────── */

export function emptyState(group: string): SyncState {
  return { v: 1, group, clock: 0, keys: {}, peers: {}, blobs_written: [], dup_ack: [], declined: {} };
}

/** The stored state, or null when there is none (never synced, or removed by a restore / erase). */
function readState(): SyncState | null {
  try {
    const raw = readRaw(SYNC_STATE_KEY);
    const s = raw ? (JSON.parse(raw) as SyncState) : null;
    if (s && s.v === 1 && typeof s.clock === 'number' && s.keys && typeof s.keys === 'object') {
      return { ...emptyState(s.group), ...s, declined: s.declined ?? {}, dup_ack: s.dup_ack ?? [], blobs_written: s.blobs_written ?? [], peers: s.peers ?? {} };
    }
  } catch {
    /* damaged: start over (conservative: differences become conflicts, nothing is overwritten) */
  }
  return null;
}

export function loadState(group?: string): SyncState {
  const s = readState();
  // Joined another group: forget what was exchanged with the old one (conflicts are kept).
  if (!s || (group && s.group !== group)) return emptyState(group ?? s?.group ?? '');
  return s;
}

export function loadConflicts(): SyncConflict[] {
  try {
    const v = JSON.parse(readRaw(SYNC_CONFLICTS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as SyncConflict[]) : [];
  } catch {
    return [];
  }
}

export interface DeviceLog {
  name: string;
  rows: AuditEntry[];
}

export function loadDeviceLogs(): Record<string, DeviceLog> {
  try {
    const v = JSON.parse(readRaw(SYNC_AUDIT_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, DeviceLog>) : {};
  } catch {
    return {};
  }
}

/** Write only when the text changed (the state can be megabytes). */
function writeIfChanged(key: string, value: string): void {
  if (readRaw(key) !== value) writeRaw(key, value);
}

function saveMeta(state: SyncState, conflicts?: SyncConflict[], logs?: Record<string, DeviceLog>): void {
  writeIfChanged(SYNC_STATE_KEY, JSON.stringify(state));
  if (conflicts) writeIfChanged(SYNC_CONFLICTS_KEY, JSON.stringify(conflicts));
  if (logs) writeIfChanged(SYNC_AUDIT_KEY, JSON.stringify(logs));
}

/** Highest counter this device has used in the company's group (device-local; survives restore / erase). */
function highWater(): number | undefined {
  try {
    return companySyncPrefs().hw;
  } catch {
    return undefined;
  }
}

function noteHighWater(clock: number): void {
  try {
    if ((highWater() ?? -1) < clock) setCompanySyncPrefs({ hw: clock });
  } catch {
    /* the own-file floor still protects */
  }
}

/* ── Local change detection ────────────────────────────────────── */

/**
 * Fold local edits since the last sync into the state: a row whose hash changed (or that is new)
 * gets a new version stamped with this device's next Lamport time; a row that disappeared gets a
 * tombstone. Returns how many versions were created.
 */
export function scanLocal(state: SyncState, work: Map<string, Work>, self: string): number {
  let changes = 0;
  const stamp = (prev: RowMeta | undefined, h: string, del: boolean): RowMeta => {
    const t = ++state.clock;
    changes++;
    return { h, t, d: self, vv: { ...(prev?.vv ?? {}), [self]: t }, o: prev?.o || self, ...(del ? { del: 1 as const } : {}) };
  };
  for (const [key, w] of work) {
    let ks = own(state.keys, key);
    if (w.mode === 'rows') {
      if (!ks || ks.mode !== 'rows') ks = state.keys[key] = { mode: 'rows', rows: {} };
      const rows = ks.rows;
      for (const id of w.ids) {
        const h = hashStr(JSON.stringify(w.rows.get(id)));
        const m = own(rows, id);
        if (!m || m.del || m.h !== h) rows[id] = stamp(m, h, false);
      }
      for (const [id, m] of Object.entries(rows)) if (!m.del && !w.rows.has(id)) rows[id] = stamp(m, '', true);
    } else {
      const h = w.value === null ? '' : hashStr(w.value);
      const m = ks?.mode === 'single' ? ks.meta : undefined;
      if (!m || (w.value === null ? !m.del : m.del || m.h !== h)) state.keys[key] = { mode: 'single', meta: stamp(m, h, w.value === null) };
    }
  }
  // Keys that vanished entirely (table emptied by removing the key, singleton removed).
  for (const [key, ks] of Object.entries(state.keys)) {
    if (work.has(key)) continue;
    if (ks.mode === 'rows') {
      for (const [id, m] of Object.entries(ks.rows)) if (!m.del) ks.rows[id] = stamp(m, '', true);
    } else if (!ks.meta.del) ks.meta = stamp(ks.meta, '', true);
  }
  return changes;
}

/* ── Remote file validation ────────────────────────────────────── */

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const validVV = (vv: unknown): vv is VV =>
  !!vv && typeof vv === 'object' && !Array.isArray(vv) && Object.entries(vv).every(([k, v]) => k !== BAD_ID && isInt(v));

function validMeta(m: unknown): m is RowMeta {
  const x = m as RowMeta | null;
  if (!x || typeof x !== 'object' || typeof x.h !== 'string' || !isInt(x.t) || typeof x.d !== 'string' || typeof x.o !== 'string') return false;
  if (x.del !== undefined && x.del !== 1) return false;
  return validVV(x.vv);
}

export class SyncDataError extends Error {}

/**
 * Parse + validate a decrypted device file. Throws SyncDataError when anything is off. Note: anyone
 * holding the group key can write a valid file for any device id (there is no per-device signing).
 */
export function parseRemoteFile(text: string, deviceId: string, group: string): RemoteFile {
  let f: RemoteFile;
  try {
    f = JSON.parse(text) as RemoteFile;
  } catch {
    throw new SyncDataError('not JSON');
  }
  const bad = (why: string): never => {
    throw new SyncDataError(why);
  };
  if (!f || f.app !== SYNC_APP || f.kind !== 'state' || f.v !== 1) bad('not a sync state file');
  if (!f.device || f.device.id !== deviceId || typeof f.device.name !== 'string') bad('device mismatch');
  if (f.group !== group) bad('group mismatch');
  if (!isInt(f.clock) || !isInt(f.schema) || typeof f.written_at !== 'string') bad('header');
  if (!f.keys || typeof f.keys !== 'object' || !Array.isArray(f.audit) || !Array.isArray(f.blobs)) bad('body');
  if (!validVV(f.vv_max)) bad('vv_max');
  if (!f.blobs.every((b) => typeof b === 'string' && isAttachmentId(b))) bad('blobs');
  if (!f.audit.every((r) => r && typeof r === 'object' && typeof r.id === 'string')) bad('audit');
  for (const [key, k] of Object.entries(f.keys)) {
    if (!key.startsWith(DB_PREFIX) || !k || typeof k !== 'object') bad('key');
    if (k.mode === 'rows') {
      if (!k.rows || typeof k.rows !== 'object') bad('rows');
      for (const [id, pair] of Object.entries(k.rows!)) {
        if (id === BAD_ID || !Array.isArray(pair) || pair.length !== 2 || !validMeta(pair[0])) bad(`row ${id}`);
        const [m, v] = pair;
        if (m.del ? v !== null : v === null || v === undefined || hashStr(JSON.stringify(v)) !== m.h) bad(`row ${id} content`);
      }
    } else if (k.mode === 'single') {
      if (!validMeta(k.meta)) bad('single meta');
      const v = k.value;
      if (k.meta!.del ? v !== null : typeof v !== 'string' || hashStr(v) !== k.meta!.h) bad('single content');
    } else bad('mode');
  }
  return f;
}

/* ── Merge ─────────────────────────────────────────────────────── */

interface MergeCtx {
  state: SyncState;
  work: Map<string, Work>;
  conflicts: SyncConflict[];
  self: string;
  lock: string;
  now: string;
  stats: { added: number; updated: number; deleted: number; newConflicts: number };
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}

function putConflict(ctx: MergeCtx, c: RowConflict): void {
  const i = ctx.conflicts.findIndex((x) => x.id === c.id);
  if (i >= 0) {
    const old = ctx.conflicts[i] as RowConflict;
    // Same two versions already listed: keep the original entry (and its time).
    if (sameVersion(old.remote.meta, c.remote.meta) && sameVersion(old.local.meta, c.local.meta) && old.reason === c.reason) return;
    ctx.conflicts[i] = c;
  } else ctx.conflicts.push(c);
  ctx.stats.newConflicts++;
}

/**
 * After the current version of a listed row / singleton changed through a merge: drop the listing when
 * the new version supersedes both sides (resolved on another device), otherwise point the listing's
 * "current" side at the new version so a later choice never writes a stale copy.
 */
function refreshListing(ctx: MergeCtx, id: string, meta: RowMeta, value: unknown, contentChanged = true): void {
  ctx.conflicts = ctx.conflicts.filter((c) => {
    if (c.kind === 'duplicate' || c.id !== id) return true;
    if (vvCovers(meta.vv, c.local.meta?.vv ?? {}) && vvCovers(meta.vv, c.remote.meta?.vv ?? {})) return false;
    if (!contentChanged) return true;
    if (c.kind === 'single') {
      c.applied = 'remote';
      c.remote = { meta: cloneMeta(meta), value };
    } else c.local = { meta: cloneMeta(meta), value };
    return true;
  });
}

function absorb(lm: RowMeta, rm: RowMeta): void {
  lm.vv = mergeVV(lm.vv, rm.vv);
  if (rm.t > lm.t || (rm.t === lm.t && rm.d > lm.d)) {
    lm.t = rm.t;
    lm.d = rm.d;
  }
  lm.o = minStr(lm.o, rm.o);
}

function mergeRows(ctx: MergeCtx, key: string, rk: RemoteKey, from: RemoteFile): void {
  let ks = own(ctx.state.keys, key);
  let w = ctx.work.get(key);
  if ((ks && ks.mode !== 'rows') || (w && w.mode !== 'rows')) return; // shape differs between devices: leave it
  if (!ks) ks = ctx.state.keys[key] = { mode: 'rows', rows: {} };
  if (!w) {
    w = { mode: 'rows', ids: [], rows: new Map(), dirty: false };
    ctx.work.set(key, w);
  }
  const rows = (ks as Extract<KeyState, { mode: 'rows' }>).rows;
  const wr = w as Extract<Work, { mode: 'rows' }>;
  for (const [id, [rm, rv]] of Object.entries(rk.rows ?? {})) {
    const lm = own(rows, id);
    const localVal = wr.rows.get(id);
    const cid = `row:${key}:${id}`;
    const remoteVal = rm.del ? null : rv;
    const conflict = (reason: 'concurrent' | 'locked') =>
      putConflict(ctx, {
        id: cid, kind: 'row', key, row_id: id, reason, device: from.device.id, device_name: from.device.name, at: ctx.now,
        ...(reason === 'locked' || touchesLock(ctx.lock, key, localVal, remoteVal ?? undefined) ? { locked: true } : {}),
        local: { meta: lm ? cloneMeta(lm) : null, value: localVal ?? null },
        remote: { meta: cloneMeta(rm), value: remoteVal },
      });
    const declined = () => own(ctx.state.declined, `${key}|${id}`) === (rm.del ? '' : rm.h);

    if (!lm) {
      if (rm.del) {
        rows[id] = cloneMeta(rm);
        continue;
      }
      if (touchesLock(ctx.lock, key, undefined, rv)) {
        if (!declined()) conflict('locked');
        continue;
      }
      upsertRow(wr, id, rv);
      rows[id] = cloneMeta(rm);
      ctx.stats.added++;
      continue;
    }
    if ((lm.del && rm.del) || (!lm.del && !rm.del && lm.h === rm.h)) {
      absorb(lm, rm);
      refreshListing(ctx, cid, lm, localVal ?? null, false);
      continue;
    }
    const order = compareVV(rm.vv, lm.vv);
    if (order === 'lt') continue;
    if (order === 'gt') {
      if (touchesLock(ctx.lock, key, localVal, rm.del ? undefined : rv)) {
        if (!declined()) conflict('locked');
        continue;
      }
      if (rm.del) {
        removeRow(wr, id);
        ctx.stats.deleted++;
      } else {
        if (localVal === undefined) ctx.stats.added++;
        else ctx.stats.updated++;
        upsertRow(wr, id, rv);
      }
      const next = cloneMeta(rm);
      next.o = minStr(lm.o, rm.o);
      rows[id] = next;
      refreshListing(ctx, cid, next, remoteVal);
      continue;
    }
    // Concurrent (or the same counter with different content after a lost state): never discard.
    if (!lm.del && !rm.del && sameJson(localVal, rv)) {
      absorb(lm, rm);
      refreshListing(ctx, cid, lm, localVal ?? null, false);
      continue;
    }
    conflict('concurrent');
  }
}

function mergeSingle(ctx: MergeCtx, key: string, rk: RemoteKey, from: RemoteFile): void {
  const ks = own(ctx.state.keys, key);
  const w = ctx.work.get(key);
  if ((ks && ks.mode !== 'single') || (w && w.mode !== 'single')) return;
  const rm = rk.meta!;
  const rv = rm.del ? null : (rk.value ?? null);
  const cid = `single:${key}`;
  const isSettings = key === SINGLETON_KEYS.settings;
  const apply = () => {
    const cur = ctx.work.get(key) as Extract<Work, { mode: 'single' }> | undefined;
    if ((cur?.value ?? null) === rv) return;
    ctx.work.set(key, { mode: 'single', value: rv, dirty: true });
    ctx.stats.updated++;
  };
  const lm = ks?.mode === 'single' ? ks.meta : undefined;
  if (!lm) {
    if (!rm.del) apply();
    ctx.state.keys[key] = { mode: 'single', meta: cloneMeta(rm) };
    return;
  }
  const lv = w?.mode === 'single' ? w.value : null;
  if ((lm.del && rm.del) || (!lm.del && !rm.del && lm.h === rm.h)) {
    absorb(lm, rm);
    refreshListing(ctx, cid, lm, lv, false);
    return;
  }
  const order = compareVV(rm.vv, lm.vv);
  if (order === 'lt') return;
  // Moving the period lock earlier (or removing it), or changing the payment details, is never taken
  // silently from another device: it is listed for the owner, and this device keeps its version.
  const loosens = isSettings && loosensLock(lv, rv);
  const payment = isSettings && lv !== null && changesPaymentDetails(lv, rv);
  const holdLock = () => {
    if (own(ctx.state.declined, `${key}|`) === (rm.del ? '' : rm.h)) return;
    putConflict(ctx, {
      id: cid, kind: 'single', key, device: from.device.id, device_name: from.device.name, at: ctx.now,
      ...(loosens ? { reason: 'locked' as const, locked: true } : { reason: 'payment' as const }),
      local: { meta: cloneMeta(lm), value: lv }, remote: { meta: cloneMeta(rm), value: rv }, applied: 'local',
    });
  };
  if (order === 'gt') {
    if (loosens || payment) return holdLock();
    apply();
    const next = cloneMeta(rm);
    ctx.state.keys[key] = { mode: 'single', meta: next };
    refreshListing(ctx, cid, next, rv);
    return;
  }
  if (lv !== null && rv !== null && sameJson(safeParse(lv), safeParse(rv))) {
    absorb(lm, rm);
    refreshListing(ctx, cid, lm, lv, false);
    return;
  }
  // Concurrent: last writer by Lamport time (device id breaks ties) wins; the other version is listed.
  const remoteWins = rm.t > lm.t || (rm.t === lm.t && rm.d > lm.d);
  if (remoteWins && (loosens || payment)) return holdLock();
  putConflict(ctx, {
    id: cid, kind: 'single', key, reason: 'lww', device: from.device.id, device_name: from.device.name, at: ctx.now,
    // Switching to the listed (losing) version later must not loosen the lock without the PIN.
    ...(isSettings && (remoteWins ? loosensLock(rv, lv) : loosensLock(lv, rv)) ? { locked: true } : {}),
    local: { meta: cloneMeta(lm), value: lv }, remote: { meta: cloneMeta(rm), value: rv }, applied: remoteWins ? 'remote' : 'local',
  });
  if (remoteWins) {
    apply();
    ctx.state.keys[key] = { mode: 'single', meta: cloneMeta(rm) };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Numbered documents: table → number / date fields. Two devices can issue the same serial in each. */
const NUMBERED: Record<string, { num: string; date: string; scope?: string }> = {
  [INVOICES_KEY]: { num: 'invoice_number', date: 'issue_date' },
  [`${DB_PREFIX}advances`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}vouchers`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}stock_transfers`]: { num: 'transfer_number', date: 'date' },
  [`${DB_PREFIX}manufacturing_vouchers`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}stock_journals`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}physical_stock`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}job_work_orders`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}job_work_out`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}job_work_in`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}job_work_principal`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}rejections_in`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}production_plans`]: { num: 'number', date: 'date' },
  // 8F: van settlements (VST) and breakage / expiry receipts (BER)
  [`${DB_PREFIX}van_settlements`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}expiry_receipts`]: { num: 'number', date: 'date' },
  // M5: every other numbered series (DN / GRN / RJO / PIS / PRL / PYP / PO).
  [`${DB_PREFIX}purchase_returns`]: { num: 'note_number', date: 'date' },
  [`${DB_PREFIX}receipt_notes`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}deposit_slips`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}epay_batches`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}payroll_runs`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}payroll_payments`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}actuarial_valuations`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}employee_loans`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}business_loans`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}fnf_settlements`]: { num: 'number', date: 'pay_month' },
  [`${DB_PREFIX}purchase_orders`]: { num: 'po_number', date: 'date' },
  // Review L2: RCM self-invoices (RCM/…) and payment vouchers (RPV/…) are two series in one table.
  [`${DB_PREFIX}rcm_documents`]: { num: 'number', date: 'date', scope: 'kind' },
  // R2-C: packing lists (PKL/FY…)
  [`${DB_PREFIX}packing_lists`]: { num: 'number', date: 'date' },
  // R4-A: production orders (WO/FY…) and landed-cost vouchers (LCV/FY…)
  [`${DB_PREFIX}production_orders`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}landed_cost_vouchers`]: { num: 'number', date: 'date' },
  // R4-B: gift vouchers (GV/FY…) and transfer requests (TRQ/FY…)
  [`${DB_PREFIX}gift_vouchers`]: { num: 'number', date: 'issued_on' },
  [`${DB_PREFIX}transfer_requests`]: { num: 'number', date: 'date' },
  // R5-C3: donation receipts (DON/FY…)
  [`${DB_PREFIX}donations`]: { num: 'number', date: 'date' },
  // R5-B: consignment notes (LR/FY…) and trip sheets (TRP/FY…)
  [`${DB_PREFIX}consignment_notes`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}trips`]: { num: 'number', date: 'start_date' },
  // R7-A: hotel reservations (RES/FY…)
  [`${DB_PREFIX}hotel_reservations`]: { num: 'number', date: 'booked_on' },
  // R8-A: trade claims (TCL/FY…) and price-drop runs (PDR/FY…)
  [`${DB_PREFIX}trade_claims`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}price_drops`]: { num: 'number', date: 'date' },
  // R8-C: arrivals (ARR/FY…), bikri pattis (PAT/FY…), indents (IND/FY…)
  [`${DB_PREFIX}arrivals`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}sale_pattis`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}indents`]: { num: 'number', date: 'date' },
  // R9: alteration slips (ALT/FY…), service jobs (SVC/FY…), karigar issue / receipt (KAR/FY…)
  [`${DB_PREFIX}alteration_jobs`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}service_jobs`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}karigar_moves`]: { num: 'number', date: 'date' },
  // R11-B: price-variation statements (PVB/FY…)
  [`${DB_PREFIX}price_variations`]: { num: 'number', date: 'date' },
  // R11-C: bookings (BKG/FY…)
  [`${DB_PREFIX}realty_bookings`]: { num: 'number', date: 'date' },
  // R10-A: payer claims (CLM/FY…)
  [`${DB_PREFIX}payer_claims`]: { num: 'number', date: 'date' },
  // R10-B: OPD visits (OPD/FY…), admissions (IPD/FY…), lab orders (LAB/FY…)
  [`${DB_PREFIX}clinic_visits`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}admissions`]: { num: 'number', date: 'admit_date' },
  [`${DB_PREFIX}lab_orders`]: { num: 'number', date: 'date' },
  // R10-C: memberships (MEM/FY…)
  [`${DB_PREFIX}memberships`]: { num: 'number', date: 'start' },
  // R11-D: work orders (SWO/FY…), sub-contractor bills (SCB/FY…), plant log sheets (PLG/FY…)
  [`${DB_PREFIX}sub_work_orders`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}sub_measurements`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}plant_logs`]: { num: 'number', date: 'date' },
  // R12-A: pooled farmer cycle bills (CYB/FY…)
  [`${DB_PREFIX}farmer_cycles`]: { num: 'number', date: 'period_to' },
  // R12-B: milk dispatches (MDS/FY…)
  [`${DB_PREFIX}milk_dispatches`]: { num: 'number', date: 'date' },
  // R12-C: weighbridge slips (WBS/FY…); CMR delivery numbers live inside `cmr_agreements` (guarded by series_counters)
  [`${DB_PREFIX}weighbridge_slips`]: { num: 'number', date: 'date' },
  // R12-D: cold-storage receipts (CSR/FY…), loans against stored produce (LAS/FY…)
  [`${DB_PREFIX}cold_lots`]: { num: 'number', date: 'date_in' },
  [`${DB_PREFIX}agri_loans`]: { num: 'number', date: 'date' },
  // R13-A: job cards (JCD/FY…)
  [`${DB_PREFIX}job_cards`]: { num: 'number', date: 'date' },
  // R13-B: inspection reports (FAI/FY…), print estimates (PES/FY…)
  [`${DB_PREFIX}inspection_reports`]: { num: 'number', date: 'date' },
  [`${DB_PREFIX}print_estimates`]: { num: 'number', date: 'date' },
  // R13-C: cut plans / lots (CUT/FY…)
  [`${DB_PREFIX}cut_plans`]: { num: 'number', date: 'date' },
  // R14-A: engagements (ENG/FY…)
  [`${DB_PREFIX}engagements`]: { num: 'number', date: 'start' },
  // R14-B: client-money vouchers (CMV/FY…)
  [`${DB_PREFIX}client_money`]: { num: 'number', date: 'date' },
  // 7R: `isd_documents` is NOT listed: its `number` mixes our ISD/FY… series with suppliers' / distributors' own
  // invoice numbers, which may legitimately repeat across parties (the ISD series itself is guarded by series_counters).
};

/**
 * The key two rows of `table` collide on: the normalised document number, within the row's series
 * (`scope` field) when the table holds several. '' when the table is not numbered or the row has no number.
 */
export function docNumberKey(table: string, row: unknown): string {
  const f = own(NUMBERED, table);
  if (!f || !row || typeof row !== 'object') return '';
  const r = row as Record<string, unknown>;
  const k = typeof r[f.num] === 'string' ? numberKey(r[f.num] as string) : '';
  if (!k || !f.scope) return k;
  return `${String(r[f.scope] ?? '')}|${k}`;
}

/** Duplicate document numbers (two devices issuing the same serial): listed, never renumbered. */
function flagDuplicates(ctx: MergeCtx): void {
  const live = new Set<string>();
  for (const [table, f] of Object.entries(NUMBERED)) {
    const w = ctx.work.get(table);
    if (w?.mode !== 'rows') continue;
    const groups = new Map<string, string[]>();
    for (const id of w.ids) {
      const k = docNumberKey(table, w.rows.get(id));
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(id);
      else groups.set(k, [id]);
    }
    const ks = own(ctx.state.keys, table);
    const metaRows = ks?.mode === 'rows' ? ks.rows : {};
    for (const [k, ids] of groups) {
      if (ids.length < 2) continue;
      const sorted = [...ids].sort();
      const sig = `${table}|${k}|${sorted.join(',')}`;
      if (ctx.state.dup_ack.includes(sig)) continue;
      const id = `dup:${table}:${k}`;
      live.add(id);
      const existing = ctx.conflicts.find((c) => c.id === id);
      if (existing?.kind === 'duplicate' && existing.sig === sig) continue;
      const docs = sorted.map((rid) => {
        const r = (w.rows.get(rid) ?? {}) as Record<string, unknown>;
        const origin = own(metaRows, rid)?.o ?? '';
        return {
          id: rid,
          number: String(r[f.num] ?? ''),
          client: String((r.client as { name?: string } | undefined)?.name ?? ''),
          date: String(r[f.date] ?? ''),
          total: Number(r.total ?? r.amount) || 0,
          device: origin === ctx.self ? 'this device' : (own(ctx.state.peers, origin)?.name ?? ''),
        };
      });
      const c: SyncConflict = { id, kind: 'duplicate', key: table, number: docs[0].number, ids: sorted, sig, at: ctx.now, docs };
      if (existing) ctx.conflicts[ctx.conflicts.indexOf(existing)] = c;
      else ctx.conflicts.push(c);
      ctx.stats.newConflicts++;
    }
  }
  ctx.conflicts = ctx.conflicts.filter((c) => c.kind !== 'duplicate' || live.has(c.id));
}

/** Another device's audit log, kept as its own chain: overlap by id, else replaced (it rolled past our copy). */
export function mergeDeviceLog(stored: AuditEntry[], incoming: AuditEntry[]): AuditEntry[] {
  if (!incoming.length) return stored;
  const idx = stored.findIndex((r) => r.id === incoming[0].id);
  const merged = idx >= 0 ? stored.slice(0, idx).concat(incoming) : incoming;
  return merged.length > AUDIT_MAX_ROWS ? incoming : merged;
}

/* ── Own snapshot ──────────────────────────────────────────────── */

function vvMax(state: SyncState): VV {
  const out: VV = {};
  const see = (m: RowMeta) => {
    for (const [k, v] of Object.entries(m.vv)) if (v > (own(out, k) ?? 0)) out[k] = v;
  };
  for (const ks of Object.values(state.keys)) {
    if (ks.mode === 'rows') for (const m of Object.values(ks.rows)) see(m);
    else see(ks.meta);
  }
  return out;
}

function buildPayload(state: SyncState, work: Map<string, Work>, device: { id: string; name: string }, prefix: string | undefined): Omit<RemoteFile, 'written_at'> {
  const keys: Record<string, RemoteKey> = {};
  for (const [key, ks] of Object.entries(state.keys)) {
    const w = work.get(key);
    if (ks.mode === 'rows') {
      const rows: Record<string, [RowMeta, unknown]> = {};
      const wr = w?.mode === 'rows' ? w : null;
      for (const [id, m] of Object.entries(ks.rows)) {
        if (m.del) rows[id] = [m, null];
        else if (wr?.rows.has(id)) rows[id] = [m, wr.rows.get(id)];
      }
      keys[key] = { mode: 'rows', rows };
    } else {
      const value = w?.mode === 'single' ? w.value : null;
      if (ks.meta.del || value !== null) keys[key] = { mode: 'single', meta: ks.meta, value: ks.meta.del ? null : value };
    }
  }
  let ownAudit: AuditEntry[] = [];
  try {
    const parsed = JSON.parse(readRaw(`${DB_PREFIX}audit_log`) ?? '[]') as unknown;
    if (Array.isArray(parsed)) ownAudit = parsed as AuditEntry[];
  } catch {
    /* unreadable log: send none */
  }
  return {
    app: SYNC_APP, kind: 'state', v: 1, device, group: state.group, schema: localSchema(), clock: state.clock,
    ...(prefix ? { prefix } : {}), vv_max: vvMax(state), keys, audit: ownAudit, blobs: [...state.blobs_written],
  };
}

function localSchema(): number {
  const n = Number(readRaw(SCHEMA_VERSION_KEY));
  return Number.isInteger(n) && n > 0 ? n : LATEST_SCHEMA_VERSION;
}

/* ── Applying the merged working copy ──────────────────────────── */

/**
 * Structural checks before a merge is written (a subset of a restore's: rows from another device may
 * legitimately be legacy-shaped, e.g. catalogue items without ids). Throws a readable Error.
 */
function checkMerged(data: Record<string, string>): void {
  const settings = data[SINGLETON_KEYS.settings];
  if (settings !== undefined) {
    const v = safeParse(settings);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('the merged settings are damaged');
  }
  const refs = new Set<string>();
  for (const t of SNAPSHOT_TABLES) {
    const raw = data[DB_PREFIX + t];
    if (raw === undefined) continue;
    const rows = safeParse(raw);
    if (!Array.isArray(rows)) throw new Error(`the merged ${t} table is not a list`);
    referencedAssets(rows, refs);
  }
  if (refs.size) {
    const assets = parseAssets(data[DB_PREFIX + ASSET_TABLE] ?? readRaw(DB_PREFIX + ASSET_TABLE));
    const missing = [...refs].filter((id) => !assets.byId.has(id)).length;
    if (missing) throw new Error(`${missing} logo/signature image${missing === 1 ? '' : 's'} the invoices refer to did not arrive`);
  }
}

/** Serialised changed keys (plus what the checks need), checked; throws when the result would be damaged. */
function project(work: Map<string, Work>): { dirty: string[]; projected: Record<string, string> } {
  const dirty = [...work].filter(([, w]) => w.dirty).map(([k]) => k);
  dirty.sort((a, b) => Number(b === DB_PREFIX + ASSET_TABLE) - Number(a === DB_PREFIX + ASSET_TABLE));
  const projected: Record<string, string> = {};
  if (!dirty.length) return { dirty, projected };
  const needAssets = dirty.some((k) => SNAPSHOT_TABLES.has(k.slice(DB_PREFIX.length)));
  for (const [k, w] of work) {
    if (!w.dirty && !(needAssets && (k === DB_PREFIX + ASSET_TABLE || SNAPSHOT_TABLES.has(k.slice(DB_PREFIX.length))))) continue;
    const v = serializeWork(w);
    if (v !== null) projected[k] = v;
  }
  // A merge that would leave damaged settings or dangling logo references writes nothing.
  checkMerged(projected);
  return { dirty, projected };
}

/** Write every changed key (assets first, so an invoice never points at a missing logo). All-or-nothing. */
function commit(work: Map<string, Work>, pre?: { dirty: string[]; projected: Record<string, string> }): { changed: string[]; texts: Record<string, string | null> } {
  const { dirty, projected } = pre ?? project(work);
  const texts: Record<string, string | null> = {};
  if (!dirty.length) return { changed: [], texts };
  const written: [string, string | null][] = [];
  try {
    for (const k of dirty) {
      const before = readRaw(k);
      const v = k in projected ? projected[k] : serializeWork(work.get(k)!);
      if (v === null) removeRaw(k);
      else writeRaw(k, v);
      texts[k] = v;
      written.push([k, before]);
    }
  } catch (err) {
    for (const [k, before] of written.reverse()) {
      try {
        if (before === null) removeRaw(k);
        else writeRaw(k, before);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
  return { changed: dirty, texts };
}

/* ── One-at-a-time ─────────────────────────────────────────────── */

let chain: Promise<unknown> = Promise.resolve();

/** Serialise sync runs and conflict resolutions (and across tabs, with the Web Locks API where present). */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;
  const run = () => (locks?.request ? (locks.request(`mrchartist-sync:${activeCompanyId()}`, fn) as Promise<T>) : fn());
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/* ── Sync run ──────────────────────────────────────────────────── */

export interface SyncRunOptions {
  root: SyncDir;
  group: string;
  key: SyncKey;
  device: { id: string; name: string };
  /** Number series this device issues from (shown to the others for the shared-series warning). */
  prefix?: string;
  now?: Date;
  /** Reading a file the cloud client is still writing: attempts and pause between them. */
  attempts?: number;
  retryDelayMs?: number;
}

const blobDirName = (device: string) => device;

export function runSync(o: SyncRunOptions): Promise<SyncReport> {
  audit.flush(); // R15-A2: this device's log is pushed as stored
  return exclusive(async () => {
    const r = await runSyncInner(o);
    recordReport(r);
    return r;
  });
}

interface PeerRead {
  id: string;
  hash: string;
  file?: RemoteFile;
  /** Unchanged since the last merge: not decrypted. */
  same?: boolean;
  error?: string;
  version?: boolean;
  stale?: boolean;
}

interface MergeResult {
  ctx: MergeCtx;
  logs: Record<string, DeviceLog>;
  names: string[];
}

/** One merge attempt from a fresh copy of everything (re-run without a peer whose data cannot be applied). */
function mergeAttempt(o: SyncRunOptions, files: RemoteFile[], floor: number, at: string): MergeResult {
  const self = o.device.id;
  const state = loadState(o.group);
  state.group = o.group;
  const logs = loadDeviceLogs();
  const work = loadWork();
  // A device whose sync state was lost (restore, erase) must never reuse its old counters.
  state.clock = Math.max(state.clock, floor);
  scanLocal(state, work, self);
  // This device's own lock date protects this device's books. (Another device's lock is not applied to
  // rows it already had: a fresh device must receive the locked history; the lock date itself arrives
  // with the settings, and loosening it is held for the PIN.)
  const settingsW = work.get(SINGLETON_KEYS.settings);
  const lock = lockOf(settingsW?.mode === 'single' ? settingsW.value : null);
  const ctx: MergeCtx = { state, work, conflicts: loadConflicts(), self, lock, now: at, stats: { added: 0, updated: 0, deleted: 0, newConflicts: 0 } };
  const names: string[] = [];
  for (const f of [...files].sort((a, b) => (a.device.id < b.device.id ? -1 : 1))) {
    for (const [key, rk] of Object.entries(f.keys)) {
      if (!isSyncedKey(key)) continue;
      if (rk.mode === 'rows') mergeRows(ctx, key, rk, f);
      else mergeSingle(ctx, key, rk, f);
    }
    state.clock = Math.max(state.clock, f.clock); // Lamport: later local edits sort after everything seen
    if (f.audit.length) logs[f.device.id] = { name: f.device.name, rows: mergeDeviceLog(own(logs, f.device.id)?.rows ?? [], f.audit) };
    names.push(f.device.name);
  }
  flagDuplicates(ctx);
  return { ctx, logs, names };
}

async function runSyncInner(o: SyncRunOptions): Promise<SyncReport> {
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const self = o.device.id;
  const report: SyncReport = { ok: true, at, added: 0, updated: 0, deleted: 0, conflicts: 0, newConflicts: 0, peers: 0, unreadable: [], wrote: false, blobsIn: 0, blobsOut: 0 };
  const dirs: GroupDirs = await openGroup(o.root, o.group, false);
  const attempts = o.attempts ?? 3;
  const delay = o.retryDelayMs ?? 1500;
  const stored = readState();
  const stateLost = !stored || stored.group !== o.group;
  const prev = stateLost ? emptyState(o.group) : stored;

  // 1. Read the files. Unchanged ones (same text as last merged) are not decrypted again.
  const present = await listDeviceIds(dirs);
  const reads: PeerRead[] = [];
  const schema = localSchema();
  let floor = highWater() ?? 0;
  let ownUnreadable = false;
  for (const id of present) {
    const read = async () => {
      const text = await readFileText(dirs.devices, deviceFileName(id));
      if (text === null) throw new SyncFileError('The file is missing.', 'missing');
      const hash = hashStr(text);
      const p = own(prev.peers, id);
      if (id !== self && !stateLost && p?.status === 'ok' && p.file_hash === hash) return { id, hash, same: true } as PeerRead;
      const plain = await openSealed(text, o.key, 'device', id, [o.group, 'device', id]);
      return { id, hash, file: parseRemoteFile(plain, id, o.group) } as PeerRead;
    };
    if (id === self) {
      // Our own file: only needed as a counter floor when our sync state was lost.
      if (!stateLost) continue;
      try {
        const r = await withRetry(read, attempts, delay);
        if (r.file) floor = Math.max(floor, r.file.clock, own(r.file.vv_max, self) ?? 0);
      } catch {
        ownUnreadable = true;
      }
      continue;
    }
    try {
      const r = await withRetry(read, attempts, delay);
      if (r.file) {
        const p = own(prev.peers, id);
        if (r.file.schema !== schema) {
          r.version = true;
          r.error = r.file.schema > schema ? 'uses a newer version of the app: update this device' : 'uses an older version of the app: update it';
        } else if (p && p.clock > 0 && r.file.clock < p.clock) {
          r.stale = true;
          r.error = 'its file is older than one already read (a replayed or restored copy); skipped';
        }
      }
      reads.push(r);
    } catch (err) {
      reads.push({ id, hash: '', error: (err as Error)?.message || 'unreadable' });
    }
    await yieldToUi();
  }
  if (stateLost && ownUnreadable && highWater() === undefined) {
    return { ...report, ok: false, reason: 'error', message: "This device's sync history was reset and its own file in the folder cannot be read yet, so it cannot safely number its changes. Try again in a minute." };
  }
  const fresh = reads.filter((r) => r.file && !r.error);
  for (const r of fresh) floor = Math.max(floor, own(r.file!.vv_max, self) ?? 0);

  // 2. Idle: no peer file and no local data changed since the last run → nothing to merge or write.
  const hashes = keyHashes();
  const prevH = prev.key_h ?? {};
  const keysSame = !stateLost && Object.keys(hashes).length === Object.keys(prevH).length && Object.entries(hashes).every(([k, h]) => own(prevH, k) === h);
  const peersSame = reads.every((r) => r.same);
  const blobsSettled = !prev.blobs_missing && storedAttachmentIds().every((id) => prev.blobs_written.includes(id));
  if (keysSame && peersSame && blobsSettled && prev.last_written_hash && present.includes(self)) {
    return { ...report, idle: true, peers: reads.length, conflicts: loadConflicts().length };
  }

  // 3. Merge synchronously: no other code can write between reading local data and writing the result.
  //    If applying a peer's data would leave a damaged table, that peer is left out and the rest applies.
  const excluded = new Map<string, string>();
  let result: MergeResult;
  let proj: ReturnType<typeof project>;
  for (;;) {
    const use = fresh.filter((r) => !excluded.has(r.id)).map((r) => r.file!);
    result = mergeAttempt(o, use, floor, at);
    try {
      proj = project(result.ctx.work);
      break;
    } catch (err) {
      let culprit: string | undefined;
      for (let i = 1; i <= use.length && !culprit; i++) {
        try {
          project(mergeAttempt(o, use.slice(0, i), floor, at).ctx.work);
        } catch {
          culprit = use[i - 1].device.id;
        }
      }
      if (!culprit) {
        return { ...report, ok: false, reason: 'error', message: `Sync could not apply the changes, so nothing was changed: ${(err as Error)?.message ?? err}` };
      }
      excluded.set(culprit, `its changes could not be applied (${(err as Error)?.message ?? err}); nothing from it was changed`);
    }
  }
  const { ctx, logs, names } = result;
  const state = ctx.state;
  let committed: { changed: string[]; texts: Record<string, string | null> };
  try {
    // Another device's changes are not a user edit: the table-level role guard does not apply (6.21).
    committed = asSystem(() => commit(ctx.work, proj));
  } catch (err) {
    return { ...report, ok: false, reason: 'error', message: `Sync could not apply the changes, so nothing was changed: ${(err as Error)?.message ?? err}` };
  }

  // Peer bookkeeping (only peers whose data was applied get the "unchanged" fingerprint).
  for (const r of reads) {
    const p = own(state.peers, r.id);
    if (r.same && p) {
      p.seen_at = at;
      state.clock = Math.max(state.clock, p.clock);
      continue;
    }
    const why = r.error ?? excluded.get(r.id);
    if (r.file && !why) {
      const f = r.file;
      state.peers[r.id] = { name: f.device.name, clock: f.clock, written_at: f.written_at, seen_at: at, status: 'ok', ...(f.prefix ? { prefix: f.prefix } : {}), blobs: f.blobs, file_hash: r.hash };
      continue;
    }
    const status: PeerInfo['status'] = r.version ? 'version' : r.stale ? 'stale' : excluded.has(r.id) ? 'skipped' : 'unreadable';
    // Keep the last good fingerprint-free info: the file is read in full again next time.
    state.peers[r.id] = { ...(p ?? { name: r.file?.device.name ?? '', clock: 0, written_at: '' }), seen_at: p?.seen_at ?? '', status, message: why, file_hash: undefined };
    report.unreadable.push({ device: r.id, name: p?.name ?? r.file?.device.name, message: why ?? 'unreadable' });
  }
  Object.assign(report, ctx.stats, { peers: reads.length, conflicts: ctx.conflicts.length });
  if (ctx.stats.added + ctx.stats.updated + ctx.stats.deleted + ctx.stats.newConflicts > 0) {
    const parts = [`${ctx.stats.added} added`, `${ctx.stats.updated} changed`, `${ctx.stats.deleted} deleted`];
    asSystem(() => audit.record({
      entity: 'system', entity_id: 'sync', action: 'import',
      summary: `Folder sync from ${names.join(', ') || 'other devices'}: ${parts.join(', ')}` +
        (ctx.stats.newConflicts ? `; ${ctx.stats.newConflicts} conflict${ctx.stats.newConflicts === 1 ? '' : 's'} to review` : ''),
    }));
  }
  // Payload is taken now, from the exact state that was just committed.
  const payload = buildPayload(state, ctx.work, o.device, o.prefix);
  const payloadText = JSON.stringify(payload);
  const keyH = { ...hashes };
  for (const [k, v] of Object.entries(committed.texts)) {
    if (v === null) delete keyH[k];
    else keyH[k] = hashStr(v);
  }
  state.key_h = keyH;
  state.last_sync = at;
  noteHighWater(state.clock);
  asSystem(() => saveMeta(state, ctx.conflicts, logs));
  for (const k of committed.changed) noteExternalChange(k);

  // 4. Attachment files: fetch the ones records now point at, upload this device's new ones.
  const peerBlobs = Object.entries(state.peers).filter(([, p]) => p.status === 'ok' && p.blobs?.length);
  const have = new Set(storedAttachmentIds());
  let missing = 0;
  for (const id of referencedAttachmentIds()) {
    if (have.has(id) || !isAttachmentId(id)) continue;
    let got = false;
    for (const [dev, p] of peerBlobs) {
      if (!p.blobs!.includes(id)) continue;
      try {
        const dir = await dirs.blobs.getDirectoryHandle(blobDirName(dev));
        const raw = await withRetry(() => readSealed(dir, `${id}${BLOB_EXT}`, o.key, 'blob', dev, [o.group, 'blob', dev, id]), attempts, delay);
        if (parseStoredAttachment(raw)?.id !== id) continue;
        asSystem(() => writeRaw(attachmentKey(id), raw));
        have.add(id);
        report.blobsIn++;
        got = true;
        break;
      } catch {
        /* try another device / next sync */
      }
    }
    if (!got) missing++;
  }
  const written = new Set(state.blobs_written);
  let mine: SyncDir | null = null;
  for (const id of storedAttachmentIds()) {
    if (written.has(id) || !isAttachmentId(id)) continue;
    const raw = readRaw(attachmentKey(id));
    if (!raw) continue;
    try {
      mine ??= await dirs.blobs.getDirectoryHandle(blobDirName(self), { create: true });
      await writeSealed(mine, `${id}${BLOB_EXT}`, o.key, 'blob', self, raw, [o.group, 'blob', self, id]);
      written.add(id);
      report.blobsOut++;
    } catch {
      /* next sync */
    }
  }

  // 5. Own file: only when something changed (or it is missing), then read back to prove it opens.
  const blobsChanged = written.size !== state.blobs_written.length;
  state.blobs_written = [...written].sort();
  state.blobs_missing = missing;
  const finalText = blobsChanged ? JSON.stringify({ ...payload, blobs: state.blobs_written }) : payloadText;
  const finalHash = hashStr(finalText);
  if (finalHash !== state.last_written_hash || !present.includes(self)) {
    const full = `${finalText.slice(0, -1)},"written_at":${JSON.stringify(at)}}`;
    try {
      await writeSealed(dirs.devices, deviceFileName(self), o.key, 'device', self, full, [o.group, 'device', self]);
      const back = await readSealed(dirs.devices, deviceFileName(self), o.key, 'device', self, [o.group, 'device', self]);
      if (back !== full) throw new Error('read-back mismatch');
      state.last_written_hash = finalHash;
      state.last_written = at;
      report.wrote = true;
    } catch (err) {
      report.ok = false;
      report.reason = 'error';
      report.message = `Could not write this device's sync file: ${(err as Error)?.message ?? err}`;
    }
  }
  if (report.ok && report.unreadable.length) report.message = `${report.unreadable.length} device file${report.unreadable.length === 1 ? '' : 's'} could not be used this time.`;
  asSystem(() => saveMeta(state));
  return report;
}

/** Keep the outcome of every run (also idle and refused ones) for the panel, device-locally. */
export function recordReport(r: SyncReport): void {
  try {
    const last: SyncRunSummary = { at: r.at, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), ...(r.message ? { message: r.message } : {}), conflicts: r.conflicts };
    setCompanySyncPrefs({ last });
  } catch {
    /* display only */
  }
}

/* ── Conflict resolution ───────────────────────────────────────── */

/**
 * R4-C7: `{ merge }` keeps both versions field by field (masters) or group by group (documents): `merge` maps a
 * field / group to the side it comes from (`field-merge.ts`). Only for concurrent edits of a row that exists on both.
 */
export type Resolution = 'mine' | 'theirs' | 'ack' | { merge: FieldPicks };

export interface ResolveResult {
  ok: boolean;
  message?: string;
  /** The current version changed since the conflict was listed; the listing was refreshed. */
  stale?: boolean;
  /** Writing this version needs the PIN override (locked period or a looser lock). */
  needsOverride?: boolean;
}

/**
 * Resolve one listed conflict. Rows / singletons: the chosen version becomes a new version that
 * dominates both (so every device converges on it at its next sync), but only when the current version
 * is still the one that was listed — otherwise the listing is refreshed and nothing is written. Anything
 * that writes into a locked period or loosens the lock needs `override` (PIN verified by the caller,
 * `period.override` permission) and is written to the audit log. Declining a locked-period change keeps
 * it on the other device only. Duplicates: 'ack' marks the pair reviewed (renumber by hand).
 */
export function resolveConflict(id: string, choice: Resolution, device: { id: string; name: string }, opts: { override?: boolean } = {}): Promise<ResolveResult> {
  return exclusive(async () => {
    const conflicts = loadConflicts();
    const c = conflicts.find((x) => x.id === id);
    if (!c) return { ok: false, message: 'That conflict is no longer listed.' };
    const need = (action: AccessAction): string | null => {
      try {
        requireAccess(action);
        return null;
      } catch (err) {
        return (err as Error)?.message || 'You do not have permission to do that.';
      }
    };
    const state = loadState();
    const rest = conflicts.filter((x) => x.id !== id);
    if (c.kind === 'duplicate') {
      const denied = need('doc.edit');
      if (denied) return { ok: false, message: denied };
      if (!state.dup_ack.includes(c.sig)) state.dup_ack.push(c.sig);
      saveMeta(state, rest);
      return { ok: true };
    }
    // A person chooses here, so their role applies (a viewer can never resolve): the general edit right,
    // plus the table's own right (masters / books) or settings for singletons.
    let denied = need(c.kind === 'single' ? 'settings.manage' : 'doc.edit');
    if (!denied && c.kind === 'row') {
      try {
        requireTableWrite(c.key.slice(DB_PREFIX.length));
      } catch (err) {
        denied = (err as Error)?.message || 'You do not have permission to change that.';
      }
    }
    if (denied) return { ok: false, message: denied };
    const self = device.id;
    const work = loadWork();
    state.clock = Math.max(state.clock, highWater() ?? 0);
    scanLocal(state, work, self);

    // Is the current version still the one that was listed?
    const ks = own(state.keys, c.key);
    const w = work.get(c.key);
    const curMeta = c.kind === 'row' ? (ks?.mode === 'rows' ? own(ks.rows, c.row_id!) ?? null : null) : ks?.mode === 'single' ? ks.meta : null;
    const curValue = c.kind === 'row' ? (w?.mode === 'rows' ? (w.rows.get(c.row_id!) ?? null) : null) : w?.mode === 'single' ? w.value : null;
    const listed = c.kind === 'single' && c.applied === 'remote' ? c.remote.meta : c.local.meta;
    const current = curMeta && curMeta.del && c.kind === 'row' && !listed ? null : curMeta;
    if (!sameVersion(current, listed)) {
      const side: ConflictSide = { meta: curMeta ? cloneMeta(curMeta) : null, value: curValue };
      if (c.kind === 'single' && c.applied === 'remote') c.remote = side;
      else c.local = side;
      saveMeta(state, conflicts);
      return { ok: false, stale: true, message: 'This changed since it was listed. Check both versions again, then choose.' };
    }

    if ((c.reason === 'locked' || c.reason === 'payment') && choice === 'mine') {
      // Declined: stays on the other device only; not offered again until it changes there.
      state.declined[`${c.key}|${c.row_id ?? ''}`] = c.remote.meta?.del ? '' : (c.remote.meta?.h ?? '');
      saveMeta(state, rest);
      return { ok: true };
    }
    // R4-C7: a field-level merge becomes the picked version (validated first; the vector covers both sides as below).
    let pick: ConflictSide = choice === 'theirs' ? c.remote : c.local;
    const merge = typeof choice === 'object' ? choice.merge : null;
    if (merge) {
      if (c.kind !== 'row' || c.reason !== 'concurrent' || !curValue || !c.remote.value) return { ok: false, message: 'Only a row edited on both devices can be merged field by field.' };
      const table = c.key.slice(DB_PREFIX.length);
      const merged = mergeFields(table, curValue, c.remote.value, merge);
      const bad = validateMerged(table, merged, curValue as Record<string, unknown>, c.remote.value as Record<string, unknown>, merge);
      if (bad) return { ok: false, message: bad === 'mergeTotals' ? 'The merged document no longer adds up: choose lines and totals from one side.' : 'The merged voucher does not balance: choose its lines from one side.' };
      pick = { meta: null, value: merged };
    }
    const settingsW = work.get(SINGLETON_KEYS.settings);
    const lock = lockOf(settingsW?.mode === 'single' ? settingsW.value : null);
    const writesData = c.kind === 'row'
      ? !sameJson(curValue, pick.value)
      : ((curValue as string | null) ?? null) !== ((pick.value as string | null) ?? null);
    const locked = c.reason === 'locked' || (writesData && (c.kind === 'row'
      ? touchesLock(lock, c.key, curValue ?? undefined, pick.value ?? undefined)
      : c.key === SINGLETON_KEYS.settings && loosensLock(curValue as string | null, pick.value as string | null)));
    if (locked) {
      if (!opts.override) return { ok: false, needsOverride: true, message: 'Enter your PIN to change books in a locked period.' };
      const deniedLock = need('period.override');
      if (deniedLock) return { ok: false, message: deniedLock };
    }

    if (c.kind === 'row') {
      const rowId = c.row_id!;
      let wr = w;
      if (!wr) {
        wr = { mode: 'rows', ids: [], rows: new Map(), dirty: false };
        work.set(c.key, wr);
      }
      if (wr.mode !== 'rows') return { ok: false, message: 'This table changed shape; resolve it by restoring a backup.' };
      let rks = own(state.keys, c.key);
      if (!rks || rks.mode !== 'rows') rks = state.keys[c.key] = { mode: 'rows', rows: {} };
      const lm = own(rks.rows, rowId);
      if (writesData) {
        if (pick.value === null) removeRow(wr, rowId);
        else upsertRow(wr, rowId, pick.value);
      }
      const t = ++state.clock;
      const vv = { ...mergeVV(mergeVV(lm?.vv ?? {}, c.remote.meta?.vv ?? {}), c.local.meta?.vv ?? {}), [self]: t };
      const h = pick.value === null ? '' : hashStr(JSON.stringify(pick.value));
      rks.rows[rowId] = { h, t, d: self, vv, o: minStr(lm?.o ?? '', c.remote.meta?.o ?? '') || self, ...(pick.value === null ? { del: 1 as const } : {}) };
    } else {
      const t = ++state.clock;
      const lm = ks?.mode === 'single' ? ks.meta : null;
      const value = (pick.value as string | null) ?? null;
      if (writesData) work.set(c.key, { mode: 'single', value, dirty: true });
      const vv = { ...mergeVV(mergeVV(lm?.vv ?? {}, c.remote.meta?.vv ?? {}), c.local.meta?.vv ?? {}), [self]: t };
      state.keys[c.key] = { mode: 'single', meta: { h: value === null ? '' : hashStr(value), t, d: self, vv, o: lm?.o || self, ...(value === null ? { del: 1 as const } : {}) } };
    }
    let changed: string[];
    try {
      changed = commit(work).changed;
    } catch (err) {
      return { ok: false, message: (err as Error)?.message || 'Could not apply that version.' };
    }
    const label = c.kind === 'row' ? `${tableLabel(c.key)} row` : tableLabel(c.key);
    audit.record({
      entity: 'system', entity_id: 'sync', action: locked ? 'override' : 'update',
      summary: locked
        ? c.kind === 'row'
          ? `Applied a synced version from ${choice === 'theirs' ? c.device_name || 'another device' : 'this device'} to a ${label} in a locked period`
          : `Took the period-lock change from ${choice === 'theirs' ? c.device_name || 'another device' : 'this device'}`
        : merge
          ? `Sync conflict on ${label}: merged field by field with the version from ${c.device_name || 'another device'} (${Object.entries(merge).filter(([, v]) => v === 'theirs').map(([k]) => k).join(', ') || 'all mine'} from theirs)`
          : `Sync conflict on ${label}: kept ${choice === 'theirs' ? `the version from ${c.device_name || 'another device'}` : "this device's version"}`,
    });
    noteHighWater(state.clock);
    state.last_written_hash = ''; // the new version must be written out even if no data text changed
    saveMeta(state, rest);
    for (const k of changed) noteExternalChange(k);
    return { ok: true };
  });
}

/* ── Status for the UI ─────────────────────────────────────────── */

export interface NumberingWarning {
  series: string;
  devices: string[];
}

/** Number series (prefix/FY) that documents introduced by more than one device share. */
export function sharedSeries(state: SyncState = loadState(), self?: string): NumberingWarning[] {
  const ks = own(state.keys, INVOICES_KEY);
  if (!ks || ks.mode !== 'rows') return [];
  let rows: Map<string, unknown> | null = null;
  const raw = readRaw(INVOICES_KEY);
  try {
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (Array.isArray(list)) rows = assignIds(list).rows;
  } catch {
    rows = null;
  }
  if (!rows) return [];
  const bySeries = new Map<string, Set<string>>();
  for (const [id, m] of Object.entries(ks.rows)) {
    if (m.del) continue;
    const p = parseDocNumber((rows.get(id) as { invoice_number?: string } | undefined)?.invoice_number);
    if (!p) continue;
    const s = `${p.prefix}/FY${p.fy}`;
    const set = bySeries.get(s) ?? new Set<string>();
    set.add(m.o);
    bySeries.set(s, set);
  }
  const name = (d: string) => (d === self ? 'this device' : own(state.peers, d)?.name || 'another device');
  return [...bySeries].filter(([, s]) => s.size > 1).map(([series, s]) => ({ series, devices: [...s].map(name) }));
}
