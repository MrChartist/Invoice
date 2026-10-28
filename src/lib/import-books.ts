/**
 * Excel / CSV import of books data (P1-21, 7Q) through the existing import wizard: stock items (group, unit,
 * opening quantity / rate) and manual vouchers (journal / payment / receipt / contra). Ledgers, suppliers and
 * the trial-balance path are R6-C3's `import-openings.ts` (master's implementation, kept as is).
 *
 * Same shape as `importers.ts`: `buildBooksPreview` validates every row and decides create / update /
 * skip / error WITHOUT writing (the wizard's review step is the dry run); `applyBooksImport` writes the
 * create / update rows through the masters / ledger APIs — so roles, the period lock, validation and the
 * audit trail apply exactly as if typed. Vouchers import as MANUAL vouchers only (never invoices or
 * bills, so nothing reaches GSTR / e-invoice / the document numbering). The screen takes one undo copy
 * first (`saveSafetySnapshot('import')`, owner only).
 *
 * Untrusted input: cell text is trimmed and length-capped, names are compared as plain strings (no
 * object keys built from them), and the error CSV goes through the formula-guarded `toCsv`.
 */
import type { Client } from '../types/invoice';
import type { Vendor } from '../types/purchases';
import { round2 } from './invoice-calc';
import { isBooksKind, type BooksImportKind, type ColumnMapping, type ImportKind } from './import-mapping';
import {
  normalizeUnit,
  parseDate,
  parseNumber,
  type ApplyOptions,
  type ImportPreview,
  type ImportReport,
  type PreviewRow,
  type PreviewSummary,
  type RowIssue,
  type ImportTable,
} from './importers';
import { A, chartOf, loadUserAccounts, type Account } from './ledger/accounts';
import { clientPartyName } from './ledger/groups';
import { loadVouchers, saveVoucher, validateVoucher, type ManualVoucher, type ManualVoucherInput, type ManualVoucherLine, type ManualVoucherType } from './ledger/vouchers';
import { localDb } from './localDb';
import { vendorsDb } from './vendors';
import { stockDb, blankStockItem, type StockItem } from './inventory';
import { stockGroupsDb, type StockTreeNode } from './stock-groups';
import { loadCostCentres, saveCostCentre, type CostCentre } from './cost-centres';
import { getLockUntil, isDateLocked } from './period-lock';
import { requireAccess } from './access';
import { audit } from './audit';

/* ── Records ──────────────────────────────────────────────────── */

export type BooksImportRecord =
  | { kind: 'stock'; item: Omit<StockItem, 'id' | 'created_at'>; groupName?: string }
  | { kind: 'vouchers'; voucher: ManualVoucherInput; costCentres: string[] };

export interface BooksExisting {
  chart: Account[];
  clients: Client[];
  vendors: Vendor[];
  stockItems: StockItem[];
  stockGroups: StockTreeNode[];
  vouchers: ManualVoucher[];
  costCentres: CostCentre[];
  lockUntil: string;
}

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** What the books hold now (fail-soft), for duplicate detection and name resolution. */
export function loadBooksExisting(): BooksExisting {
  return {
    chart: safe(() => chartOf(loadUserAccounts()), chartOf()),
    clients: safe(() => localDb.clients.getAll(), []),
    vendors: safe(() => vendorsDb.all(), []),
    stockItems: safe(() => stockDb.items(), []),
    stockGroups: safe(() => stockGroupsDb.all(), []),
    vouchers: safe(loadVouchers, []),
    costCentres: safe(loadCostCentres, []),
    lockUntil: safe(getLockUntil, ''),
  };
}

/* ── Cell helpers ─────────────────────────────────────────────── */

const MAX_CELL = 500;
const cell = (mapping: ColumnMapping, row: string[], key: string): string => {
  const c = mapping[key];
  if (c === undefined || c < 0) return '';
  return String(row[c] ?? '').trim().slice(0, MAX_CELL);
};
const fold = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Rupees → integer paise (2 decimals, half away from zero). */
const paise = (n: number) => Math.round(round2(n) * 100);

/** A money cell: value in rupees, null when empty; `crSuffix` when the text ends in Cr. */
function money(text: string): { value: number | null; ok: boolean; cr: boolean; dr: boolean } {
  const p = parseNumber(text);
  return { value: p.value, ok: p.ok, cr: /\bcr\.?\s*$/i.test(text), dr: /\bdr\.?\s*$/i.test(text) };
}

/* ── Preview ──────────────────────────────────────────────────── */

