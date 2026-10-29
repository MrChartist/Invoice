/**
 * R6-C3 (P1-21): import suppliers, ledgers (an opening trial balance) and bill-wise opening bills from CSV / XLSX,
 * through the same wizard as clients / items / invoices.
 *
 *  - `buildOpeningsPreview` — pure dry run: one `PreviewRow` per source row (create / update / skip / error), the
 *    opening-balance difference that will post to "Opening balance difference" (1090, as `saveOpenings` does), unknown
 *    groups mapped to the nearest Schedule III primary with a warning, and suppliers matched by GSTIN, then name
 *    (never duplicated). A party export with customers in it (Vyapar) sends those rows to Clients.
 *  - `applyOpeningsImport` — all or nothing: refused while any row has an error; every write goes through
 *    `vendorsDb.save` / `localDb.clients.upsert` / `saveUserAccount` / `saveOpenings` / `saveOpeningBillsFor`
 *    (role, period lock of the opening day, audit) inside one `withTablesRollback`, so a refusal half-way leaves
 *    nothing behind. The wizard takes one undo copy first (`saveSafetySnapshot('import')`, like the Tally import).
 *  - `recordImportRun` — one row per import run (any kind) in `import_runs`; the setup checklist reads it.
 *
 * Opening balances are working figures for the books — verify the opening trial balance with your CA.
 */
import type { Client } from '../types/invoice';
import type { Vendor } from '../types/purchases';
import { checkGstin } from './gstin';
import { resolveStateCode } from './india-states';
import { normalizeHeader, type ColumnMapping, type ImportKind } from './import-mapping';
import { parseDate, parseNumber, type ImportPreview, type ImportReport, type ImportTable, type PreviewRow, type RowIssue } from './importers';
import { round2 } from './invoice-calc';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';
import { getLockUntil, isDateLocked, prettyDay } from './period-lock';
import { vendorsDb } from './vendors';
import { localDb } from './localDb';
import { A, GROUPS, chartOf, loadUserAccounts, loadUserGroups, primaryOf, saveUserAccount, type Account, type PrimaryGroupId, type UserGroup } from './ledger/accounts';
import { loadBooksBegin, loadOpenings, openingDayFor, openingDifference, openingDifferenceText, saveOpenings, signedOpening, type LedgerOpening, type OpeningEntry } from './ledger/openings';
import { loadOpeningBills, saveOpeningBillsFor, type OpeningBill, type OpeningBillDraft, type OpeningBillSide } from './opening-bills';

export type OpeningsKind = 'vendors' | 'ledgers' | 'opening_bills';

/* ── Records (what a preview row will write) ─────────────────────── */

export interface PartyImportRecord {
  type: 'party';
  /** Vendors kind: 'vendor', or 'client' for a customer row of a mixed party export. */
  target: 'vendor' | 'client';
  name: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: string;
  state_code?: string;
  /** Opening balance, debit-positive PAISE (absent = none given). */
  opening?: number;
}

export interface LedgerImportRecord {
  type: 'ledger';
  name: string;
  /** An existing / new chart account, or a party ledger (Sundry debtors / creditors). */
  ledger: { kind: 'account'; id?: string; group: string; primary: PrimaryGroupId } | { kind: 'party'; side: 'debtor' | 'creditor'; partyId?: string; gstin?: string };
  /** Debit-positive PAISE. */
  amount: number;
}

export interface OpeningBillImportRecord {
  type: 'opening_bill';
  side: OpeningBillSide;
  partyId?: string;
  partyName: string;
  ref_no: string;
  date: string;
  due_date?: string;
  credit_days?: number;
  /** Rupees, > 0. */
  amount: number;
  dr_cr: 'Dr' | 'Cr';
}

export type OpeningsImportRecord = PartyImportRecord | LedgerImportRecord | OpeningBillImportRecord;

/* ── Context ─────────────────────────────────────────────────────── */

export interface OpeningsContext {
  vendors: readonly Vendor[];
  clients: readonly Client[];
  /** Default + user + synthesised accounts (`chartOf(loadUserAccounts())`). */
  chart: readonly Account[];
  userGroups: readonly UserGroup[];
  openings: readonly LedgerOpening[];
  openingBills: readonly OpeningBill[];
  booksBegin: string;
  /** Period-lock date ('' = none). */
  lockUntil: string;
  strictGstin?: boolean;
  duplicateMode?: 'update' | 'skip';
}

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function loadOpeningsContext(): OpeningsContext {
  return {
    vendors: vendorsDb.all(),
    clients: localDb.clients.getAll(),
    chart: chartOf(loadUserAccounts()),
    userGroups: loadUserGroups(),
    openings: loadOpenings(),
    openingBills: loadOpeningBills(),
    booksBegin: loadBooksBegin(localToday()),
    lockUntil: getLockUntil(),
  };
}

/* ── Pure helpers ────────────────────────────────────────────────── */

