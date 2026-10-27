/**
 * Backup / restore of everything the app keeps in localStorage.
 *
 * Attachments (6.12) are one `mrchartist_inv_att_<id>` key per file, so they ride along too;
 * on restore each file is re-checked by content (damaged / disallowed ones are left out) and
 * references to files the backup lacks are reported, not refused (see attachments.ts).
 *
 * Self-contained: the `mrchartist_inv_assets` table (logo / signature images that
 * invoice snapshots reference since schema v3) is an ordinary app key, so it rides
 * along, and a file whose references do not resolve is refused. Older backups with
 * inline images restore as they are and are moved to references by the v3 migration
 * on the reload that follows.
 *
 * Exports carry only `mrchartist_inv_*` keys and never the PIN session. Imports
 * accept the same keys (and the older flat `{key: value}` file) and refuse
 * anything outside that namespace, so a doctored file cannot overwrite
 * unrelated site data.
 */

import { DB_PREFIX, DEVICE_DRAFT_KEYS, SYNC_META_KEYS, collectAppData, readRaw, registerVaultTransition, removeRaw, vaultEnabled, vaultSeal, vaultUnseal, writeRaw } from './storage';
import { idbDel, idbGet, idbSet } from './idb-kv';
import { LATEST_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from './migrations';
import { DEVICE_LOCAL_KEYS } from './auth';
import { requireAccess } from './access';
import { ASSET_TABLE, SNAPSHOT_TABLES, parseAssets, referencedAssets } from './assets';
import { checkBackupAttachments } from './attachments';
import { CUSTOM_FIELDS_TABLE } from './custom-fields';
import { localDayOf } from './dates';
import { AUDIT_TABLE, audit } from './audit';
import type { AuditEntry } from '../types/audit';
import {
  CryptoError,
  decryptString,
  encryptString,
  encryptWithKey,
  isCipherEnvelope,
  type CipherEnvelope,
  type StoredEncryptionKey,
} from './crypto';

export const BACKUP_APP_ID = 'mrchartist-invoice';

export const LAST_BACKUP_KEY = `${DB_PREFIX}last_backup`;

/** Wrapper for a passphrase-encrypted export. `envelope.ct` decrypts to a plain BackupFile JSON string. */
export interface EncryptedBackupFile {
  app: typeof BACKUP_APP_ID;
  encrypted: true;
  version: 1;
  exportedAt: string;
  envelope: CipherEnvelope;
}

/** Thrown by parseBackup() for an encrypted file so the UI can ask for the passphrase. */
export class EncryptedBackupError extends Error {
  readonly code = 'encrypted';
  constructor() {
    super('This backup is encrypted. Enter its passphrase to restore it.');
    this.name = 'EncryptedBackupError';
  }
}

const LOCAL_ONLY = new Set<string>(DEVICE_LOCAL_KEYS);
/**
 * Never exported, restored or kept in the undo copy, but removed by a wipe (unlike LOCAL_ONLY): folder-sync
 * bookkeeping describes what this device last exchanged with the sync folder (docs/features/sync.md).
 */
const NOT_BACKED_UP = new Set<string>([...SYNC_META_KEYS, ...DEVICE_DRAFT_KEYS]); // + POS bills on hold (8.21)
const leaveOut = (key: string) => LOCAL_ONLY.has(key) || NOT_BACKED_UP.has(key);

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export interface BackupSummary {
  invoices: number;
  clients: number;
  keys: number;
  /** Attachment files (6.12) in the backup. */
  attachments?: number;
  /** Files records refer to but the backup does not contain (restored as "file missing"). */
  missingAttachments?: number;
  /** Damaged or disallowed attachment files left out of the restore. */
  droppedAttachments?: number;
  /** Business name of the active profile in the backup (QA-3 F14: the restore confirm names it). */
  business?: string;
  /** When the backup file was made (ISO), if it says. */
  exportedAt?: string;
}

/** The active sender profile's business name in a backup's settings ('' when there is none). */
export function backupBusinessName(data: Record<string, string>): string {
  try {
    const s = JSON.parse(data[`${DB_PREFIX}settings`] ?? 'null') as { profiles?: { id?: string; companyName?: string }[]; activeProfileId?: string; companyName?: string } | null;
    if (!s || typeof s !== 'object') return '';
    const profiles = Array.isArray(s.profiles) ? s.profiles : [];
    const active = profiles.find((p) => p?.id === s.activeProfileId) ?? profiles[0];
    return String(active?.companyName ?? s.companyName ?? '').trim().slice(0, 120);
  } catch {
    return '';
  }
}

/**
 * Largest backup file the restore screen reads. Higher than the CSV import cap because a backup
 * carries attachments (6.12): receipt photos and PDFs travel inside it as base64.
 */
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

/** Extra sentence(s) for the restore confirmation about attachment files ('' when there are none). */
export function attachmentRestoreNote(summary: BackupSummary | undefined | null): string {
  if (!summary) return '';
  const plural = (n: number) => `${n} attached file${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (summary.attachments) parts.push(`It also carries ${plural(summary.attachments)}.`);
  if (summary.missingAttachments) parts.push(`${plural(summary.missingAttachments)} referred to by its records ${summary.missingAttachments === 1 ? 'is' : 'are'} not in this file and will show as missing.`);
  if (summary.droppedAttachments) parts.push(`${plural(summary.droppedAttachments)} could not be read and will be left out.`);
  return parts.join(' ');
}

function collectBackup(now: Date): BackupFile {
  const data = collectAppData();
  for (const key of Object.keys(data)) if (leaveOut(key)) delete data[key];
  return { app: BACKUP_APP_ID, version: 1, exportedAt: now.toISOString(), data };
}

/**
 * A full backup (every table). Local roles (6.21): handing someone a copy of the books is owner-only,
 * so this throws AccessDeniedError for a clerk / viewer. Scheduled folder backups the owner set up use
 * {@link buildScheduledBackup} instead and keep running whoever is signed in.
 */
export function buildBackup(now: Date = new Date()): BackupFile {
  requireAccess('data.backup');
  return collectBackup(now);
}

/**
 * @internal Scheduled backups only (auto-backup.ts, unattended runs into the folder the owner chose):
 * no role check, by design — the owner configured them, and the file goes to the owner's folder.
 */
export function buildScheduledBackup(now: Date = new Date()): BackupFile {
  return collectBackup(now);
}

/**
 * Vault mode (5.8) encrypts the data at rest, so a readable backup file would undo it: plain JSON
 * exports are refused while the vault is on (use a passphrase-encrypted backup instead).
 */
export function plainBackupAllowed(): boolean {
  return !vaultEnabled();
}

export const VAULT_PLAIN_BACKUP_MESSAGE =
  'Vault mode is on, so backups must be encrypted: set a backup passphrase (Settings → Data → Automatic backups) or use Encrypted backup in Settings → Security.';

/** Text of a plain (unencrypted) full backup for a manual download. Owner only; refused in vault mode. */
export function exportPlainBackup(now: Date = new Date()): string {
  return plainBackupParts(now).join('');
}

/**
 * PERF-1 (H11): the same file as a Blob built from parts, so the 60–70 MB text is never materialised
 * as one string (the download / save-to-disk paths). Byte-for-byte equal to `exportPlainBackup`.
 */
export function exportPlainBackupBlob(now: Date = new Date(), type = 'application/json;charset=utf-8'): Blob {
  return new Blob(plainBackupParts(now), { type });
}

function plainBackupParts(now: Date): string[] {
  requireAccess('data.backup');
  if (!plainBackupAllowed()) throw new Error(VAULT_PLAIN_BACKUP_MESSAGE);
  return backupTextParts(collectBackup(now));
}

/** `JSON.stringify(file, null, 2)` as a list of parts (one per stored value): same text when joined. */
export function backupTextParts(file: BackupFile): string[] {
  const out: string[] = ['{'];
  let first = true;
  for (const [k, v] of Object.entries(file)) {
    if (v === undefined) continue;
    out.push(`${first ? '' : ','}\n  ${JSON.stringify(k)}: `);
    first = false;
    if (k === 'data' && v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, string>).filter(([, x]) => x !== undefined);
      if (!entries.length) {
        out.push('{}');
        continue;
      }
      out.push('{');
      entries.forEach(([dk, dv], i) => out.push(`${i ? ',' : ''}\n    ${JSON.stringify(dk)}: `, JSON.stringify(dv)));
      out.push('\n  }');
    } else out.push(JSON.stringify(v, null, 2).replace(/\n/g, '\n  '));
  }
  out.push(first ? '}' : '\n}');
  return out;
}

export function backupFilename(now: Date = new Date(), encrypted = false): string {
  return `mrchartist-invoice-backup-${localDayOf(now)}${encrypted ? '.encrypted' : ''}.json`;
}

/** Records that a backup was just exported. Call it after the file has been handed to the user. */
export function markBackupDone(now: Date = new Date()): void {
  try {
    writeRaw(LAST_BACKUP_KEY, now.toISOString());
  } catch {
    /* a failed bookkeeping write must never fail the export */
  }
}

/** ISO timestamp of the last export, or null. */
export function getLastBackup(): string | null {
  const raw = readRaw(LAST_BACKUP_KEY);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

/** Whole days since the last export (null if never). */
export function daysSinceBackup(now: Date = new Date()): number | null {
  const last = getLastBackup();
  return last ? Math.max(0, Math.floor((now.getTime() - Date.parse(last)) / 86_400_000)) : null;
}

/** Encrypts the full backup with a passphrase (AES-GCM-256, PBKDF2-SHA-256). Returns the file text. */
export async function buildEncryptedBackup(passphrase: string, now: Date = new Date()): Promise<string> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const plain = JSON.stringify(buildBackup(now));
  const file: EncryptedBackupFile = {
    app: BACKUP_APP_ID,
    encrypted: true,
    version: 1,
    exportedAt: now.toISOString(),
    envelope: await encryptString(plain, passphrase),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Same file format as `buildEncryptedBackup`, encrypted with a stored passphrase-derived key. Owner only,
 * except `scheduled` runs (unattended folder backups the owner set up, see auto-backup.ts).
 */
export async function buildEncryptedBackupWithKey(stored: StoredEncryptionKey, now: Date = new Date(), opts: { scheduled?: boolean } = {}): Promise<string> {
  const backup = opts.scheduled ? buildScheduledBackup(now) : buildBackup(now);
  const file: EncryptedBackupFile = {
    app: BACKUP_APP_ID,
    encrypted: true,
    version: 1,
    exportedAt: now.toISOString(),
    envelope: await encryptWithKey(JSON.stringify(backup), stored),
  };
  return JSON.stringify(file, null, 2);
}

/** True when the text is one of our passphrase-encrypted exports. */
export function isEncryptedBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedBackupFile> | null;
    return !!parsed && parsed.app === BACKUP_APP_ID && parsed.encrypted === true;
  } catch {
    return false;
  }
}

/** Decrypts an encrypted export and validates it like parseBackup(). Throws a readable Error on a wrong passphrase. */
export async function decryptBackup(
  text: string,
  passphrase: string,
): Promise<{ data: Record<string, string>; summary: BackupSummary }> {
  let parsed: Partial<EncryptedBackupFile> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || parsed.app !== BACKUP_APP_ID || parsed.encrypted !== true || !isCipherEnvelope(parsed.envelope)) {
    throw new Error('This is not an encrypted invoice backup.');
  }
  let plain: string;
  try {
    plain = await decryptString(parsed.envelope, passphrase);
  } catch (err) {
    if (err instanceof CryptoError) throw new Error(err.message, { cause: err });
    throw err;
  }
  return parseBackup(plain);
}

/** Parsed values of a backup's keys, each parsed at most once per check (PERF-1, H11). */
type BackupParser = (fullKey: string) => { ok: boolean; value: unknown };
function backupParser(data: Record<string, string>): BackupParser {
  const seen = new Map<string, { ok: boolean; value: unknown }>();
  return (key) => {
    let e = seen.get(key);
    if (!e) {
      try {
        e = { ok: true, value: JSON.parse(data[key]) as unknown };
      } catch {
        e = { ok: false, value: null };
      }
      seen.set(key, e);
    }
    return e;
  };
}

function countRows(raw: string | undefined, parsed?: unknown): number {
  if (!raw) return 0;
  if (parsed !== undefined) return Array.isArray(parsed) ? parsed.length : 0;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

/** Validates a backup file's text. Throws a readable Error when it is not one of ours. */
export function parseBackup(text: string): { data: Record<string, string>; summary: BackupSummary } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This does not look like an invoice backup.');
  }

  const root = parsed as Record<string, unknown>;
  if (root.app === BACKUP_APP_ID && root.encrypted === true) throw new EncryptedBackupError();
  const source = (root.app === BACKUP_APP_ID && root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  if (root.app === BACKUP_APP_ID && typeof root.version === 'number' && root.version > 1) {
    throw new Error('This backup was made by a newer version of the app. Update the app, then restore it.');
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith(DB_PREFIX) || leaveOut(key)) continue;
    if (typeof value === 'string') data[key] = value;
  }
  if (Object.keys(data).length === 0) {
    throw new Error('No invoice data found in this file.');
  }
  const parse = backupParser(data);
  validateBackupData(data, parse);
  // Attachment files are checked by content; bad ones are left out, dangling references reported.
  const files = checkBackupAttachments(data, (k) => (data[k] ? parse(k).value : null));
  const rowsOf = (key: string) => countRows(data[key], data[key] ? parse(key).value : undefined);

  return {
    data,
    summary: {
      invoices: rowsOf(`${DB_PREFIX}invoices`),
      clients: rowsOf(`${DB_PREFIX}clients`),
      keys: Object.keys(data).length,
      ...(files.files ? { attachments: files.files } : {}),
      ...(files.missing ? { missingAttachments: files.missing } : {}),
      ...(files.dropped ? { droppedAttachments: files.dropped } : {}),
      ...(backupBusinessName(data) ? { business: backupBusinessName(data) } : {}),
      ...(typeof root.exportedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(root.exportedAt) ? { exportedAt: root.exportedAt } : {}),
    },
  };
}

/** Tables whose rows are records; a restore refuses a file where one of them is malformed. */
const RECORD_TABLES = [
  'invoices', 'clients', 'items_catalog', 'transactions', 'vendors', 'purchases',
  'purchase_payments', 'recurring', 'doc_links', 'audit_log', 'gstr2b_actions', 'einvoice_meta', ASSET_TABLE,
  // Double-entry ledger (6.1–6.3)
  'accounts', 'vouchers', 'fixed_assets',
  // Time & billable costs (6.13 / 6.14)
  'time_entries', 'mileage',
  // Purchase orders (6.5)
  'purchase_orders',
  // Cost centres & budgets (6.16 / 6.17)
  'cost_centres', 'budgets',
  // Custom field definitions (6.23)
  CUSTOM_FIELDS_TABLE,
  // Cheque register (6.26)
  'cheques',
  // Bank accounts (multi-account BRS)
  'bank_accounts',
  // Inventory: stock items and moves, godowns + stock transfers (6.10)
  'stock_items', 'stock_moves', 'godowns', 'stock_transfers',
  // Advance receipts (5.3)
  'advances',
  // Price levels & schemes (6.9), POS day-close records (6.8)
  'price_levels', 'schemes', 'pos_day_close',
  // 8E retail speed: cashier shifts (X / Z per shift)
  'pos_shifts',
  // Tally parity: TDS challans / manual deductions / return marks, supplier advances (bill-wise)
  'tds_challans', 'tds_deductions', 'tds_returns', 'vendor_payments',
  // Series high-water marks: STR / PO / ADV / RFV / RCPT numbers are never reused (integrity review)
  'series_counters',
  // GSTR-4 typed-in Tables 7-9 per FY × GSTIN (5.9)
  'gstr4_manual',
  // WP-3: purchase returns / supplier notes, receipt notes (GRN) and rejections out
  'purchase_returns', 'receipt_notes',
  // Masters & openings (WP-1)
  'groups', 'ledger_openings', 'books_begin', 'opening_bills',
  // Banking (WP-5): deposit slips, day-end cash tally
  'deposit_slips', 'cash_tally',
  // Business extras (WP-9): POS returns, approvals, branches, loyalty, AMC contracts
  'pos_returns', 'approvals', 'branches', 'loyalty_adjustments', 'amc_contracts',
  // Payroll (Phase 7)
  'employees', 'employee_groups', 'pay_heads', 'salary_structures', 'attendance_types', 'attendance', 'payroll_runs', 'payroll_payments',
  // Payroll depth (7P): arrears, loans, leave, adjustments, perquisites, full & final
  'payroll_arrears', 'employee_loans', 'leave_types', 'leave_entries', 'payroll_adjustments', 'perquisites', 'fnf_settlements',
  // Payroll follow-ups (7T): relief u/s 89 (Form 10E) workings, actuarial valuations
  'payroll_relief89', 'actuarial_valuations',
  // Manufacturing & stock vouchers (Phase 7): BOMs, Manufacturing / Stock Journals, Physical Stock
  'boms', 'manufacturing_vouchers', 'stock_journals', 'physical_stock',
  // Job work and Rejections In (Phase 7M)
  'job_work_orders', 'job_work_out', 'job_work_in', 'job_work_principal', 'rejections_in',
  // 7S: production plans (MRP)
  'production_plans',
  // GST set-off & payment (WP-6): set-off journals, PMT-06 challans, HSN master with rate history
  'gst_setoffs', 'gst_challans', 'hsn_master',
  // 7O: RCM self-invoices (Rule 46(f)) and payment vouchers (Rule 52)
  'rcm_documents',
  // 7R: PMT-09 transfers, GST refund claims, ISD documents, TRACES justification imports
  'gst_pmt09', 'gst_refunds', 'isd_documents', 'tds_justifications',
  // Migration, audit & year-end (WP-7): reviewed year-end steps per FY
  'year_end',
  // Inventory masters (WP-8): stock groups, stock categories, units of measure
  'stock_groups', 'stock_categories', 'units',
  // 7U: forex bank moves, e-payment batches, sales agents, commission postings
  'fx_bank_moves', 'epay_batches', 'sales_agents', 'commission_postings',
  // 8D GST guards: supplier follow-ups from the 2B match, 2B ITC pushed to the 3B view, GSTR-1 as-filed snapshots
  'gst_followups', 'gstr2b_itc', 'gstr1_snapshots',
  // 8C: documents inbox, draft bills, recurring bills, bank rules, supplier payment requests
  'doc_inbox', 'purchase_drafts', 'recurring_bills', 'bank_rules', 'payment_requests',
  // 8F: distribution masters, van settlements, order pad, breakage / expiry claims and receipts
  'dist_areas', 'dist_routes', 'dist_beats', 'van_settlements', 'order_pad_outbox', 'order_pad_imports', 'expiry_claims', 'expiry_receipts',
  // 8H: business loans & EMIs, currency reference rates
  'business_loans', 'currency_rates',
  // Round 2 (R2-C): notes to accounts per FY, deferral schedules, packing lists, package types
  'notes_to_accounts', 'deferrals', 'packing_lists', 'package_types',
  // Round 2 (R2-A): payment terms master, collection follow-ups, bad-debt recoveries
  'payment_terms', 'collection_notes', 'write_off_recoveries',
  // Round 2 (R2-B): batch invoice runs, proposal section snippets
  'batch_runs', 'proposal_snippets',
  // Round 3 (R3-A): restaurant dining areas, tables, running orders, modifier groups
  'dining_areas', 'dining_tables', 'table_orders', 'modifier_groups',
  // Round 3 (R3-B): work types (rate cards), project tasks, retainers
  'work_types', 'project_tasks', 'retainers',
  // Round 3 (R3-C): GSTR-1 portal file imports, DSC register, monthly client checklist
  'gst_portal_files', 'dsc_register', 'client_checklist',
  // Round 4 (R4-A): production orders, QC decisions, recall notices, landed-cost vouchers
  'production_orders', 'qc_results', 'recall_notices', 'landed_cost_vouchers',
  // Round 4 (R4-B): gift vouchers, store price overrides, transfer requests
  'gift_vouchers', 'branch_prices', 'transfer_requests',
  // Round 4 (R4-C): LUT register, export IRMs / incentives / write-offs, recycle bin
  'lut_register', 'export_irms', 'export_incentives', 'export_writeoffs', 'recycle_bin',
  // Round 5 (R5-A): sales channels, channel SKU map, marketplace imports, settlements, GST TCS / TDS credit rows, returns desk
  'sales_channels', 'channel_skus', 'marketplace_imports', 'settlements', 'eco_credits', 'marketplace_returns',
  // Round 5 (R5-C): fee plans / runs, common-credit runs, donations, 10BD filings, 10BE, properties, leases, security deposits
  'fee_plans', 'fee_runs', 'common_credit_runs', 'donations', 'form_10bd_filings', 'form_10be', 'properties', 'leases', 'security_deposits',
  // Round 5 (R5-B): consignment notes, GTA option per FY, vehicles, trip sheets, RA measurements, BOQ coefficients
  'consignment_notes', 'gta_options', 'vehicles', 'trips', 'ra_measurements', 'boq_coefficients',
  // Round 6 (R6-C3): one row per import run of suppliers / ledgers / opening balances
  'import_runs',
  // Round 7 (hotel): room types, rooms, rate plans, reservations, folios, guests, night audits
  'hotel_room_types', 'hotel_rooms', 'hotel_rate_plans', 'hotel_reservations', 'hotel_folios', 'hotel_guests', 'hotel_night_audits',
  // Round 8 (R8-A): party rates, trade claims, price-drop runs, interest runs, packaging types / moves
  'party_rates', 'trade_claims', 'price_drops', 'interest_runs', 'packaging_types', 'packaging_moves',
  // Round 8 (R8-B): bill-charge heads, brokerage postings
  'trade_charge_heads', 'brokerage_postings',
  // Round 8 (R8-C): arrivals, bikri pattis, indents
  'arrivals', 'sale_pattis', 'indents',
  // Round 9 (R9-A … R9-E): retail riders / settlements / short book; doctors, refills; alterations; IMEI checks, finance
  // deals, service jobs; metal rates, jewellery tags, karigar moves (names in `retail/rt-shared.ts`)
  'delivery_riders', 'rider_settlements', 'short_book', 'doctors', 'rx_refills', 'alteration_jobs', 'imei_checks', 'finance_deals', 'service_jobs', 'metal_rates', 'jewel_tags', 'karigar_moves',
  // R11-B (construction finance): contract register, secured advances, price-variation statements, bank guarantees
  'works_contracts', 'secured_advances', 'price_variations', 'bank_guarantees',
  // R11-C: builders — projects, units, bookings (BKG/FY…), payment plans, stage certificates, RERA account entries
  'realty_projects', 'realty_units', 'realty_bookings', 'payment_plans', 'stage_certificates', 'rera_withdrawals',
  // R10-A: appointments, service staff, commission plans, staff payouts, payer claims (CLM/FY…)
  'appointments', 'service_staff', 'commission_plans', 'staff_payouts', 'payer_claims',
  // R10-B: OPD visits (OPD/FY…), admissions (IPD/FY…), lab test master, lab orders (LAB/FY…)
  'clinic_visits', 'admissions', 'lab_tests', 'lab_orders',
  // R10-C: membership plans, memberships (MEM/FY…), check-ins (one row per day), classes / batches, class attendance
  'member_plans', 'memberships', 'checkins', 'class_schedules', 'class_attendance',
  // R10-D: vehicles / appliances, labour operations (job cards stay in R9's service_jobs)
  'service_assets', 'labour_ops',
  // R11-D: site operations — work orders (SWO), sub-contractor bills (SCB), labour compliance, site workers, muster days
  // (MUS settlements), hired equipment, plant log sheets (PLG)
  'sub_work_orders', 'sub_measurements', 'labour_compliance', 'site_labour', 'muster_days', 'hired_equipment', 'plant_logs',
  // R12-A: farm batches, quality-cut tables, pooled farmer cycles (CYB/FY…)
  'farm_batches', 'quality_cut_tables', 'farmer_cycles',
  // R12-C (mills): weighbridge slips (WBS/FY…), custom-milling agreements (deliveries CMR/FY…)
  'weighbridge_slips', 'cmr_agreements',
  // R12-D: cold-storage lots (CSR / GPO), rent plans, loans against stored produce (LAS), members' share ledger (SHC)
  'cold_lots', 'cold_rent_plans', 'agri_loans', 'member_shares',
];
/** R4-C6: the record tables, for the open-format export's schema guard. */
export const BACKUP_RECORD_TABLES: readonly string[] = RECORD_TABLES;
/** Core tables whose rows must also carry an `id`. */
const ID_TABLES = new Set([
  'invoices', 'clients', 'items_catalog', 'transactions', 'vendors', 'purchases', 'purchase_payments',
  'accounts', 'vouchers', 'fixed_assets', 'time_entries', 'mileage', 'purchase_orders', 'cost_centres', 'budgets', 'cheques', 'bank_accounts', ASSET_TABLE, CUSTOM_FIELDS_TABLE,
  'stock_items', 'godowns', 'stock_transfers', 'advances',
  'price_levels', 'schemes', 'pos_day_close', 'pos_shifts',
  'tds_challans', 'tds_deductions', 'tds_returns', 'vendor_payments',
  'series_counters',
  'gstr4_manual',
  'purchase_returns', 'receipt_notes',
  'groups', 'ledger_openings', 'books_begin', 'opening_bills',
  'deposit_slips', 'cash_tally',
  'pos_returns', 'approvals', 'branches', 'loyalty_adjustments', 'amc_contracts',
  'employees', 'employee_groups', 'pay_heads', 'salary_structures', 'attendance_types', 'attendance', 'payroll_runs', 'payroll_payments',
  // Payroll depth (7P): arrears, loans, leave, adjustments, perquisites, full & final
  'payroll_arrears', 'employee_loans', 'leave_types', 'leave_entries', 'payroll_adjustments', 'perquisites', 'fnf_settlements',
  // Payroll follow-ups (7T): relief u/s 89 (Form 10E) workings, actuarial valuations
  'payroll_relief89', 'actuarial_valuations',
  'boms', 'manufacturing_vouchers', 'stock_journals', 'physical_stock',
  'job_work_orders', 'job_work_out', 'job_work_in', 'job_work_principal', 'rejections_in',
  'production_plans',
  'gst_setoffs', 'gst_challans', 'hsn_master',
  'rcm_documents',
  'gst_pmt09', 'gst_refunds', 'isd_documents', 'tds_justifications',
  'year_end',
  'stock_groups', 'stock_categories', 'units',
  'fx_bank_moves', 'epay_batches', 'sales_agents', 'commission_postings',
  'gst_followups', 'gstr2b_itc', 'gstr1_snapshots',
  'doc_inbox', 'purchase_drafts', 'recurring_bills', 'bank_rules', 'payment_requests',
  'dist_areas', 'dist_routes', 'dist_beats', 'van_settlements', 'order_pad_outbox', 'order_pad_imports', 'expiry_claims', 'expiry_receipts',
  'business_loans', 'currency_rates',
  // Round 2 (R2-C)
  'notes_to_accounts', 'deferrals', 'packing_lists', 'package_types',
  // Round 2 (R2-A)
  'payment_terms', 'collection_notes', 'write_off_recoveries',
  // Round 2 (R2-B): batch invoice runs, proposal section snippets
  'batch_runs', 'proposal_snippets',
  // Round 3 (R3-A)
  'dining_areas', 'dining_tables', 'table_orders', 'modifier_groups',
  // Round 3 (R3-B): work types (rate cards), project tasks, retainers
  'work_types', 'project_tasks', 'retainers',
  // Round 3 (R3-C): GSTR-1 portal file imports, DSC register, monthly client checklist
  'gst_portal_files', 'dsc_register', 'client_checklist',
  // Round 4 (R4-A)
  'production_orders', 'qc_results', 'recall_notices', 'landed_cost_vouchers',
  // Round 4 (R4-B)
  'gift_vouchers', 'branch_prices', 'transfer_requests',
  // Round 4 (R4-C)
  'lut_register', 'export_irms', 'export_incentives', 'export_writeoffs', 'recycle_bin',
  // Round 5 (R5-A)
  'sales_channels', 'channel_skus', 'marketplace_imports', 'settlements', 'eco_credits', 'marketplace_returns',
  // Round 5 (R5-C)
  'fee_plans', 'fee_runs', 'common_credit_runs', 'donations', 'form_10bd_filings', 'form_10be', 'properties', 'leases', 'security_deposits',
  // Round 5 (R5-B)
  'consignment_notes', 'gta_options', 'vehicles', 'trips', 'ra_measurements', 'boq_coefficients',
  // Round 6 (R6-C3): one row per import run of suppliers / ledgers / opening balances
  'import_runs',
  // Round 7 (hotel): room types, rooms, rate plans, reservations, folios, guests, night audits
  'hotel_room_types', 'hotel_rooms', 'hotel_rate_plans', 'hotel_reservations', 'hotel_folios', 'hotel_guests', 'hotel_night_audits',
  // Round 8 (R8-A): party rates, trade claims, price-drop runs, interest runs, packaging types / moves
  'party_rates', 'trade_claims', 'price_drops', 'interest_runs', 'packaging_types', 'packaging_moves',
  // Round 8 (R8-B): bill-charge heads, brokerage postings
  'trade_charge_heads', 'brokerage_postings',
  // Round 8 (R8-C): arrivals, bikri pattis, indents
  'arrivals', 'sale_pattis', 'indents',
  // Round 9 (R9-A … R9-E): retail riders / settlements / short book; doctors, refills; alterations; IMEI checks, finance
  // deals, service jobs; metal rates, jewellery tags, karigar moves (names in `retail/rt-shared.ts`)
  'delivery_riders', 'rider_settlements', 'short_book', 'doctors', 'rx_refills', 'alteration_jobs', 'imei_checks', 'finance_deals', 'service_jobs', 'metal_rates', 'jewel_tags', 'karigar_moves',
  // R11-B (construction finance): contract register, secured advances, price-variation statements, bank guarantees
  'works_contracts', 'secured_advances', 'price_variations', 'bank_guarantees',
  // R11-C: builders — projects, units, bookings (BKG/FY…), payment plans, stage certificates, RERA account entries
  'realty_projects', 'realty_units', 'realty_bookings', 'payment_plans', 'stage_certificates', 'rera_withdrawals',
  // R10-A: appointments, service staff, commission plans, staff payouts, payer claims (CLM/FY…)
  'appointments', 'service_staff', 'commission_plans', 'staff_payouts', 'payer_claims',
  // R10-B: OPD visits (OPD/FY…), admissions (IPD/FY…), lab test master, lab orders (LAB/FY…)
  'clinic_visits', 'admissions', 'lab_tests', 'lab_orders',
  // R10-C: membership plans, memberships (MEM/FY…), check-ins (one row per day), classes / batches, class attendance
  'member_plans', 'memberships', 'checkins', 'class_schedules', 'class_attendance',
  // R10-D: vehicles / appliances, labour operations (job cards stay in R9's service_jobs)
  'service_assets', 'labour_ops',
  // R11-D: site operations — work orders (SWO), sub-contractor bills (SCB), labour compliance, site workers, muster days
  // (MUS settlements), hired equipment, plant log sheets (PLG)
  'sub_work_orders', 'sub_measurements', 'labour_compliance', 'site_labour', 'muster_days', 'hired_equipment', 'plant_logs',
  // R12-A: farm batches, quality-cut tables, pooled farmer cycles (CYB/FY…)
  'farm_batches', 'quality_cut_tables', 'farmer_cycles',
  // R12-C (mills): weighbridge slips (WBS/FY…), custom-milling agreements (deliveries CMR/FY…)
  'weighbridge_slips', 'cmr_agreements',
  // R12-D: cold-storage lots (CSR / GPO), rent plans, loans against stored produce (LAS), members' share ledger (SHC)
  'cold_lots', 'cold_rent_plans', 'agri_loans', 'member_shares',
]);

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Shape check before anything is written: record tables must be JSON arrays of objects
 * (core tables with ids), settings an object, and the schema version not newer than this
 * app understands. Throws a readable Error naming the bad table.
 */
export function validateBackupData(data: Record<string, string>, parse: BackupParser = backupParser(data)): void {
  const version = data[SCHEMA_VERSION_KEY];
  if (version !== undefined) {
    const n = Number(version);
    if (!Number.isInteger(n) || n < 0) throw new Error('This backup has an invalid schema version.');
    if (n > LATEST_SCHEMA_VERSION) {
      throw new Error('This backup was made by a newer version of the app. Update the app, then restore it.');
    }
  }
  for (const table of RECORD_TABLES) {
    const raw = data[DB_PREFIX + table];
    if (raw === undefined) continue;
    const p = parse(DB_PREFIX + table);
    if (!p.ok) throw new Error(`The "${table}" table in this backup is damaged (not valid JSON).`);
    const rows = p.value;
    if (!Array.isArray(rows)) throw new Error(`The "${table}" table in this backup is not a list.`);
    const needsId = ID_TABLES.has(table);
    // Older versions wrote numeric ids, so a number is fine; a missing id is not.
    const hasId = (r: Record<string, unknown>) => (typeof r.id === 'string' && r.id !== '') || typeof r.id === 'number';
    const bad = rows.findIndex((r) => !isPlainObject(r) || (needsId && !hasId(r)));
    if (bad >= 0) throw new Error(`Row ${bad + 1} of the "${table}" table in this backup is damaged.`);
  }
  // Audit archive segments (WP-7, `audit_archive_<n>`): lists of rows like `audit_log` itself.
  for (const key of Object.keys(data)) {
    if (!key.startsWith(`${DB_PREFIX}audit_archive_`)) continue;
    const rows = parse(key).value;
    if (!Array.isArray(rows) || rows.some((r) => !isPlainObject(r))) throw new Error(`The audit archive "${key.slice(DB_PREFIX.length)}" in this backup is damaged.`);
  }
  // Backups are self-contained: every logo/signature reference must resolve inside the file.
  const refs = new Set<string>();
  for (const table of SNAPSHOT_TABLES) {
    const raw = data[DB_PREFIX + table];
    if (raw === undefined) continue;
    const p = parse(DB_PREFIX + table);
    if (!p.ok) JSON.parse(raw); // rethrow the parse error, as before
    referencedAssets(p.value as unknown[], refs);
  }
  if (refs.size > 0) {
    const assets = parseAssets(data[DB_PREFIX + ASSET_TABLE]);
    const missing = [...refs].filter((id) => !assets.byId.has(id)).length;
    if (missing > 0) throw new Error(`This backup is missing ${missing} logo/signature image${missing === 1 ? '' : 's'} its invoices refer to.`);
  }
  const settings = data[`${DB_PREFIX}settings`];
  if (settings !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(settings);
    } catch {
      parsed = null;
    }
    if (!isPlainObject(parsed)) throw new Error('The settings in this backup are damaged.');
  }
}

/* ── Safety snapshot (taken before a restore or wipe) ──────────── */

const SAFETY_KEY = 'safety-snapshot';

export interface SafetySnapshot {
  at: string;
  /** Additive (WP-7): 'import' — taken before a Tally import, undone like a restore. */
  reason: 'restore' | 'wipe' | 'import';
  data: Record<string, string>;
}

/** As stored: in vault mode the data is one sealed JSON string instead of a plain object. */
interface StoredSnapshot {
  at: string;
  reason: SafetySnapshot['reason'];
  data?: Record<string, string>;
  sealed?: string;
}

/**
 * Keep a copy of everything on this device in IndexedDB (separate from the
 * localStorage quota) so a restore or wipe can be undone. Resolves false if the
 * browser cannot store it; callers decide whether to continue.
 */
export async function saveSafetySnapshot(reason: SafetySnapshot['reason'], now: Date = new Date()): Promise<boolean> {
  // Roles (6.21): only someone allowed to restore / erase may replace the owner's undo copy.
  requireAccess(reason === 'wipe' ? 'data.erase' : 'data.restore');
  const data = collectAppData();
  // Audit archive segments (WP-7) are app keys like any other: they ride along in backups and this copy.
  for (const key of Object.keys(data)) if (leaveOut(key)) delete data[key];
  if (Object.keys(data).length === 0) return true; // nothing to protect
  return storeSnapshot({ at: now.toISOString(), reason, data });
}

async function storeSnapshot(snap: SafetySnapshot): Promise<boolean> {
  // Vault mode: the undo copy must not sit in IndexedDB readable.
  const record: StoredSnapshot = vaultEnabled()
    ? { at: snap.at, reason: snap.reason, sealed: await vaultSeal(SAFETY_KEY, JSON.stringify(snap.data)) }
    : { at: snap.at, reason: snap.reason, data: snap.data };
  return idbSet(SAFETY_KEY, record);
}

// Carry the undo copy across a vault on/off switch: one saved before vault mode is sealed once the
// vault is on (it would otherwise stay readable); a sealed one is written back readable when the
// vault is turned off (it could not be opened any more).
registerVaultTransition({
  before: () => getSafetySnapshot(),
  after: async (snap) => {
    if (snap) await storeSnapshot(snap as SafetySnapshot);
  },
});

export async function getSafetySnapshot(): Promise<SafetySnapshot | null> {
  const s = await idbGet<StoredSnapshot>(SAFETY_KEY);
  if (!s || typeof s.at !== 'string') return null;
  if (typeof s.sealed === 'string') {
    const text = await vaultUnseal(SAFETY_KEY, s.sealed);
    if (text === null) return null;
    try {
      const data: unknown = JSON.parse(text);
      return isPlainObject(data) ? { at: s.at, reason: s.reason, data: data as Record<string, string> } : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(s.data) ? { at: s.at, reason: s.reason, data: s.data } : null;
}

export async function clearSafetySnapshot(): Promise<void> {
  await idbDel(SAFETY_KEY);
}

const AUDIT_KEY = DB_PREFIX + AUDIT_TABLE;

/** Chain head + row count of a stored / backed-up audit log (raw JSON). */
function logInfo(raw: string | null | undefined): { head: string | null; rows: number } {
  try {
    const rows = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
    if (!Array.isArray(rows) || !rows.length) return { head: null, rows: 0 };
    return { head: rows[rows.length - 1]?.hash ?? null, rows: rows.length };
  } catch {
    return { head: null, rows: 0 };
  }
}

/**
 * Writes validated backup keys into storage. Throws StorageWriteError if the quota is hit.
 *
 * Audit log: a backup that carries one brings its own chain (which still verifies on its own); a
 * `restore` marker is then appended to it, linked to the backup's head, recording that head and the
 * head + size of the log it replaced. A backup without a log leaves this device's log in place and
 * the marker continues it. `replaced` is passed by `restoreBackup`, which wipes before writing.
 */
export function applyBackup(data: Record<string, string>, replaced?: { head: string | null; rows: number }): void {
  requireAccess('data.restore');
  const prior = replaced ?? (AUDIT_KEY in data ? logInfo(readRaw(AUDIT_KEY)) : undefined);
  // All-or-nothing: if the browser refuses a write half-way (quota), put back what was
  // there before so a failed restore can never leave a mix of old and new tables.
  const written: Array<[string, string | null]> = [];
  try {
    for (const [key, value] of Object.entries(data)) {
      const before = readRaw(key);
      writeRaw(key, value);
      written.push([key, before]);
    }
  } catch (err) {
    for (const [key, before] of written.reverse()) {
      try {
        if (before === null) removeRaw(key);
        else writeRaw(key, before);
      } catch {
        /* best effort: the original error is what the user needs to see */
      }
    }
    throw err;
  }
  // Restoring replaces whatever was there; that is allowed even over a locked period, but never silent.
  const restored = logInfo(data[AUDIT_KEY]);
  audit.record({
    entity: 'system',
    entity_id: 'backup',
    action: 'restore',
    summary: `Data restored from a backup (${Object.keys(data).length} data keys)`,
    seal: {
      restored_head: restored.head,
      restored_rows: restored.rows,
      ...(prior ? { replaced_head: prior.head, replaced_rows: prior.rows } : {}),
    },
  });
}

/**
 * A true restore: the device ends up with exactly the backup's tables (anything
 * the file does not contain is removed), all-or-nothing. If any write fails the
 * previous contents come back untouched. Device-local keys (PIN, lockout) are
 * never touched. Prefer this over `applyBackup` when "replace my data" is meant.
 */
export function restoreBackup(data: Record<string, string>): void {
  // Local roles (6.21): restoring replaces everything, so it is owner-only — checked before anything is touched.
  requireAccess('data.restore');
  const snapshot = collectAppData();
  for (const key of LOCAL_ONLY) delete snapshot[key];
  try {
    wipeTables();
    applyBackup(data, logInfo(snapshot[AUDIT_KEY]));
  } catch (err) {
    wipeTables();
    for (const [key, value] of Object.entries(snapshot)) {
      try {
        writeRaw(key, value);
      } catch {
        /* best effort — the original error below is what the user needs */
      }
    }
    throw err;
  }
}

function wipeTables(): void {
  for (const key of Object.keys(collectAppData())) {
    if (!LOCAL_ONLY.has(key)) removeRaw(key);
  }
}

/** Removes every app-owned key except this device's PIN / lock settings. Owner only (6.21). */
export function wipeAppData(): void {
  requireAccess('data.erase');
  wipeTables();
}