export interface BooksPreviewParams {
  kind: BooksImportKind;
  table: ImportTable;
  mapping: ColumnMapping;
  existing: BooksExisting;
  options?: { duplicateMode?: 'update' | 'skip' };
  skipped?: ReadonlySet<number>;
  firstDataLine?: number;
}

function summarize(rows: PreviewRow[]): PreviewSummary {
  const s: PreviewSummary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0, warnings: 0 };
  for (const r of rows) {
    s[r.action]++;
    s.warnings += r.issues.filter((i) => i.level === 'warning').length;
  }
  return s;
}

const VOUCHER_TYPES: Readonly<Record<string, ManualVoucherType>> = {
  journal: 'JOURNAL', jv: 'JOURNAL', 'journal voucher': 'JOURNAL',
  payment: 'PAYMENT', pv: 'PAYMENT', 'payment voucher': 'PAYMENT',
  receipt: 'RECEIPT', rv: 'RECEIPT', 'receipt voucher': 'RECEIPT',
  contra: 'CONTRA', cv: 'CONTRA', 'contra voucher': 'CONTRA',
};

/** Validate every row and decide create / update / skip / error — writes nothing. */
export function buildBooksPreview(params: BooksPreviewParams): ImportPreview {
  const { kind, table, mapping, existing } = params;
  const line0 = params.firstDataLine ?? 2;
  const skipped = params.skipped ?? new Set<number>();
  const dupMode = params.options?.duplicateMode ?? 'update';
  const rows: PreviewRow[] = [];
  const isBlank = (r: string[]) => r.every((c) => String(c ?? '').trim() === '');
  const base = (i: number, issues: RowIssue[], label: string): PreviewRow => ({ index: i, sourceIndexes: [i], line: i + line0, label, action: 'create', issues, record: null });
  const finish = (row: PreviewRow) => {
    if (row.issues.some((x) => x.level === 'error')) row.action = 'error';
    if (skipped.has(row.index)) {
      row.action = 'skip';
      row.skipReason = 'Skipped by you';
    }
    rows.push(row);
  };

  if (kind === 'stock') {
    const seen = new Map<string, number>();
    table.rows.forEach((r, i) => {
      if (isBlank(r)) return;
      const issues: RowIssue[] = [];
      const name = cell(mapping, r, 'name');
      const row = base(i, issues, name);
      if (!name) issues.push({ level: 'error', field: 'name', message: 'Item name is required' });
      const num = (key: string, label: string, min = 0): number | undefined => {
        const t = cell(mapping, r, key);
        if (!t) return undefined;
        const p = parseNumber(t);
        if (!p.ok || p.value === null) {
          issues.push({ level: 'error', field: key, message: `${label} "${t}" is not a number` });
          return undefined;
        }
        if (p.value < min) {
          issues.push({ level: 'error', field: key, message: `${label} cannot be negative` });
          return undefined;
        }
        return p.value;
      };
      const qty = num('opening_qty', 'Opening quantity') ?? 0;
      let rate = num('opening_rate', 'Opening rate');
      const value = num('opening_value', 'Opening value');
      if (rate === undefined && value !== undefined && qty > 0) rate = round2(value / qty);
      const tax = num('tax_rate', 'GST %');
      const hsn = cell(mapping, r, 'hsn').replace(/\s+/g, '');
      if (hsn && !/^\d{4,8}$/.test(hsn)) issues.push({ level: 'warning', field: 'hsn', message: `HSN ${hsn} should be 4–8 digits` });
      const groupName = cell(mapping, r, 'group');
      if (name) {
        const draft = blankStockItem({
          name,
          unit: normalizeUnit(cell(mapping, r, 'unit')) || 'NOS',
          opening_qty: qty,
          opening_rate: rate ?? 0,
          reorder_level: num('reorder_level', 'Reorder level') ?? 0,
          ...(hsn ? { hsn } : {}),
          ...(tax !== undefined ? { tax_rate: tax } : {}),
          ...(num('sale_rate', 'Selling rate') !== undefined ? { sale_rate: num('sale_rate', 'Selling rate') } : {}),
          ...(cell(mapping, r, 'sku') ? { sku: cell(mapping, r, 'sku') } : {}),
        });
        const { id: _id, created_at: _c, ...item } = draft;
        row.record = { kind: 'stock', item, ...(groupName ? { groupName } : {}) };
        const match = existing.stockItems.find((s) => fold(s.name) === fold(name));
        const prior = seen.get(fold(name));
        if (prior !== undefined) {
          row.action = 'skip';
          row.skipReason = `Duplicate of row ${prior + line0} in this file`;
        } else if (match) {
          row.matchId = match.id;
          if (dupMode === 'update') row.action = 'update';
          else {
            row.action = 'skip';
            row.skipReason = 'Stock item already exists';
          }
        }
        seen.set(fold(name), i);
      }
      finish(row);
    });
  } else {
    // Vouchers: rows grouped by number + date + type; each group is one voucher.
    const groups = new Map<string, number[]>();
    const order: string[] = [];
    table.rows.forEach((r, i) => {
      if (isBlank(r)) return;
      const k = `${fold(cell(mapping, r, 'voucher_no'))}|${cell(mapping, r, 'date')}|${fold(cell(mapping, r, 'type'))}`;
      if (!groups.has(k)) {
        groups.set(k, []);
        order.push(k);
      }
      groups.get(k)!.push(i);
    });
    const taken = new Set(existing.vouchers.map((v) => fold(v.number)));
    const seenNo = new Set<string>();
    const chartByName = new Map<string, Account>();
    for (const a of existing.chart) {
      chartByName.set(fold(a.name), a);
      if (a.alias) chartByName.set(fold(a.alias), a);
    }
    for (const k of order) {
      const idx = groups.get(k)!;
      const first = table.rows[idx[0]];
      const issues: RowIssue[] = [];
      const number = cell(mapping, first, 'voucher_no');
      const dateText = cell(mapping, first, 'date');
      const typeText = cell(mapping, first, 'type');
      const row = base(idx[0], issues, `${typeText} ${number}`.trim());
      row.sourceIndexes = idx;
      const date = parseDate(dateText);
      if (!number) issues.push({ level: 'error', field: 'voucher_no', message: 'Voucher number is required (rows of one voucher share it)' });
      if (!date) issues.push({ level: 'error', field: 'date', message: dateText ? `Date "${dateText}" is not readable` : 'Date is required' });
      const type = Object.hasOwn(VOUCHER_TYPES, fold(typeText)) ? VOUCHER_TYPES[fold(typeText)] : undefined;
      if (!type) issues.push({ level: 'error', field: 'type', message: `Voucher type "${typeText}" — use Journal, Payment, Receipt or Contra (sales / purchase come in as documents, not vouchers)` });
      const lines: ManualVoucherLine[] = [];
      const centres: string[] = [];
      let narration = '';
      idx.forEach((ri, n) => {
        const r = table.rows[ri];
        const ledger = cell(mapping, r, 'ledger');
        const dr = money(cell(mapping, r, 'dr'));
        const cr = money(cell(mapping, r, 'cr'));
        if (!narration) narration = cell(mapping, r, 'narration');
        const at = `Line ${n + 1} (row ${ri + line0})`;
        if (!dr.ok || !cr.ok) return void issues.push({ level: 'error', message: `${at}: amount is not a number` });
        const d = paise(Math.abs(dr.value ?? 0));
        const c = paise(Math.abs(cr.value ?? 0));
        if (!ledger && !d && !c) return;
        if ((d > 0) === (c > 0)) return void issues.push({ level: 'error', message: `${at}: enter either a debit or a credit` });
        let account = chartByName.get(fold(ledger));
        let party: string | undefined;
        if (!account) {
          const client = existing.clients.find((x) => fold(clientPartyName(x)) === fold(ledger) || fold(x.name) === fold(ledger));
          const vendor = existing.vendors.find((x) => fold(x.name) === fold(ledger));
          if (client) {
            account = existing.chart.find((a) => a.id === A.debtors);
            party = clientPartyName(client);
          } else if (vendor) {
            account = existing.chart.find((a) => a.id === A.creditors);
            party = vendor.name;
          }
        }
        if (!account) return void issues.push({ level: 'error', field: 'ledger', message: `${at}: ledger "${ledger}" is not in the books — import ledgers first` });
        const cc = cell(mapping, r, 'cost_centre');
        const centre = cc ? existing.costCentres.find((x) => fold(x.name) === fold(cc)) : undefined;
        if (cc && !centre && !centres.some((x) => fold(x) === fold(cc))) centres.push(cc);
        lines.push({ account_id: account.id, dr: d, cr: c, ...(party ? { party } : {}), ...(centre ? { cost_centre_id: centre.id } : cc ? { cost_centre_id: `new:${cc}` } : {}) });
      });
      if (type && date) {
        const voucher: ManualVoucherInput = { type, date, number, narration: narration || `Imported ${typeText} ${number}`.trim(), lines, voucher_class: 'Excel import' };
        const errs = validateVoucher({ ...voucher, lines: lines.map((l) => ({ ...l, cost_centre_id: undefined })) }, existing.chart);
        for (const e of errs) issues.push({ level: 'error', message: e });
        if (isDateLocked(date, existing.lockUntil)) issues.push({ level: 'error', field: 'date', message: `Dated inside the locked period (books locked up to ${existing.lockUntil})` });
        row.record = { kind: 'vouchers', voucher, costCentres: centres };
        row.label = `${typeText} ${number} · ${date}`;
        if (number && (taken.has(fold(number)) || seenNo.has(fold(number)))) {
          row.action = 'skip';
          row.skipReason = taken.has(fold(number)) ? 'Voucher number already in the books — never overwritten' : 'Voucher number used twice in this file';
        }
        if (number) seenNo.add(fold(number));
      }
      finish(row);
    }
    rows.sort((a, b) => a.index - b.index);
  }
  return { kind, rows, summary: summarize(rows) };
}