const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const cell = (mapping: ColumnMapping, row: readonly string[], key: string): string => {
  const c = mapping[key];
  return c === undefined || c < 0 ? '' : String(row[c] ?? '').trim();
};
const toPaise = (rupees: number) => Math.round(round2(rupees) * 100);

/** "Dr" / "Cr" from a cell ("1,200 Dr", "Cr", "Debit", "credit") — '' when it says neither. */
export function drCrOf(raw: string): 'Dr' | 'Cr' | '' {
  const s = raw.trim().toLowerCase();
  if (/(^|\s|\d)(dr\.?|debit)$/.test(s) || s === 'dr' || s === 'debit' || s === 'd') return 'Dr';
  if (/(^|\s|\d)(cr\.?|credit)$/.test(s) || s === 'cr' || s === 'credit' || s === 'c') return 'Cr';
  return '';
}

/**
 * Signed amount (debit-positive PAISE) from an amount cell and an optional Dr / Cr cell: the cell's own suffix wins,
 * then the Dr / Cr column, then the sign (negative = Cr), then `fallback`. `null` = blank, NaN = unreadable.
 */
export function signedAmount(raw: string, drCrCell: string, fallback: 'Dr' | 'Cr'): number | null {
  if (!raw.trim()) return null;
  const p = parseNumber(raw);
  if (!p.ok || p.value === null) return Number.NaN;
  const own = drCrOf(raw);
  const side = own || drCrOf(drCrCell) || (p.value < 0 ? 'Cr' : fallback);
  const paise = toPaise(Math.abs(p.value));
  return side === 'Dr' ? paise : -paise;
}

/* Tally / Busy / Marg / QuickBooks / Xero group names → Schedule III primaries. Keys are `normalizeHeader` forms. */
const GROUP_NAMES: Record<string, PrimaryGroupId> = {
  'capital account': 'CAPITAL', capital: 'CAPITAL', 'owners equity': 'CAPITAL', equity: 'CAPITAL', 'partners capital': 'CAPITAL', 'share capital': 'CAPITAL',
  'reserves and surplus': 'RESERVES', 'retained earnings': 'RESERVES', 'profit and loss a c': 'RESERVES', 'profit and loss account': 'RESERVES',
  'loans liability': 'LOANS_LT', 'secured loans': 'LOANS_LT', 'unsecured loans': 'LOANS_LT', 'long term liabilities': 'LOANS_LT', 'non current liability': 'LOANS_LT',
  'bank od a c': 'LOANS_ST', 'bank od accounts': 'LOANS_ST', 'bank occ a c': 'LOANS_ST', 'credit card': 'LOANS_ST',
  'sundry creditors': 'TRADE_PAYABLES', 'trade payables': 'TRADE_PAYABLES', 'accounts payable': 'TRADE_PAYABLES', 'accounts payable a p': 'TRADE_PAYABLES', creditors: 'TRADE_PAYABLES', 'supplier': 'TRADE_PAYABLES',
  'duties and taxes': 'DUTIES_TAXES', 'duties taxes': 'DUTIES_TAXES', 'tax payable': 'DUTIES_TAXES',
  'current liabilities': 'OTHER_CL', 'other current liabilities': 'OTHER_CL', 'other current liability': 'OTHER_CL', 'suspense a c': 'OTHER_CL', 'suspense account': 'OTHER_CL', 'current liability': 'OTHER_CL',
  provisions: 'PROVISIONS',
  'fixed assets': 'FIXED_ASSETS', 'fixed asset': 'FIXED_ASSETS', 'property plant and equipment': 'FIXED_ASSETS',
  investments: 'INVESTMENTS',
  'deposits asset': 'LOANS_ADV_LT', 'non current asset': 'LOANS_ADV_LT',
  'loans and advances asset': 'LOANS_ADV_ST', 'loans and advances': 'LOANS_ADV_ST',
  'stock in hand': 'INVENTORIES', inventory: 'INVENTORIES', inventories: 'INVENTORIES', 'closing stock': 'INVENTORIES', 'opening stock': 'INVENTORIES',
  'sundry debtors': 'TRADE_RECEIVABLES', 'trade receivables': 'TRADE_RECEIVABLES', 'accounts receivable': 'TRADE_RECEIVABLES', 'accounts receivable a r': 'TRADE_RECEIVABLES', debtors: 'TRADE_RECEIVABLES', customer: 'TRADE_RECEIVABLES',
  'bank accounts': 'CASH_BANK', bank: 'CASH_BANK', 'cash in hand': 'CASH_BANK', cash: 'CASH_BANK', 'cash and bank': 'CASH_BANK', 'cash and cash equivalents': 'CASH_BANK',
  'current assets': 'OTHER_CA', 'other current assets': 'OTHER_CA', 'other current asset': 'OTHER_CA', 'current asset': 'OTHER_CA', 'branch divisions': 'OTHER_CA',
  'sales accounts': 'SALES', sales: 'SALES', income: 'SALES', revenue: 'SALES',
  'direct incomes': 'OTHER_INCOME', 'indirect incomes': 'OTHER_INCOME', 'other income': 'OTHER_INCOME',
  'purchase accounts': 'PURCHASES', purchases: 'PURCHASES', 'cost of goods sold': 'PURCHASES', 'cost of sales': 'PURCHASES',
  'direct expenses': 'DIRECT_EXPENSES', 'manufacturing expenses': 'DIRECT_EXPENSES',
  'indirect expenses': 'INDIRECT_EXPENSES', expenses: 'INDIRECT_EXPENSES', expense: 'INDIRECT_EXPENSES', 'other expense': 'INDIRECT_EXPENSES',
  'salary': 'EMPLOYEE', 'employee benefits': 'EMPLOYEE', 'finance costs': 'FINANCE', 'interest': 'FINANCE', depreciation: 'DEPRECIATION',
};

