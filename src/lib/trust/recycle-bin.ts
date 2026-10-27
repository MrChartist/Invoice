/**
 * R4-C4 recycle bin ("Recently deleted"): whole deleted rows of every edit-logged table (captured by the audit edit
 * observer, `binRows` in `audit-edits.ts`) and of invoices (`localDb.invoices.remove`), kept for 30 days (setting
 * 7–90) under a 5 MB cap; restored in one tap through the table's own save path, so the period lock, roles and
 * numbering run again.
 *
 *  - A deleted number stays used: the capture records the series high-water mark, so the bin never has to compete
 *    with a new document for its number; a restore is still refused if a live row holds the same id or number.
 *  - A child whose parent is gone (a receipt whose invoice was deleted) is restored together with the parent.
 *  - QA6-1 F1: rows another module owns ask that module first (`RESTORE_HOOKS`, per table): a gift-voucher receipt is
 *    re-checked against the voucher's balance, a module journal (settlement, RA deduction, breakage, Rule 42, deposit…)
 *    comes back only while its module still counts it as posted, and paired rows (an RA deduction receipt and its
 *    journal) come back together or not at all. Anything else is refused with where to redo it.
 *  - QA6-1 F17: someone else's delete needs the owner's `data.erase`; a document needs the right that deleted it.
 *  - Restores, permanent deletes and purges are audited. Entries in a locked period need the PIN to be deleted.
 *  - Table `recycle_bin`: backed up, never synced (a delete already syncs as a tombstone and a restore as a new
 *    version), excluded from every report, GST and export path. Payroll rows are listed only with `payroll.view`.
 */