/* ── Apply ────────────────────────────────────────────────────── */

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Write every create / update row through the masters / ledger APIs. Each row stands on its own: a
 * refusal (lock, validation, role) is reported and the rest is imported — the undo copy taken by the
 * screen puts everything back in one step. Owner only (`data.restore`), like the Tally import.
 */
export async function applyBooksImport(preview: ImportPreview, options: ApplyOptions = {}): Promise<ImportReport> {
  requireAccess('data.restore');
  if (!isBooksKind(preview.kind as ImportKind)) throw new Error('Not a books import.');
  const yieldToUi = options.yieldToUi ?? nextTask;
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  const writable: PreviewRow[] = [];
  for (const r of preview.rows) {
    if (r.action === 'create' || r.action === 'update') writable.push(r);
    else {
      report.skipped++;
      if (r.action === 'error') for (const i of r.issues) if (i.level === 'error') report.errors.push({ line: r.line, label: r.label, message: i.message });
    }
  }
  const stockGroupIds = new Map<string, string>(stockGroupsDb.all().map((g) => [fold(g.name), g.id]));
  const centreIds = new Map<string, string>(loadCostCentres().map((c) => [fold(c.name), c.id]));
  let done = 0;
  const fail = (r: PreviewRow, err: unknown) => {
    report.skipped++;
    report.errors.push({ line: r.line, label: r.label, message: (err as Error)?.message || String(err) });
  };
  for (const r of writable) {
    if (options.shouldCancel?.()) {
      report.skipped += writable.length - done;
      break;
    }
    const rec = r.record as BooksImportRecord;
    try {
      if (rec.kind === 'stock') {
        let group_id: string | undefined;
        if (rec.groupName) {
          group_id = stockGroupIds.get(fold(rec.groupName));
          if (!group_id) {
            group_id = stockGroupsDb.save({ name: rec.groupName }).id;
            stockGroupIds.set(fold(rec.groupName), group_id);
          }
        }
        const prev = r.matchId ? stockDb.items().find((s) => s.id === r.matchId) : undefined;
        const row: StockItem = prev
          ? { ...prev, ...rec.item, name: prev.name, id: prev.id, ...(group_id ? { group_id } : {}) }
          : { ...blankStockItem(rec.item), ...(group_id ? { group_id } : {}) };
        stockDb.saveItem(row);
      } else {
        const lines = rec.voucher.lines.map((l) => {
          if (!l.cost_centre_id?.startsWith('new:')) return l;
          const name = l.cost_centre_id.slice(4);
          let id = centreIds.get(fold(name));
          if (!id) {
            id = saveCostCentre({ name, kind: 'project', active: true }).id;
            centreIds.set(fold(name), id);
          }
          return { ...l, cost_centre_id: id };
        });
        saveVoucher({ ...rec.voucher, lines });
      }
      if (r.action === 'update') report.updated++;
      else report.created++;
    } catch (err) {
      fail(r, err);
    }
    done++;
    options.onProgress?.(done, writable.length);
    if (done % 100 === 0) await yieldToUi();
  }
  audit.record({
    entity: 'system', entity_id: 'excel_import', action: 'import',
    summary: `Excel import of ${preview.kind}: ${report.created} created, ${report.updated} updated, ${report.skipped} skipped`,
  });
  return report;
}