/** Keyword fallback, most specific first. */
const GROUP_KEYWORDS: readonly [RegExp, PrimaryGroupId][] = [
  [/debtor|receivable/, 'TRADE_RECEIVABLES'],
  [/creditor|payable/, 'TRADE_PAYABLES'],
  [/\bod\b|overdraft|cash credit|\bcc\b/, 'LOANS_ST'],
  [/loan|borrow/, 'LOANS_LT'],
  [/bank|cash/, 'CASH_BANK'],
  [/capital|equity|drawing/, 'CAPITAL'],
  [/reserve|surplus|profit/, 'RESERVES'],
  [/duty|duties|tax|gst|tds|tcs/, 'DUTIES_TAXES'],
  [/provision/, 'PROVISIONS'],
  [/stock|inventor/, 'INVENTORIES'],
  [/deposit|advance/, 'LOANS_ADV_ST'],
  [/fixed|plant|machiner|furniture|vehicle|building|equipment|computer/, 'FIXED_ASSETS'],
  [/investment/, 'INVESTMENTS'],
  [/sale|revenue/, 'SALES'],
  [/income/, 'OTHER_INCOME'],
  [/purchase/, 'PURCHASES'],
  [/salar|wage|staff|employee/, 'EMPLOYEE'],
  [/interest|finance|bank charge/, 'FINANCE'],
  [/depreciation|amorti/, 'DEPRECIATION'],
  [/direct expense|freight inward|carriage inward/, 'DIRECT_EXPENSES'],
  [/expense|rent|charges/, 'INDIRECT_EXPENSES'],
  [/liabilit/, 'OTHER_CL'],
  [/asset/, 'OTHER_CA'],
];

export interface GroupMatch {
  /** A primary id or a user group id (what `saveUserAccount` takes). */
  group: string;
  primary: PrimaryGroupId;
  /** True when the text named the group exactly (no warning). */
  exact: boolean;
}

/**
 * Map a group cell to a group: a user group / sub-group by name or alias, a primary by id or label, a known Tally /
 * other-tool group name, then a keyword; else the nearest primary for the balance side (Dr → other current assets,
 * Cr → other current liabilities). Only the first three are `exact`.
 */
export function mapGroup(text: string, userGroups: readonly UserGroup[], side: 'Dr' | 'Cr' = 'Dr'): GroupMatch {
  const k = normalizeHeader(text);
  if (k) {
    const ug = userGroups.find((g) => normalizeHeader(g.name) === k || (g.alias && normalizeHeader(g.alias) === k));
    const ugPrimary = ug ? primaryOf(ug.id, userGroups) : undefined;
    if (ug && ugPrimary) return { group: ug.id, primary: ugPrimary, exact: true };
    const prim = GROUPS.find((g) => normalizeHeader(g.id) === k || normalizeHeader(g.label) === k);
    if (prim) return { group: prim.id, primary: prim.id as PrimaryGroupId, exact: true };
    const named = GROUP_NAMES[k];
    if (named) return { group: named, primary: named, exact: true };
    for (const [re, p] of GROUP_KEYWORDS) if (re.test(k)) return { group: p, primary: p, exact: false };
  }
  const p: PrimaryGroupId = side === 'Cr' ? 'OTHER_CL' : 'OTHER_CA';
  return { group: p, primary: p, exact: false };
}

const DR_NATURE = new Set(['asset', 'expense']);
const natureSide = (p: PrimaryGroupId): 'Dr' | 'Cr' => (DR_NATURE.has(GROUPS.find((g) => g.id === p)?.nature ?? 'asset') ? 'Dr' : 'Cr');
const groupLabel = (p: PrimaryGroupId) => GROUPS.find((g) => g.id === p)?.label ?? p;

/** 'client' / 'vendor' from a party-type cell ('' when it says neither). */
function partyTypeOf(raw: string): 'client' | 'vendor' | '' {
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  if (/supplier|vendor|creditor|purchase|payable/.test(s)) return 'vendor';
  if (/customer|client|debtor|sale|receivable|buyer/.test(s)) return 'client';
  return '';
}