import type { BinEntry } from '../../types/trade-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import { BIN_TABLE, WATCHED_TABLES, refOf } from '../audit-edits';
import { audit } from '../audit';
import { asSystem, can, currentActor, requireAccess, requireTableWrite } from '../access';
import { assertUnlocked, getLockUntil, isDateLocked } from '../period-lock';
import { DB_PREFIX, getJson, getTable, peekTable, setJson, setTable } from '../storage';
import { releaseAttachments } from '../attachments';
import { parseSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { round2 } from '../invoice-calc';
import { isIssued, localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import { BIN_RETENTION } from '../trade/trade-rules';
import { PAYROLL_TABLES } from './payroll-tables';
import { liveRedeemIssue } from '../retail/gift-voucher-core';
import '../trade/tr-registry'; // R8-C: Round 8 tables' rights and audit labels (lazy registration)
import '../hotel/hotel-registry'; // R7: hotel tables' rights and audit labels (lazy registration)
import '../retail/rt-registry'; // R9: retail tables' rights and audit labels (lazy registration)
import '../construction/cn-registry'; // R11: construction tables' rights and audit labels (lazy registration)
import '../services/sv-registry'; // R10: service tables' rights and audit labels (lazy registration)
import '../agri/ag-registry'; // R12: agri tables' rights and audit labels (lazy registration)
import { syncUrdPaid, urdLeft } from '../retail/rt-doc-hooks'; // QA10 R7: URD vouchers settled by exchange

export { BIN_TABLE };
export const BIN_SETTINGS_KEY = `${DB_PREFIX}bin_settings`;

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/* ── Display ─────────────────────────────────────────────────── */

const DAY_FIELDS = ['issue_date', 'date', 'bill_date', 'voucher_date'];
const NUMBER_FIELDS = ['invoice_number', 'number', 'voucher_number', 'bill_number', 'receipt_number', 'irm_no'];

export function tableLabel(table: string): string {
  if (table === 'invoices') return 'Document';
  return WATCHED_TABLES[table]?.label ?? table.replace(/_/g, ' ');
}

/** Label, number and document day of an entry (stored values win; derived from the row otherwise). */
export function describeEntry(e: BinEntry): { label: string; number: string; day: string; name: string } {
  const r = isObj(e.row) ? e.row : {};
  const number = e.number ?? NUMBER_FIELDS.map((k) => str(r[k])).find(Boolean) ?? '';
  const day = e.period_day ?? DAY_FIELDS.map((k) => str(r[k]).slice(0, 10)).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? '';
  const client = isObj(r.client) ? str(r.client.name) : '';
  const name = client || str(r.vendor_name) || str(r.name) || str(r.party_name) || refOf(r);
  const docLabel = e.table === 'invoices' && str(r.doc_type) ? str(r.doc_type).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '';
  return { label: e.label ?? (docLabel || tableLabel(e.table)), number, day, name };
}

/* ── Who sees what ───────────────────────────────────────────── */

const PAYROLL_ENTITIES = new Set(['payroll', 'employee']);
export const isPayrollTable = (table: string) => PAYROLL_TABLES.has(table) || PAYROLL_ENTITIES.has(WATCHED_TABLES[table]?.entity ?? '');

/** Owner: every entry; others: their own deletes. Payroll rows only with `payroll.view`. */
export function visibleEntries(entries: readonly BinEntry[], viewer: { all: boolean; name?: string; payroll: boolean }): BinEntry[] {
  return entries.filter((e) => e && (viewer.payroll || !isPayrollTable(e.table)) && (viewer.all || (!!viewer.name && e.deleted_by === viewer.name) || (!viewer.name && !e.deleted_by)));
}

export function currentViewer() {
  const actor = currentActor();
  return { all: can('data.erase'), name: actor?.name, payroll: can('payroll.view') };
}

/* ── Retention ───────────────────────────────────────────────── */

export function binRetentionDays(): number {
  const d = Math.round(Number(getJson<{ days?: number }>(BIN_SETTINGS_KEY, {}).days));
  return Number.isFinite(d) && d >= BIN_RETENTION.min && d <= BIN_RETENTION.max ? d : BIN_RETENTION.days;
}
export function setBinRetentionDays(days: number): void {
  requireAccess('settings.manage');
  const d = Math.round(days);
  if (!(d >= BIN_RETENTION.min && d <= BIN_RETENTION.max)) throw new Error('binDaysRange');
  setJson(BIN_SETTINGS_KEY, { days: d });
}

/** Entries to keep / purge: older than `days`, then the oldest until the bin fits `maxBytes`. Pure. */
export function planPurge(entries: readonly BinEntry[], now: Date, days: number, maxBytes: number = BIN_RETENTION.maxBytes): { keep: BinEntry[]; purged: BinEntry[] } {
  const cutoff = now.getTime() - days * 86400000;
  const sorted = [...entries].sort((a, b) => a.deleted_at.localeCompare(b.deleted_at));
  const purged: BinEntry[] = [];
  let keep = sorted.filter((e) => {
    const t = Date.parse(e.deleted_at);
    if (Number.isFinite(t) && t < cutoff) {
      purged.push(e);
      return false;
    }
    return true;
  });
  let size = keep.reduce((s, e) => s + JSON.stringify(e).length, 2);
  while (size > maxBytes && keep.length) {
    const drop = keep[0];
    keep = keep.slice(1);
    size -= JSON.stringify(drop).length + 1;
    purged.push(drop);
  }
  return { keep, purged };
}

const attIds = (list: readonly BinEntry[]) => list.flatMap((e) => (Array.isArray(e.attachments) ? (e.attachments as { id?: string }[]).map((a) => str(a?.id)).filter(Boolean) : []));

/** Start-up purge (lazily after first paint): expired / over-cap entries go, with one audit row. */
export function purgeBin(now: Date = new Date()): number {
  const entries = peekTable<BinEntry>(BIN_TABLE);
  if (!entries.length) return 0;
  const { keep, purged } = planPurge(entries, now, binRetentionDays());
  if (!purged.length) return 0;
  asSystem(() => setTable(BIN_TABLE, keep));
  releaseAttachments(attIds(purged));
  audit.record({
    entity: 'system', entity_id: BIN_TABLE, action: 'delete', by: 'system',
    summary: `Recycle bin: ${purged.length} entr${purged.length === 1 ? 'y' : 'ies'} older than ${binRetentionDays()} days (or over the 5 MB cap) removed for good`,
    changes: [{ field: 'Removed', from: null, to: purged.slice(0, 10).map((e) => `${tableLabel(e.table)} ${describeEntry(e).number || e.row_id}`).join(', ') }],
  });
  return purged.length;
}

/* ── Restore planning (pure) ─────────────────────────────────── */

/** Child tables whose rows hang off a parent row (restored together when the parent is gone). */
export const PARENTS: Readonly<Record<string, { table: string; field: string }>> = {
  transactions: { table: 'invoices', field: 'invoice_id' },
  purchase_payments: { table: 'purchases', field: 'purchase_id' },
};

export type RestoreRefusal = 'exists' | 'numberReused' | 'parentMissing' | 'module' | 'locked';
export interface RestorePlan {
  ok: boolean;
  refusal?: RestoreRefusal;
  /** Why the owning module refuses (`module`). */
  message?: string;
  /** Bin entries that must come back in the same step (an RA deduction receipt and its journal). */
  companions?: BinEntry[];
  /** The live row holding the number (numberReused). */
  number?: string;
  /** Parent bin entry to restore first (parentMissing with a parent in the bin). */
  parentEntry?: BinEntry;
  /** Child entries deleted together with this one (offered as "restore with its N payments"). */
  children: BinEntry[];
  day: string;
}

/** Live rows of a table (read-only), for the planner. */
export type LiveReader = (table: string) => readonly Row[];

const numberOf = (table: string, r: Row): string => {
  const v = table === 'invoices' ? str(r.invoice_number) : str(r.number);
  return table === 'invoices' || parseSeries(v) ? v : '';
};

/* ── Module restore hooks (QA6-1 F1) ─────────────────────────── */

export interface RestoreHookResult {
  /** The module refuses: why, and where to redo the action. */
  refuse?: string;
  /** Bin entries that must come back in the same step. */
  companions?: BinEntry[];
}
/**
 * A module's say on restoring one of its rows. Run when the restore is planned (the panel shows a refusal before the
 * click) and again inside the restore, right before the row is written (so the earlier rows of the same restore count).
 */
export type RestoreHook = (row: Row, e: BinEntry, live: LiveReader, bin: readonly BinEntry[]) => RestoreHookResult | null;

/** Per-table hooks (table → hooks). A module registers its own with `registerRestoreHook`; the built-in ones follow. */
export const RESTORE_HOOKS = new Map<string, RestoreHook[]>();
export function registerRestoreHook(table: string, hook: RestoreHook): void {
  RESTORE_HOOKS.set(table, [...(RESTORE_HOOKS.get(table) ?? []), hook]);
}

/** True when any string value anywhere in `rows` equals `id` (a module row still naming a voucher / receipt). */
function mentions(rows: readonly unknown[], id: string): boolean {
  const seen = (v: unknown, depth: number): boolean => {
    if (v === id) return true;
    if (!v || typeof v !== 'object' || depth > 6) return false;
    return (Array.isArray(v) ? v : Object.values(v)).some((x) => seen(x, depth + 1));
  };
  return !!id && rows.some((r) => seen(r, 0));
}

/** Manual-voucher classes a module posts and undoes itself: the tables that name a posted voucher, and where to redo it. */
const OWNED_VOUCHERS: readonly { classes: readonly string[]; tables: readonly string[]; redo: string }[] = [
  { classes: ['Marketplace settlement'], tables: ['settlements'], redo: 'post the settlement again in Receivables → Marketplace → Settlements' },
  { classes: ['Gift voucher sale', 'Gift voucher refund'], tables: ['gift_vouchers'], redo: 'sell or cancel the voucher again in Receivables → Gift vouchers' },
  { classes: ['Gift voucher breakage'], tables: ['gift_vouchers'], redo: 'recognise the breakage again in Receivables → Gift vouchers' },
  { classes: ['ITC reversal — Rule 42 / 43'], tables: ['common_credit_runs'], redo: 'post the Rule 42 / 43 reversal again in GST → Common credit' },
  { classes: ['Security deposit'], tables: ['security_deposits'], redo: 'record it again in Recurring → Leases → Deposits' },
  { classes: ['Donation'], tables: ['donations'], redo: 'record the donation again' },
  { classes: ['Trip advance'], tables: ['trips'], redo: 'record it again on the trip' },
  { classes: ['Forex bank'], tables: ['fx_bank_moves'], redo: 'record the forex movement again' },
  { classes: ['Loan', 'Loan EMI'], tables: ['business_loans'], redo: 'post it again from the loan' },
  { classes: ['Deferral'], tables: ['deferrals'], redo: 'post it again from the deferral schedule' },
  { classes: ['GST set-off', 'GST payment (PMT-06)'], tables: ['gst_setoffs', 'gst_challans'], redo: 'post it again in GST → Set-off' },
  { classes: ['GST refund (RFD)'], tables: ['gst_refunds', 'gst_pmt09'], redo: 'record it again on the refund' },
  { classes: ['Export incentive'], tables: ['export_incentives'], redo: 'post it again on the export incentive' },
  { classes: ['Sales commission'], tables: ['commission_postings'], redo: 'post the commission again' },
  { classes: ['GST TCS credit', 'GST TDS credit'], tables: ['eco_credits'], redo: 'accept the credit again' },
  { classes: ['Customs duty (BOE)'], tables: ['purchases'], redo: 'post the duty again from the bill of entry' },
  // R11 (CN-D): a sub-contractor bill's deductions journal and a muster week's wage payment
  { classes: ['Sub-contractor deductions'], tables: ['sub_measurements'], redo: 'measure the sub-contractor bill again in Time → Works → Sub-contracts' },
  { classes: ['Site wages'], tables: ['muster_days'], redo: 'settle the week again in Time → Works → Labour' },
  // R8-C: agency desk (TR-C1)
  { classes: ['Arrival advance'], tables: ['arrivals'], redo: 'cancel the arrival and enter it again in Distribution → Agency' },
  { classes: ['Bikri patti'], tables: ['sale_pattis'], redo: 'post the patti again in Distribution → Agency → Bikri patti' },
  // QA8 T2: R8-A / R8-B journals undone by their own module
  { classes: ['Brokerage'], tables: ['brokerage_postings'], redo: 'restore the brokerage posting itself, or post it again in Distribution → Brokers' },
  { classes: ['Trade claim'], tables: ['trade_claims'], redo: 'settle the claim again in Distribution → Claims' },
  { classes: ['Packaging deposit'], tables: ['packaging_moves'], redo: 'restore the packaging movement itself, or record it again in Distribution → Packaging' },
  // R9 (RT-D2): a financier's disbursement is undone on its DO
  { classes: ['Finance disbursement'], tables: ['finance_deals'], redo: 'record the disbursement again in Inventory → Devices → Finance' },
  // R11 (CN-B2): a secured advance's receipt journal is undone with its row
  { classes: ['Secured advance'], tables: ['secured_advances'], redo: 'record the secured advance again in Time → Works → Advances' },
  // QA10 R17: a rider settlement's journal comes back only with its settlement row
  { classes: ['Rider settlement'], tables: ['rider_settlements'], redo: 'restore the rider settlement itself, or settle the rider again in Inventory → Deliveries' },
];
const RA_CLASS = 'RA deduction';
/** Journals paired one-to-one with a no-cash receipt row through `ra_journal_id` (R9 RT-D2: the finance transfer). */
const PAIRED_CLASSES = new Set([RA_CLASS, 'Finance transfer']);
const SETTLEMENT_METHOD = 'Marketplace settlement'; // as settlement-post.ts records it (not imported: keeps this chunk small)

const inBin = (bin: readonly BinEntry[], table: string, pick: (r: Row) => boolean) => [...bin].reverse().find((b) => b.table === table && isObj(b.row) && pick(b.row));
const isLive = (live: LiveReader, table: string, id: string) => !!id && live(table).some((x) => str(x?.id) === id);
const what = (e: BinEntry) => `${describeEntry(e).label} ${describeEntry(e).number}`.trim();

registerRestoreHook('vouchers', (row, e, live, bin) => {
  const cls = str(row.voucher_class);
  if (PAIRED_CLASSES.has(cls)) {
    // A deduction (or finance transfer) journal and its receipt row are one entry: both or neither.
    if (live('transactions').some((p) => str(p?.ra_journal_id) === e.row_id)) return null;
    const pair = inBin(bin, 'transactions', (r) => str(r.ra_journal_id) === e.row_id);
    return pair ? { companions: [pair] } : { refuse: `${what(e)} is the journal of a ${cls === RA_CLASS ? 'GST TDS / labour cess deduction' : 'finance transfer'} whose receipt is gone for good. Record it again from the bill.` };
  }
  const owner = OWNED_VOUCHERS.find((o) => o.classes.includes(cls));
  if (!owner) return null;
  // Restoring repairs a stray delete only while the module still counts the voucher as posted.
  if (!owner.tables.some((t) => mentions(live(t), e.row_id))) return { refuse: `${what(e)} (${cls}) was undone where it was posted, so restoring it here would post it twice. Instead, ${owner.redo}.` };
  // Its bill-wise receipt rows (a deposit adjustment) come back with it.
  const rows = bin.filter((b) => b.table === 'transactions' && isObj(b.row) && str(b.row.voucher_id) === e.row_id);
  return rows.length ? { companions: rows } : null;
});

registerRestoreHook('transactions', (row, e, live, bin) => {
  const journal = str(row.ra_journal_id);
  if (journal && !isLive(live, 'vouchers', journal)) {
    const pair = inBin(bin, 'vouchers', (r) => str(r.id) === journal);
    return pair ? { companions: [pair] } : { refuse: 'This GST TDS / labour cess receipt has lost its journal for good. Record the deduction again from the RA bill.' };
  }
  const voucher = str(row.voucher_id);
  if (row.deposit_adjustment_id && !isLive(live, 'vouchers', voucher)) {
    const pair = voucher ? inBin(bin, 'vouchers', (r) => str(r.id) === voucher) : undefined;
    return pair ? { companions: [pair] } : { refuse: 'This receipt was settled from a security deposit whose journal is gone. Adjust the deposit again in Recurring → Leases → Deposits.' };
  }
  if (str(row.method) === SETTLEMENT_METHOD && !mentions(live('settlements'), e.row_id)) {
    return { refuse: 'This receipt was posted from a marketplace settlement that has since been unposted. Post the settlement again in Receivables → Marketplace → Settlements.' };
  }
  // R9 (RT-D3 / E3): an exchange receipt comes back only with its buy-back voucher.
  const urd = str(row.exchange_purchase_id);
  if (urd && !isLive(live, 'purchases', urd)) {
    const pair = inBin(bin, 'purchases', (r) => str(r.id) === urd);
    return pair ? { companions: [pair] } : { refuse: 'The buy-back voucher this exchange settled is gone for good. Record the buy-back and the exchange again.' };
  }
  // QA10 R7: only while the voucher still has that much left (it may have been paid in cash or used again since).
  const urdRow = urd ? live('purchases').find((x) => str(x?.id) === urd) : undefined;
  if (urdRow && urdLeft(urdRow as unknown as PurchaseRecord, live('transactions') as unknown as Payment[]) < (Number(row.amount) || 0) - 0.004) {
    return { refuse: `Buy-back voucher ${str(urdRow.bill_number)} was paid or used in another exchange since this receipt was deleted. Restore the bill on its own and take the payment again.` };
  }
  const gv = str(row.gift_voucher_id);
  if (gv) {
    const issue = liveRedeemIssue(gv, Number(row.amount) || 0, str(row.date).slice(0, 10));
    if (issue) return { refuse: `${issue} The gift voucher was used since this receipt was deleted: restore the bill on its own and take the payment again.` };
  }
  return null;
});

/* QA8 T2: Round 8 rows that carry their own journal come back with it, never next to a re-post. */
const companionOr = (live: LiveReader, bin: readonly BinEntry[], table: string, id: string, refuse: string): RestoreHookResult | null => {
  if (!id || isLive(live, table, id)) return null;
  const pair = inBin(bin, table, (r) => str(r.id) === id);
  return pair ? { companions: [pair] } : { refuse };
};
registerRestoreHook('brokerage_postings', (row, _e, live, bin) => {
  const from = str(row.from);
  const to = str(row.to);
  const clash = live('brokerage_postings').find((p) => str(p?.broker_id) === str(row.broker_id) && str(p?.from) <= to && str(p?.to) >= from);
  if (clash) return { refuse: `Brokerage for ${str(row.broker_name)} is already posted again for part of ${from} to ${to}, so restoring this posting would post it twice.` };
  const v = companionOr(live, bin, 'vouchers', str(row.voucher_id), 'The journal of this brokerage posting is gone for good. Post the brokerage again in Distribution → Brokers.');
  if (v?.refuse) return v;
  const t = companionOr(live, bin, 'tds_deductions', str(row.tds_row_id), 'The 194H TDS row of this brokerage posting is gone for good. Post the brokerage again in Distribution → Brokers.');
  if (t?.refuse) return t;
  return { companions: [...(v?.companions ?? []), ...(t?.companions ?? [])] };
});
registerRestoreHook('tds_deductions', (_row, e, live, bin) => {
  // A 194H row of an undone brokerage posting comes back only with that posting.
  const owner = inBin(bin, 'brokerage_postings', (r) => str(r.tds_row_id) === e.row_id);
  return owner && !mentions(live('brokerage_postings'), e.row_id) ? { refuse: 'This 194H TDS row belongs to an undone brokerage posting: restore the posting itself, or post the brokerage again in Distribution → Brokers.' } : null;
});
registerRestoreHook('packaging_moves', (row, _e, live, bin) => {
  const inv = str(row.charge_invoice_id);
  if (inv && !live('invoices').some((x) => str(x?.id) === inv && str(x?.status) !== 'Cancelled')) return { refuse: 'This movement closed crates billed on an invoice that is gone or cancelled. Charge the crates again in Distribution → Packaging.' };
  return companionOr(live, bin, 'vouchers', str(row.voucher_id), 'The deposit voucher of this movement is gone for good. Record the movement again in Distribution → Packaging.');
});
registerRestoreHook('finance_deals', (row, _e, live, bin) => {
  // R9 (RT-D2): a DO comes back with its transfer row and journal (both or neither), never next to a re-made deal.
  if (live('finance_deals').some((d) => str(d?.invoice_id) === str(row.invoice_id) && str(d?.do_no) === str(row.do_no))) return { refuse: 'This DO was recorded again since; restoring it would post the finance part twice.' };
  const v = companionOr(live, bin, 'vouchers', str(row.transfer_voucher_id), 'The finance transfer journal of this DO is gone for good. Record the finance sale again in Inventory → Devices → Finance.');
  if (v?.refuse) return v;
  const t = companionOr(live, bin, 'transactions', str(row.transfer_payment_id), 'The finance part receipt of this DO is gone for good. Record the finance sale again in Inventory → Devices → Finance.');
  if (t?.refuse) return t;
  return { companions: [...(v?.companions ?? []), ...(t?.companions ?? [])] };
});
// R9 (RT-E1 / E4): a jewellery tag or a karigar entry comes back with the stock moves its delete removed.
const withMoves = (ids: unknown, live: LiveReader, bin: readonly BinEntry[]): RestoreHookResult | null => {
  const rows = (Array.isArray(ids) ? ids : [ids]).map(str).filter((id) => id && !isLive(live, 'stock_moves', id)).map((id) => inBin(bin, 'stock_moves', (r) => str(r.id) === id)).filter((b): b is BinEntry => !!b);
  return rows.length ? { companions: rows } : null;
};
registerRestoreHook('jewel_tags', (row, e, live, bin) => (live('jewel_tags').some((t) => str(t?.tag).toUpperCase() === str(row.tag).toUpperCase() && str(t?.id) !== e.row_id) ? { refuse: `Tag ${str(row.tag)} was used again since. Add the piece again in Inventory → Jewellery → Tags.` } : withMoves(row.move_id, live, bin)));
registerRestoreHook('karigar_moves', (row, _e, live, bin) => withMoves(row.move_ids, live, bin));
// R11 (CN-B): a secured advance comes back with its receipt journal; a PV statement only while no live one covers its period.
registerRestoreHook('secured_advances', (row, _e, live, bin) => companionOr(live, bin, 'vouchers', str(row.voucher_id), 'The receipt journal of this secured advance is gone for good. Record it again in Time → Works → Advances.'));
registerRestoreHook('price_variations', (row, e, live) => (str(row.status) !== 'cancelled' && live('price_variations').some((p) => str(p?.id) !== e.row_id && str(p?.contract_id) === str(row.contract_id) && str(p?.status) !== 'cancelled' && str(p?.period_from) <= str(row.period_to) && str(p?.period_to) >= str(row.period_from)) ? { refuse: 'A price variation statement for this period was made again since; restoring this one would bill it twice.' } : null));
// R11 (CN-C): a deleted booking freed its unit (book it again; the BKG number stays used); a unit needs its project;
// a stage certificate does not come back next to a re-made one of the same tower and stage.
registerRestoreHook('realty_bookings', () => ({ refuse: 'Deleting the booking freed its unit. Book the unit again in Receivables → Realty → Bookings.' }));
// R12 (AG-B): a dispatch comes back only with its stock journal (journals are not binned: enter it again); a milk card
// not next to a re-made card of the same customer and month.
registerRestoreHook('milk_dispatches', (row, _e, live, bin) => companionOr(live, bin, 'stock_journals', str(row.sj_id), 'The stock journal of this dispatch is gone for good. Enter the dispatch again in Inventory → Dairy → Dispatch.'));
registerRestoreHook('milk_cards', (row, e, live) => (live('milk_cards').some((c) => str(c?.id) !== e.row_id && str(c?.client_id) === str(row.client_id) && str(c?.month) === str(row.month)) ? { refuse: 'This customer has a card for the month again; restoring this one would bill the month twice.' } : null));
registerRestoreHook('realty_units', (row, _e, live) => (isLive(live, 'realty_projects', str(row.project_id)) ? null : { refuse: 'The project of this unit is gone. Restore the project first.' }));
// R11 (CN-D): a sub-contractor bill made from a measurement comes back only while that measurement still names it
// (cancelling it removed the bill and its deductions journal — measure again).
registerRestoreHook('purchases', (row, e, live) => (isObj(row.cn_sub) && str((row.cn_sub as Row).kind) === 'subcon' && !mentions(live('sub_measurements'), e.row_id) ? { refuse: 'This sub-contractor bill was cancelled from its measurement. Measure it again in Time → Works → Sub-contracts.' } : null));
registerRestoreHook('stage_certificates', (row, e, live) => (live('stage_certificates').some((c) => str(c?.id) !== e.row_id && str(c?.tower_id) === str(row.tower_id) && str(c?.stage_label).toLowerCase() === str(row.stage_label).toLowerCase()) ? { refuse: 'This stage was certified again since.' } : null));
// QA10 R9: a billed all-warranty repair job comes back with its warranty part issues.
registerRestoreHook('service_jobs', (row, _e, live, bin) => withMoves(row.warranty_move_ids, live, bin));
// QA10 R17: a rider settlement comes back with its journal, and only while its COD receipts are not settled again.
registerRestoreHook('rider_settlements', (row, _e, live, bin) => {
  const ids = new Set((Array.isArray(row.payment_ids) ? row.payment_ids : []).map(str));
  if (live('rider_settlements').some((s) => (Array.isArray(s?.payment_ids) ? s.payment_ids : []).some((id) => ids.has(str(id))))) return { refuse: 'These COD receipts were settled again since. Undo that settlement first, or leave this one in the bin.' };
  return companionOr(live, bin, 'vouchers', str(row.voucher_id), 'The journal of this rider settlement is gone for good. Settle the rider again in Inventory → Deliveries.');
});
// QA10 R8: a deleted finance sale comes back with the DO that went with it (and so its transfer row and journal).
registerRestoreHook('invoices', (_row, e, live, bin) => {
  const deals = bin.filter((b) => b.table === 'finance_deals' && isObj(b.row) && str(b.row.invoice_id) === e.row_id && !isLive(live, 'finance_deals', b.row_id));
  return deals.length ? { companions: deals } : null;
});
registerRestoreHook('invoices', (row, _e, live) => {
  // QA8 T5: an interest draft of an undone run stays gone (its bills were freed to be charged again).
  const run = str(row.interest_run_id);
  return run && live('interest_runs').some((r) => str(r?.id) === run && str(r?.status) === 'undone') ? { refuse: 'This interest invoice belongs to an interest run that was undone. Raise the interest again in Receivables → Interest.' } : null;
});
registerRestoreHook('invoices', (_row, e, live) => {
  // QA9 H11: a hotel check-out invoice comes back only while the folio lines it billed are still free (reopened).
  const lines = live('hotel_folios').flatMap((f) => (Array.isArray(f?.lines) ? f.lines : []) as Row[]);
  return lines.some((l) => isObj(l.src) && str(l.src.was_invoice_id) === e.row_id && str(l.src.invoice_id)) ? { refuse: 'The folio lines this invoice billed were billed again. Cancel that invoice first, or bill the stay again on the folio.' } : null;
});
registerRestoreHook('invoices', (row, e, live) => {
  // QA11 C10: a builder's stage demand never comes back next to a demand raised again for that booking and stage; an
  // RA bill never next to an RA bill of its BOQ made since the delete (its quantities were measured again) — and a
  // PV bill only while its statement still names it. Each would bill the same work twice.
  const cn = isObj(row.boq_terms) && isObj(row.boq_terms.cn) ? row.boq_terms.cn : undefined;
  const d = cn && isObj(cn.demand) ? cn.demand : undefined;
  const liveDocs = live('invoices').filter((x) => str(x?.id) !== e.row_id && str(x?.status) !== 'Cancelled' && str(x?.doc_type) !== 'CREDIT_NOTE');
  if (d && str(row.doc_type) !== 'CREDIT_NOTE') {
    const again = liveDocs.some((x) => {
      const o = isObj(x.boq_terms) && isObj(x.boq_terms.cn) && isObj(x.boq_terms.cn.demand) ? x.boq_terms.cn.demand : undefined;
      return !!o && str(o.booking_id) === str(d.booking_id) && (str(o.stage_id) === str(d.stage_id) || str(o.stage_label).toLowerCase() === str(d.stage_label).toLowerCase());
    });
    if (again) return { refuse: `This stage was demanded again for booking ${str(d.booking_no)}; restoring this demand would bill it twice.` };
  }
  if (Number(row.ra_no) > 0 && str(row.boq_id) && str(row.doc_type) !== 'CREDIT_NOTE' && liveDocs.some((x) => str(x?.boq_id) === str(row.boq_id) && Number(x?.ra_no) > 0 && (Number(x?.ra_no) === Number(row.ra_no) || str(x?.created_at) > e.deleted_at))) {
    return { refuse: 'RA bills of this BOQ were measured again since this one was deleted; restoring it would bill the same quantities twice. Measure the work again instead.' };
  }
  const pv = cn && isObj(cn.pv) ? str(cn.pv.statement_id) : '';
  if (pv && !live('price_variations').some((x) => str(x?.id) === pv && str(x?.status) === 'billed' && str(x?.invoice_id) === e.row_id)) return { refuse: 'Its price variation statement was cancelled or billed again since. Bill the statement again in Time → Works → Escalation.' };
  return null;
});
registerRestoreHook('purchase_returns', (row, e, live) => {
  // A supplier note that settled a trade claim comes back only while the claim still names it.
  const m = /^Against claim (\S+)$/.exec(str(row.notes).trim());
  if (!m) return null;
  const claim = live('trade_claims').find((c) => str(c?.number) === m[1]);
  if (!claim) return null;
  const set = isObj(claim.settlement) ? claim.settlement : {};
  return str(set.return_id) === e.row_id ? null : { refuse: `This supplier credit note settled claim ${m[1]}, which was unsettled since. Settle the claim again in Distribution → Claims.` };
});
// R10 (SV-C): one check-in row per day and one attendance row per class × day — a day recorded again since stays; a
// membership never comes back next to a live one naming its sale bill (sold again: the bill would count twice).
const svDup = (t: string, keys: string[]) => registerRestoreHook(t, (row, e, live) => (live(t).some((x) => str(x?.id) !== e.row_id && keys.every((k) => str(x?.[k]) === str(row[k]))) ? { refuse: 'This day was recorded again since. Leave this row in the bin.' } : null));
svDup('checkins', ['date']);
svDup('class_attendance', ['class_id', 'date']);
registerRestoreHook('memberships', (row, e, live) => {
  const ids = (Array.isArray(row.invoice_ids) ? row.invoice_ids : []).map(str);
  return live('memberships').some((m) => str(m?.id) !== e.row_id && (Array.isArray(m?.invoice_ids) ? m.invoice_ids : []).some((x) => ids.includes(str(x)))) ? { refuse: 'Its sale bill now belongs to another membership.' } : null;
});

/** The module hooks' verdict on one entry: the first refusal, else every companion. */
function moduleVerdict(e: BinEntry, live: LiveReader, bin: readonly BinEntry[]): RestoreHookResult {
  const r = isObj(e.row) ? e.row : {};
  const companions: BinEntry[] = [];
  for (const hook of RESTORE_HOOKS.get(e.table) ?? []) {
    const v = hook(r, e, live, bin);
    if (v?.refuse) return { refuse: v.refuse };
    for (const c of v?.companions ?? []) if (c.id !== e.id && !companions.some((x) => x.id === c.id)) companions.push(c);
  }
  return { companions };
}

export function planRestore(e: BinEntry, live: LiveReader, bin: readonly BinEntry[], lockUntil: string = getLockUntil()): RestorePlan {
  const r = isObj(e.row) ? e.row : {};
  const day = describeEntry(e).day;
  const rows = live(e.table);
  const children = Object.entries(PARENTS)
    .filter(([, p]) => p.table === e.table)
    .flatMap(([child, p]) => bin.filter((b) => b.table === child && isObj(b.row) && str(b.row[p.field]) === e.row_id));
  const base = { children, day };
  if (rows.some((x) => str(x?.id) === e.row_id)) return { ok: false, refusal: 'exists', ...base };
  const num = numberOf(e.table, r);
  if (num) {
    const k = num.trim().toUpperCase();
    if (rows.some((x) => numberOf(e.table, x).trim().toUpperCase() === k)) return { ok: false, refusal: 'numberReused', number: num, ...base };
  }
  const parent = PARENTS[e.table];
  if (parent) {
    const pid = str(r[parent.field]);
    if (pid && !live(parent.table).some((x) => str(x?.id) === pid)) {
      const parentEntry = [...bin].reverse().find((b) => b.table === parent.table && b.row_id === pid);
      return { ok: false, refusal: 'parentMissing', ...(parentEntry ? { parentEntry } : {}), ...base };
    }
  }
  const verdict = moduleVerdict(e, live, bin);
  if (verdict.refuse) return { ok: false, refusal: 'module', message: verdict.refuse, ...base };
  const withCompanions = verdict.companions?.length ? { ...base, companions: verdict.companions } : base;
  if (day && isDateLocked(day, lockUntil)) return { ok: false, refusal: 'locked', ...withCompanions };
  return { ok: true, ...withCompanions };
}

/* ── Restore (guards run in the table's own save path) ────────── */

export class RestoreError extends Error {
  refusal: RestoreRefusal | 'missing';
  plan?: RestorePlan;
  constructor(refusal: RestoreRefusal | 'missing', message: string, plan?: RestorePlan) {
    super(message);
    this.refusal = refusal;
    this.plan = plan;
  }
}

const liveReader: LiveReader = (t) => peekTable<Row>(t);

/** F17: restoring needs the rights of the delete — someone else's entry the owner's `data.erase`, a document its delete right. */
function assertMayRestore(e: BinEntry): void {
  if ((e.deleted_by ?? undefined) !== (currentActor()?.name ?? undefined)) requireAccess('data.erase');
  if (e.table === 'invoices' && isObj(e.row)) requireAccess(isIssued(e.row as unknown as InvoiceRecord) ? 'doc.deleteIssued' : 'doc.deleteDraft');
}

function putBack(e: BinEntry): void {
  // F1: the owning module checks again against live data (earlier rows of this restore included).
  const verdict = moduleVerdict(e, liveReader, peekTable<BinEntry>(BIN_TABLE));
  if (verdict.refuse) throw new RestoreError('module', verdict.refuse);
  const row = { ...(e.row as Row) };
  if (e.table === 'invoices') {
    // localDb's save runs roles, rights, the period lock, the number check and the audit row.
    saveInvoice(row as unknown as InvoiceRecord);
    return;
  }
  if (e.table === 'purchases') {
    savePurchase(row as unknown as PurchaseRecord);
    return;
  }
  requireTableWrite(e.table);
  const day = describeEntry(e).day;
  if (day) assertUnlocked({ id: e.row_id, issue_date: day, invoice_number: describeEntry(e).number || undefined }, 'create');
  if (e.table === 'transactions') {
    // Same rights as recording it; a bad-debt write-off row also needs doc.deleteIssued (as removing one does, QA5-1).
    requireAccess('payment.record');
    if (row.write_off) requireAccess('doc.deleteIssued');
    const inv = getTable<InvoiceRecord>('invoices').find((i) => i.id === str(row.invoice_id));
    if (inv) assertUnlocked(inv, 'pay');
    setTable('transactions', [...getTable<Payment>('transactions'), row as unknown as Payment]);
    // The invoice re-derives what it has received (the ledger rows are the floor).
    if (inv) saveInvoice(inv);
    // QA10 R7: the URD voucher an exchange receipt settles is settled again.
    if (row.exchange_purchase_id) syncUrdPaid([str(row.exchange_purchase_id)]);
    return;
  }
  setTable(e.table, [...getTable<Row>(e.table), row]);
  if (e.table === 'purchase_payments') {
    const bill = getTable<PurchaseRecord>('purchases').find((b) => b.id === str(row.purchase_id));
    if (bill) {
      const paid = round2(getTable<Row>('purchase_payments').filter((p) => p.purchase_id === bill.id).reduce((s, p) => s + Number(p.amount || 0) + Math.max(Number(p.tds_amount || 0), 0), 0));
      if (paid > Number(bill.amount_paid || 0) + 0.004) savePurchase({ ...bill, amount_paid: paid });
    }
  }
}

const saveInvoice = (inv: InvoiceRecord) => void localDb.invoices.save(inv);
const savePurchase = (bill: PurchaseRecord) => void purchasesDb.save(bill);

const REFUSAL_TEXT: Record<RestoreRefusal, (e: BinEntry, p: RestorePlan) => string> = {
  exists: (e) => `${tableLabel(e.table)} ${describeEntry(e).number || ''} is already back in the books.`.replace(/\s+/g, ' '),
  numberReused: (_e, p) => `${p.number} has been reused by another record, so this one cannot come back with it.`,
  parentMissing: (e, p) => (p.parentEntry ? `Restore ${describeEntry(p.parentEntry).number || tableLabel(p.parentEntry.table)} first — or restore both together.` : `The record ${tableLabel(e.table).toLowerCase()} belongs to is gone and not in the bin.`),
  module: (_e, p) => p.message ?? 'The module that owns this record refuses the restore.',
  locked: (_e, p) => `The books are locked up to ${getLockUntil()}; this record is dated ${p.day}. Unlock with the PIN to restore it.`,
};

/**
 * Restore bin entry `id` (with `withParent`, its deleted parent first; with `withChildren`, the rows deleted with
 * it). All or nothing; each restored entry leaves the bin and gets a `restore` audit row naming the bin id.
 * A locked period needs an active PIN override (`grantOverride`) — the save path's own lock check honours it.
 */
export function restoreEntry(id: string, opts: { withParent?: boolean; withChildren?: boolean } = {}): BinEntry[] {
  return restoreEntries([id], opts);
}

/**
 * Restore several bin entries in ONE all-or-nothing step (the Undo toasts: a bill with its payments, a receipt with
 * its journal). Companions the owning module asks for (an RA deduction receipt and its journal) come back with them.
 */
export function restoreEntries(ids: readonly string[], opts: { withParent?: boolean; withChildren?: boolean } = {}): BinEntry[] {
  const bin = peekTable<BinEntry>(BIN_TABLE);
  const order: BinEntry[] = [];
  const has = (x: BinEntry) => order.some((o) => o.id === x.id);
  const add = (x: BinEntry) => {
    if (has(x)) return;
    order.push(x);
    // A companion's own companions too (a deposit journal and its receipt rows).
    for (const c of moduleVerdict(x, liveReader, bin).companions ?? []) add(c);
  };
  for (const id of ids) {
    const e = bin.find((b) => b.id === id);
    if (!e) throw new RestoreError('missing', 'That entry is no longer in the bin.');
    if (has(e)) continue;
    const plan = planRestore(e, liveReader, bin);
    if (!plan.ok && plan.refusal !== 'locked') {
      const parent = plan.parentEntry;
      if (plan.refusal === 'parentMissing' && parent && (opts.withParent || ids.includes(parent.id) || has(parent))) add(parent);
      else throw new RestoreError(plan.refusal!, REFUSAL_TEXT[plan.refusal!](e, plan), plan);
    }
    add(e);
    if (opts.withChildren) for (const c of plan.children) add(c);
  }
  for (const x of order) assertMayRestore(x);
  const tables = [...new Set([BIN_TABLE, ...order.map((x) => x.table), 'invoices', 'transactions', 'purchases', 'purchase_payments', 'series_counters', 'vouchers'])];
  withTablesRollback(tables, () => {
    for (const x of order) putBack(x);
    const done = new Set(order.map((x) => x.id));
    setTable(BIN_TABLE, getTable<BinEntry>(BIN_TABLE).filter((b) => !done.has(b.id)));
  });
  for (const x of order) {
    const d = describeEntry(x);
    audit.record({
      entity: (WATCHED_TABLES[x.table]?.entity ?? 'invoice'),
      entity_id: x.row_id,
      action: 'restore',
      ...(d.number ? { doc_number: d.number } : {}),
      summary: `Restored ${d.label.toLowerCase()} ${d.number || d.name || ''} from the recycle bin (bin ${x.id})`.replace(/\s+/g, ' ').trim(),
    });
  }
  return order;
}

/** Entries in a locked period (deleting those for good needs the PIN). */
export const lockedEntries = (entries: readonly BinEntry[], lockUntil: string = getLockUntil()) => entries.filter((e) => {
  const d = describeEntry(e).day;
  return !!d && isDateLocked(d, lockUntil);
});

/** Delete entries for good (owner). `pinOk` must be true when any of them is in a locked period. Audited. */
export function deleteForGood(ids: readonly string[], opts: { pinOk?: boolean } = {}): number {
  requireAccess('data.erase');
  const want = new Set(ids);
  const all = peekTable<BinEntry>(BIN_TABLE);
  const gone = all.filter((e) => want.has(e.id));
  if (!gone.length) return 0;
  if (lockedEntries(gone).length && !opts.pinOk) throw new Error('binNeedsPin');
  setTable(BIN_TABLE, all.filter((e) => !want.has(e.id)));
  releaseAttachments(attIds(gone));
  audit.record({
    entity: 'system', entity_id: BIN_TABLE, action: 'delete',
    summary: `Deleted for good from the recycle bin: ${gone.length} entr${gone.length === 1 ? 'y' : 'ies'}`,
    changes: [{ field: 'Entries', from: null, to: gone.slice(0, 10).map((e) => `${tableLabel(e.table)} ${describeEntry(e).number || e.row_id} (bin ${e.id})`).join(', ') }],
  });
  return gone.length;
}