function sideOf(raw: string): OpeningBillSide | '' {
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  if (/payable|supplier|vendor|creditor|purchase|bill/.test(s)) return 'payable';
  if (/receivable|customer|client|debtor|sale|invoice/.test(s)) return 'receivable';
  return '';
}

function readGstin(raw: string, strict: boolean, issues: RowIssue[]): string {
  const g = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!g || /^(unregistered|urd|na|n\/a|nil|none|-+|consumer|b2c)$/i.test(raw.trim())) return '';
  const check = checkGstin(g);
  if (check.valid) return g;
  issues.push({ level: strict ? 'error' : 'warning', field: 'gstin', message: `GSTIN "${g}": ${check.message}${strict ? '' : ' (imported as typed)'}` });
  return strict ? '' : g;
}

interface PartyIndex {
  byGstin: Map<string, { id: string; name: string }>;
  byName: Map<string, { id: string; name: string }>;
}
function indexParties(rows: readonly { id?: string; name?: string; gstin?: string }[]): PartyIndex {
  const byGstin = new Map<string, { id: string; name: string }>();
  const byName = new Map<string, { id: string; name: string }>();
  for (const r of rows) {
    if (!r?.id) continue;
    const g = String(r.gstin ?? '').replace(/\s/g, '').toUpperCase();
    if (g && !byGstin.has(g)) byGstin.set(g, { id: r.id, name: r.name ?? '' });
    const n = norm(r.name);
    if (n && !byName.has(n)) byName.set(n, { id: r.id, name: r.name ?? '' });
  }
  return { byGstin, byName };
}
const findParty = (ix: PartyIndex, name: string, gstin = '') => (gstin ? ix.byGstin.get(gstin) : undefined) ?? ix.byName.get(norm(name));

/* ── Preview ─────────────────────────────────────────────────────── */

export interface OpeningsPreview extends ImportPreview {
  kind: OpeningsKind;
  /** Σ Dr − Σ Cr of the ledger openings after the import (paise); non-zero posts to 1090. */
  difference: number;
  /** Before the import (paise). */
  differenceBefore: number;
  /** The day the openings post on (the day before the books begin) and whether it is locked. */
  openingDay: string;
  locked: boolean;
  /** Rows by `PreviewRow.index` → what each will write (records stay typed here). */
  records: Map<number, OpeningsImportRecord>;
}

export interface OpeningsPreviewParams {
  kind: OpeningsKind;
  table: ImportTable;
  mapping: ColumnMapping;
  ctx: OpeningsContext;
  skipped?: ReadonlySet<number>;
  firstDataLine?: number;
}

/** Dry run: validate every row and decide create / update / skip / error — writes nothing. */
export function buildOpeningsPreview(p: OpeningsPreviewParams): OpeningsPreview {
  const { kind, table, mapping, ctx } = p;
  const skipped = p.skipped ?? new Set<number>();
  const line0 = p.firstDataLine ?? 2;
  const strict = ctx.strictGstin ?? true;
  const dupMode = ctx.duplicateMode ?? 'update';
  const openingDay = openingDayFor(ctx.booksBegin);
  const locked = isDateLocked(openingDay, ctx.lockUntil);
  const vendorIx = indexParties(ctx.vendors);
  const clientIx = indexParties(ctx.clients);
  const rows: PreviewRow[] = [];
  const records = new Map<number, OpeningsImportRecord>();
  const entries = new Map<string, number>(ctx.openings.map((o) => [o.ledger_id, signedOpening(o)]));
  const seen = new Map<string, number>();
  const lockIssue = (): RowIssue => ({ level: 'error', message: `The opening day (${prettyDay(openingDay)}) is in a locked period: unlock it (Settings → Security) to import opening balances.` });

  table.rows.forEach((r, i) => {
    if (r.every((c) => String(c ?? '').trim() === '')) return;
    const issues: RowIssue[] = [];
    const row: PreviewRow = { index: i, sourceIndexes: [i], line: i + line0, label: '', action: 'create', issues, record: null };
    const dup = (key: string) => {
      const prior = seen.get(key);
      if (prior !== undefined) {
        row.action = 'skip';
        row.skipReason = `Duplicate of row ${prior + line0} in this file`;
        return true;
      }
      seen.set(key, i);
      return false;
    };

    if (kind === 'vendors') {
      const name = cell(mapping, r, 'name');
      row.label = name;
      if (!name) issues.push({ level: 'error', field: 'name', message: 'Supplier name is required' });
      const gstin = readGstin(cell(mapping, r, 'gstin'), strict, issues);
      const receivable = parseNumber(cell(mapping, r, 'receivable'));
      const payable = parseNumber(cell(mapping, r, 'payable'));
      const typed = partyTypeOf(cell(mapping, r, 'party_type'));
      const target: 'vendor' | 'client' = typed || ((receivable.value ?? 0) > 0 && !((payable.value ?? 0) > 0) ? 'client' : 'vendor');
      let opening: number | undefined;
      const ob = signedAmount(cell(mapping, r, 'opening_balance'), cell(mapping, r, 'dr_cr'), target === 'vendor' ? 'Cr' : 'Dr');
      if (Number.isNaN(ob)) issues.push({ level: 'error', field: 'opening_balance', message: `Opening balance "${cell(mapping, r, 'opening_balance')}" is not a valid number` });
      else if (ob !== null) opening = ob;
      else if ((payable.value ?? 0) > 0 || (receivable.value ?? 0) > 0) opening = toPaise(Math.abs(receivable.value ?? 0)) - toPaise(Math.abs(payable.value ?? 0));
      const email = cell(mapping, r, 'email');
      if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) issues.push({ level: 'warning', field: 'email', message: `E-mail "${email}" looks wrong (imported as typed)` });
      const stateText = cell(mapping, r, 'state');
      const state_code = resolveStateCode({ gstin, name: stateText, code: /^\d{1,2}$/.test(stateText) ? stateText.padStart(2, '0') : undefined }) || undefined;
      const rec: PartyImportRecord = {
        type: 'party', target, name,
        ...(gstin ? { gstin } : {}),
        ...(cell(mapping, r, 'pan') ? { pan: cell(mapping, r, 'pan').toUpperCase() } : {}),
        ...(email ? { email } : {}),
        ...(cell(mapping, r, 'phone') ? { phone: cell(mapping, r, 'phone') } : {}),
        ...(cell(mapping, r, 'address') ? { address: cell(mapping, r, 'address') } : {}),
        ...(state_code ? { state_code } : {}),
        ...(opening !== undefined && opening !== 0 ? { opening } : {}),
      };
      if (target === 'client') issues.push({ level: 'warning', field: 'party_type', message: 'A customer: imported into Clients, not Suppliers' });
      if (name && !dup(`${target}:${gstin || norm(name)}`)) {
        const match = findParty(target === 'vendor' ? vendorIx : clientIx, name, gstin);
        if (match) {
          row.matchId = match.id;
          if (dupMode === 'update') {
            row.action = 'update';
            if (norm(match.name) !== norm(name)) issues.push({ level: 'warning', field: 'name', message: `Matched existing ${target === 'vendor' ? 'supplier' : 'client'} "${match.name}" by GSTIN: its name is kept` });
          } else {
            row.action = 'skip';
            row.skipReason = `Already exists as "${match.name}"`;
          }
        }
      }
      if (rec.opening && locked) issues.push(lockIssue());
      if (row.action !== 'skip' && rec.opening !== undefined) {
        const lid = `party:${target === 'vendor' ? 'creditor' : 'debtor'}:${row.matchId ?? `new:${i}`}`;
        entries.set(lid, rec.opening);
      }
      records.set(i, rec);
    } else if (kind === 'ledgers') {
      const name = cell(mapping, r, 'name');
      row.label = name;
      if (!name) issues.push({ level: 'error', field: 'name', message: 'Ledger name is required' });
      const groupText = cell(mapping, r, 'group');
      // Amount: Debit / Credit columns, else the signed opening balance column.
      const dr = parseNumber(cell(mapping, r, 'debit'));
      const cr = parseNumber(cell(mapping, r, 'credit'));
      let amount = 0;
      let given = false;
      if (!dr.ok) issues.push({ level: 'error', field: 'debit', message: `Debit "${cell(mapping, r, 'debit')}" is not a valid number` });
      if (!cr.ok) issues.push({ level: 'error', field: 'credit', message: `Credit "${cell(mapping, r, 'credit')}" is not a valid number` });
      if (dr.value !== null || cr.value !== null) {
        amount = toPaise(Math.abs(dr.value ?? 0)) - toPaise(Math.abs(cr.value ?? 0));
        given = true;
      }
      const prelim = mapGroup(groupText, ctx.userGroups, amount < 0 ? 'Cr' : 'Dr');
      if (!given) {
        const s = signedAmount(cell(mapping, r, 'amount'), cell(mapping, r, 'dr_cr'), natureSide(prelim.primary));
        if (Number.isNaN(s)) issues.push({ level: 'error', field: 'amount', message: `Opening balance "${cell(mapping, r, 'amount')}" is not a valid number` });
        else if (s !== null) amount = s;
      }
      const gm = mapGroup(groupText, ctx.userGroups, amount < 0 ? 'Cr' : 'Dr');
      const existing = ctx.chart.find((a) => norm(a.name) === norm(name) || (a.alias && norm(a.alias) === norm(name)));
      if (existing?.id === A.openingDiff || /difference in opening/i.test(name)) {
        row.action = 'skip';
        row.skipReason = 'The opening difference is worked out by the app (1090)';
      } else if (name) {
        let rec: LedgerImportRecord;
        if (gm.primary === 'TRADE_RECEIVABLES' || gm.primary === 'TRADE_PAYABLES') {
          const side = gm.primary === 'TRADE_RECEIVABLES' ? 'debtor' : 'creditor';
          const gstin = readGstin(cell(mapping, r, 'gstin'), strict, issues);
          const match = findParty(side === 'debtor' ? clientIx : vendorIx, name, gstin);
          rec = { type: 'ledger', name, ledger: { kind: 'party', side, ...(match ? { partyId: match.id } : {}), ...(gstin ? { gstin } : {}) }, amount };
          if (match) {
            row.matchId = match.id;
            row.action = 'update';
          } else issues.push({ level: 'warning', field: 'name', message: `New ${side === 'debtor' ? 'client' : 'supplier'} "${name}" will be created` });
          if (!dup(`party:${side}:${match?.id ?? norm(name)}`)) entries.set(`party:${side}:${match?.id ?? `new:${i}`}`, amount);
        } else {
          rec = { type: 'ledger', name, ledger: { kind: 'account', ...(existing ? { id: existing.id } : {}), group: existing ? existing.under || existing.group : gm.group, primary: existing ? existing.group : gm.primary }, amount };
          if (existing) {
            row.matchId = existing.id;
            row.action = 'update';
            if (groupText && primaryOf(gm.group, ctx.userGroups) !== existing.group) issues.push({ level: 'warning', field: 'group', message: `"${existing.name}" already exists under ${groupLabel(existing.group)}: kept there` });
          } else if (!groupText) issues.push({ level: 'warning', field: 'group', message: `No group given: placed under ${groupLabel(gm.primary)}` });
          else if (!gm.exact) issues.push({ level: 'warning', field: 'group', message: `Group "${groupText}" is not a known group: mapped to ${groupLabel(gm.primary)}` });
          if (!dup(`acc:${existing?.id ?? norm(name)}`)) entries.set(existing?.id ?? `new:${i}`, amount);
        }
        if (amount !== 0 && locked) issues.push(lockIssue());
        records.set(i, rec);
      }
    } else {
      const partyName = cell(mapping, r, 'party');
      const ref = cell(mapping, r, 'ref_no');
      row.label = [ref, partyName].filter(Boolean).join(' · ');
      if (!partyName) issues.push({ level: 'error', field: 'party', message: 'Party is required' });
      if (!ref) issues.push({ level: 'error', field: 'ref_no', message: 'Bill reference is required' });
      const dateRaw = cell(mapping, r, 'date');
      const date = parseDate(dateRaw);
      if (!date) issues.push({ level: 'error', field: 'date', message: dateRaw ? `Bill date "${dateRaw}" is not a date` : 'Bill date is required' });
      else if (date >= ctx.booksBegin) issues.push({ level: 'warning', field: 'date', message: `Dated on or after the books begin (${prettyDay(ctx.booksBegin)}): usually entered as an invoice / bill instead` });
      const dueRaw = cell(mapping, r, 'due_date');
      const due = dueRaw ? parseDate(dueRaw) : null;
      if (dueRaw && !due) issues.push({ level: 'warning', field: 'due_date', message: `Due date "${dueRaw}" is not a date: ignored` });
      else if (due && date && due < date) issues.push({ level: 'error', field: 'due_date', message: 'The due date is before the bill date' });
      const days = parseNumber(cell(mapping, r, 'credit_days'));
      const amountRaw = cell(mapping, r, 'amount');
      const amt = parseNumber(amountRaw);
      if (!amt.ok || amt.value === null || !(Math.abs(amt.value) > 0)) issues.push({ level: 'error', field: 'amount', message: amountRaw ? `Amount "${amountRaw}" is not a valid amount` : 'Amount is required' });
      const drcr = drCrOf(amountRaw) || drCrOf(cell(mapping, r, 'dr_cr'));
      const client = findParty(clientIx, partyName);
      const vendor = findParty(vendorIx, partyName);
      const side: OpeningBillSide | '' = sideOf(cell(mapping, r, 'side')) || (drcr === 'Dr' ? 'receivable' : drcr === 'Cr' ? 'payable' : client && !vendor ? 'receivable' : vendor && !client ? 'payable' : '');
      if (!side && partyName) issues.push({ level: 'error', field: 'side', message: `Say whether "${partyName}" is a receivable or a payable (Side or Dr / Cr column)` });
      const party = side === 'receivable' ? client : side === 'payable' ? vendor : undefined;
      if (side && partyName && !party) issues.push({ level: 'warning', field: 'party', message: `New ${side === 'receivable' ? 'client' : 'supplier'} "${partyName}" will be created` });
      if (side && partyName && ref && !dup(`${side}:${party?.id ?? norm(partyName)}:${norm(ref)}`)) {
        const prev = party ? ctx.openingBills.find((b) => b.party_id === party.id && b.side === side && norm(b.ref_no) === norm(ref)) : undefined;
        if (prev) {
          row.matchId = prev.id;
          if (dupMode === 'update') row.action = 'update';
          else {
            row.action = 'skip';
            row.skipReason = `Opening bill ${prev.ref_no} already recorded`;
          }
        }
      }
      if (locked) issues.push(lockIssue());
      if (side && date && amt.value) {
        records.set(i, {
          type: 'opening_bill', side, ...(party ? { partyId: party.id } : {}), partyName: party?.name || partyName, ref_no: ref, date,
          ...(due ? { due_date: due } : {}), ...(days.value && days.value > 0 ? { credit_days: Math.round(days.value) } : {}),
          amount: round2(Math.abs(amt.value)), dr_cr: drcr || (side === 'receivable' ? 'Dr' : 'Cr'),
        });
      }
    }

    if (skipped.has(i)) {
      row.action = 'skip';
      row.skipReason = 'Skipped by you';
    } else if (issues.some((x) => x.level === 'error')) row.action = 'error';
    row.record = (records.get(i) ?? null) as PreviewRow['record'];
    rows.push(row);
  });

  const summary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0, warnings: 0 };
  for (const r of rows) {
    summary[r.action]++;
    summary.warnings += r.issues.filter((x) => x.level === 'warning').length;
  }
  const after = [...entries.values()].map((v) => ({ dr: v > 0 ? v : 0, cr: v < 0 ? -v : 0 }));
  return {
    kind, rows, summary, records, openingDay, locked,
    difference: openingDifference(after),
    differenceBefore: openingDifference(ctx.openings),
  };
}

/** Banner text for the dry run: the difference that will post to 1090 ('' when they agree). */
export function differenceNote(preview: Pick<OpeningsPreview, 'difference'>): string {
  const t = openingDifferenceText(preview.difference);
  return t ? `${t}. It posts to "Opening balance difference" (1090) until it is corrected.` : '';
}

/* ── Apply ───────────────────────────────────────────────────────── */

export class ImportOpeningsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportOpeningsError';
  }
}

export const IMPORT_RUNS_TABLE = 'import_runs';

/** One row per import run (any kind). Read by the setup checklist ("import" step, R6-A1). */
export interface ImportRun {
  id: string;
  /** ISO timestamp of the run. */
  at: string;
  kind: ImportKind;
  file_name?: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Ledger openings difference after the run (paise), when the run touched openings. */
  opening_difference?: number;
}

export function loadImportRuns(): ImportRun[] {
  return getTable<ImportRun>(IMPORT_RUNS_TABLE).filter((r) => r && typeof r.id === 'string');
}

/** Append one import-run row. Fail-soft: the record of a run must never undo the run. */
export function recordImportRun(run: Omit<ImportRun, 'id' | 'at'> & { at?: string }): ImportRun | null {
  try {
    const row: ImportRun = { id: generateId(), at: run.at ?? new Date().toISOString(), ...run, ...(run.file_name ? { file_name: run.file_name.slice(0, 200) } : {}) } as ImportRun;
    setTable(IMPORT_RUNS_TABLE, [...loadImportRuns(), row]);
    return row;
  } catch {
    return null;
  }
}

const TOUCHED = ['vendors', 'clients', 'accounts', 'ledger_openings', 'opening_bills', 'books_begin', IMPORT_RUNS_TABLE];

function nextCode(chart: readonly Account[]): () => string {
  const used = new Set(chart.map((a) => a.code.toLowerCase()));
  let n = 1;
  return () => {
    while (used.has(`im-${n}`)) n++;
    used.add(`im-${n}`);
    return `IM-${n++}`;
  };
}

/**
 * Write the preview: all or nothing. Refused when a row still has an error (fix or skip it). Re-reads the live data
 * so ids made by this run (new suppliers / clients / ledgers) get their openings. Returns the report.
 */
export function applyOpeningsImport(preview: OpeningsPreview, opts: { fileName?: string } = {}): ImportReport {
  requireAccess('books.edit');
  const bad = preview.rows.filter((r) => r.action === 'error');
  if (bad.length) throw new ImportOpeningsError(`Fix or skip the ${bad.length} row${bad.length === 1 ? '' : 's'} with errors first: nothing was imported.`);
  const live = preview.rows.filter((r) => (r.action === 'create' || r.action === 'update') && preview.records.has(r.index));
  const report: ImportReport = { created: 0, updated: 0, skipped: preview.rows.length - live.length, errors: [] };
  return withTablesRollback(TOUCHED, () => {
    const entries: OpeningEntry[] = [];
    const vendorIx = indexParties(vendorsDb.all());
    const clientIx = indexParties(localDb.clients.getAll());
    const ensureVendor = (name: string, extra: Partial<Vendor> = {}, matchId?: string): string => {
      const found = matchId ? { id: matchId } : findParty(vendorIx, name, extra.gstin ?? '');
      const prev = found ? vendorsDb.get(found.id) : undefined;
      const v = vendorsDb.save({ ...(prev ?? {}), ...stripEmpty(extra), name: prev?.name ?? name } as Omit<Vendor, 'id'> & { id?: string });
      vendorIx.byName.set(norm(v.name), { id: v.id, name: v.name });
      if (v.gstin) vendorIx.byGstin.set(v.gstin, { id: v.id, name: v.name });
      return v.id;
    };
    const ensureClient = (name: string, extra: Partial<Client> = {}, matchId?: string): string => {
      const found = matchId ? { id: matchId } : findParty(clientIx, name, extra.gstin ?? '');
      const id = localDb.clients.upsert({ ...(found ? keepClient(found.id) : {}), ...stripEmpty(extra), ...(found ? { id: found.id } : {}), name: found ? (localDb.clients.getById(found.id)?.name ?? name) : name } as Partial<Client> & { name: string });
      clientIx.byName.set(norm(name), { id, name });
      return id;
    };

    if (preview.kind === 'vendors') {
      for (const r of live) {
        const rec = preview.records.get(r.index) as PartyImportRecord;
        const extra = { gstin: rec.gstin, pan: rec.pan, email: rec.email, phone: rec.phone, address: rec.address, state_code: rec.state_code };
        const id = rec.target === 'vendor' ? ensureVendor(rec.name, extra, r.matchId) : ensureClient(rec.name, { gstin: rec.gstin, email: rec.email, phone: rec.phone, address: rec.address, ...(rec.state_code ? { state_code: rec.state_code } : {}) } as Partial<Client>, r.matchId);
        if (rec.opening !== undefined) entries.push({ ledger_id: `party:${rec.target === 'vendor' ? 'creditor' : 'debtor'}:${id}`, amount: rec.opening, party_name: rec.name });
        report[r.action === 'update' ? 'updated' : 'created']++;
      }
    } else if (preview.kind === 'ledgers') {
      const groups = loadUserGroups();
      const code = nextCode(chartOf(loadUserAccounts()));
      for (const r of live) {
        const rec = preview.records.get(r.index) as LedgerImportRecord;
        let ledgerId: string;
        let partyName: string | undefined;
        if (rec.ledger.kind === 'party') {
          const id = rec.ledger.side === 'creditor'
            ? (rec.ledger.partyId ?? ensureVendor(rec.name, { gstin: rec.ledger.gstin }))
            : (rec.ledger.partyId ?? ensureClient(rec.name, { gstin: rec.ledger.gstin } as Partial<Client>));
          ledgerId = `party:${rec.ledger.side}:${id}`;
          partyName = rec.name;
        } else {
          ledgerId = rec.ledger.id ?? saveUserAccount({ code: code(), name: rec.name, group: rec.ledger.group }, groups).id;
        }
        if (rec.amount !== 0) entries.push({ ledger_id: ledgerId, amount: rec.amount, ...(partyName ? { party_name: partyName } : {}) });
        report[r.action === 'update' ? 'updated' : 'created']++;
      }
    } else {
      // Bill-wise openings are saved per party (Tally's bill-wise screen saves a party's list as a whole).
      const byParty = new Map<string, { party: { id: string; name: string; side: OpeningBillSide }; bills: OpeningBillImportRecord[] }>();
      for (const r of live) {
        const rec = preview.records.get(r.index) as OpeningBillImportRecord;
        const id = rec.partyId ?? (rec.side === 'payable' ? ensureVendor(rec.partyName) : ensureClient(rec.partyName));
        const k = `${rec.side}:${id}`;
        const g = byParty.get(k) ?? { party: { id, name: rec.partyName, side: rec.side }, bills: [] };
        g.bills.push(rec);
        byParty.set(k, g);
        report[r.action === 'update' ? 'updated' : 'created']++;
      }
      const all = loadOpeningBills();
      for (const { party, bills } of byParty.values()) {
        const mine = all.filter((b) => b.party_id === party.id && b.side === party.side);
        const incoming = new Map(bills.map((b) => [norm(b.ref_no), b]));
        const drafts: OpeningBillDraft[] = [
          ...mine.filter((b) => !incoming.has(norm(b.ref_no))).map((b) => ({ id: b.id, ref_no: b.ref_no, date: b.date, ...(b.due_date ? { due_date: b.due_date } : {}), amount: b.amount, dr_cr: b.dr_cr })),
          ...bills.map((b) => {
            const prev = mine.find((m) => norm(m.ref_no) === norm(b.ref_no));
            return { ...(prev ? { id: prev.id } : {}), ref_no: b.ref_no, date: b.date, ...(b.due_date ? { due_date: b.due_date } : {}), ...(b.credit_days ? { credit_days: b.credit_days } : {}), amount: b.amount, dr_cr: b.dr_cr };
          }),
        ];
        saveOpeningBillsFor(party, drafts);
      }
    }
    let difference: number | undefined;
    if (entries.length) difference = openingDifference(saveOpenings(entries));
    recordImportRun({ kind: preview.kind, ...(opts.fileName ? { file_name: opts.fileName } : {}), created: report.created, updated: report.updated, skipped: report.skipped, errors: 0, ...(difference !== undefined ? { opening_difference: difference } : {}) });
    return report;
  });
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

/** A matched client keeps every field it already has (blank-safe update). */
function keepClient(id: string): Partial<Client> {
  return localDb.clients.getById(id) ?? {};
}
