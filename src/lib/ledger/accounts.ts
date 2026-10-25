/**
 * Chart of accounts (Phase 6.1) — a default Indian chart grouped the way Schedule III
 * (Companies Act 2013, Division I) presents the balance sheet and P&L, plus the accounts
 * the user adds (table `accounts`).
 *
 * Default accounts are constants with stable ids (`sales`, `debtors`, `out_cgst` …): they
 * are never stored, so the chart can grow in later versions without a migration. User
 * accounts are stored rows with generated ids and are additive only.
 *
 * Pure except for `loadUserAccounts` / `saveUserAccount` / `deleteUserAccount`, which go
 * through getTable/setTable (fail-soft in Node). Working papers — verify with your CA.
 */

import { audit } from '../audit';
import { generateId, getTable, setTable } from '../storage';

export type AccountNature = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type GroupId =
  | 'CAPITAL'
  | 'RESERVES'
  | 'LOANS_LT'
  | 'LOANS_ST'
  | 'TRADE_PAYABLES'
  | 'DUTIES_TAXES'
  | 'OTHER_CL'
  | 'PROVISIONS'
  | 'FIXED_ASSETS'
  | 'INVESTMENTS'
  | 'LOANS_ADV_LT'
  | 'INVENTORIES'
  | 'TRADE_RECEIVABLES'
  | 'CASH_BANK'
  | 'LOANS_ADV_ST'
  | 'OTHER_CA'
  | 'SALES'
  | 'OTHER_INCOME'
  | 'PURCHASES'
  | 'DIRECT_EXPENSES'
  | 'EMPLOYEE'
  | 'FINANCE'
  | 'DEPRECIATION'
  | 'INDIRECT_EXPENSES';

export interface GroupDef {
  id: GroupId;
  label: string;
  nature: AccountNature;
  /** Schedule III heading the group rolls up to (for the chart view). */
  head: string;
  /** Direct costs feed gross profit (Tally's "Direct Expenses"/"Purchase Accounts"). */
  direct?: boolean;
}

export const GROUPS: readonly GroupDef[] = [
  { id: 'CAPITAL', label: 'Capital account', nature: 'equity', head: "Owner's funds" },
  { id: 'RESERVES', label: 'Reserves & surplus', nature: 'equity', head: "Owner's funds" },
  { id: 'LOANS_LT', label: 'Long-term borrowings (loans)', nature: 'liability', head: 'Non-current liabilities' },
  { id: 'LOANS_ST', label: 'Short-term borrowings', nature: 'liability', head: 'Current liabilities' },
  { id: 'TRADE_PAYABLES', label: 'Sundry creditors (trade payables)', nature: 'liability', head: 'Current liabilities' },
  { id: 'DUTIES_TAXES', label: 'Duties & taxes', nature: 'liability', head: 'Current liabilities' },
  { id: 'OTHER_CL', label: 'Other current liabilities', nature: 'liability', head: 'Current liabilities' },
  { id: 'PROVISIONS', label: 'Provisions', nature: 'liability', head: 'Current liabilities' },
  { id: 'FIXED_ASSETS', label: 'Fixed assets (PPE & intangibles)', nature: 'asset', head: 'Non-current assets' },
  { id: 'INVESTMENTS', label: 'Investments', nature: 'asset', head: 'Non-current assets' },
  { id: 'LOANS_ADV_LT', label: 'Long-term loans & advances', nature: 'asset', head: 'Non-current assets' },
  { id: 'INVENTORIES', label: 'Inventories (stock-in-hand)', nature: 'asset', head: 'Current assets' },
  { id: 'TRADE_RECEIVABLES', label: 'Sundry debtors (trade receivables)', nature: 'asset', head: 'Current assets' },
  { id: 'CASH_BANK', label: 'Cash & bank', nature: 'asset', head: 'Current assets' },
  { id: 'LOANS_ADV_ST', label: 'Short-term loans & advances', nature: 'asset', head: 'Current assets' },
  { id: 'OTHER_CA', label: 'Other current assets', nature: 'asset', head: 'Current assets' },
  { id: 'SALES', label: 'Sales (revenue from operations)', nature: 'income', head: 'Income' },
  { id: 'OTHER_INCOME', label: 'Other (indirect) income', nature: 'income', head: 'Income' },
  { id: 'PURCHASES', label: 'Purchases', nature: 'expense', head: 'Expenses', direct: true },
  { id: 'DIRECT_EXPENSES', label: 'Direct expenses', nature: 'expense', head: 'Expenses', direct: true },
  { id: 'EMPLOYEE', label: 'Employee benefits expense', nature: 'expense', head: 'Expenses' },
  { id: 'FINANCE', label: 'Finance costs', nature: 'expense', head: 'Expenses' },
  { id: 'DEPRECIATION', label: 'Depreciation & amortisation', nature: 'expense', head: 'Expenses' },
  { id: 'INDIRECT_EXPENSES', label: 'Other (indirect) expenses', nature: 'expense', head: 'Expenses' },
];

const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

export function groupOf(id: GroupId): GroupDef {
  return GROUP_BY_ID.get(id) ?? GROUPS[0];
}

export function isGroupId(v: unknown): v is GroupId {
  return typeof v === 'string' && GROUP_BY_ID.has(v as GroupId);
}

export interface Account {
  id: string;
  /** Short numeric-ish code shown in the chart, unique across the chart. */
  code: string;
  name: string;
  group: GroupId;
  /** Default account (not stored, cannot be deleted). */
  system?: boolean;
  created_at?: string;
}

/** Ids of the default accounts the automatic postings use. */
export const A = {
  capital: 'capital',
  drawings: 'drawings',
  openingDiff: 'opening_diff',
  reserves: 'reserves',
  securedLoans: 'secured_loans',
  unsecuredLoans: 'unsecured_loans',
  bankOd: 'bank_od',
  creditors: 'creditors',
  outCgst: 'out_cgst',
  outSgst: 'out_sgst',
  outIgst: 'out_igst',
  outCess: 'out_cess',
  outGst: 'out_gst',
  rcmPayable: 'rcm_payable',
  importIgst: 'import_igst',
  tcsPayable: 'tcs_payable',
  tdsPayable: 'tds_payable',
  tds194c: 'tds_194c',
  tds194j: 'tds_194j',
  tds194i: 'tds_194i',
  tds194h: 'tds_194h',
  tds194q: 'tds_194q',
  tds194a: 'tds_194a',
  tdsInterest: 'tds_interest',
  inCgst: 'in_cgst',
  inSgst: 'in_sgst',
  inIgst: 'in_igst',
  inCess: 'in_cess',
  gstCash: 'gst_cash',
  tdsReceivable: 'tds_receivable',
  gstOnAdvances: 'gst_on_advances',
  otherCl: 'other_cl',
  custAdvances: 'cust_advances',
  provisions: 'provisions',
  faBuilding: 'fa_building',
  faFurniture: 'fa_furniture',
  faPlant: 'fa_plant',
  faComputers: 'fa_computers',
  faVehicles: 'fa_vehicles',
  faOffice: 'fa_office',
  faIntangible: 'fa_intangible',
  accDep: 'acc_dep',
  investments: 'investments',
  deposits: 'deposits',
  stock: 'stock',
  debtors: 'debtors',
  cash: 'cash',
  bank: 'bank',
  advances: 'advances',
  otherCa: 'other_ca',
  sales: 'sales',
  salesReturns: 'sales_returns',
  freightOut: 'freight_out',
  roundOff: 'round_off',
  otherIncome: 'other_income',
  interestIncome: 'interest_income',
  fxGain: 'fx_gain',
  purchases: 'purchases',
  directExp: 'direct_exp',
  freightIn: 'freight_in',
  salaries: 'salaries',
  interestExp: 'interest_exp',
  bankCharges: 'bank_charges',
  depreciation: 'depreciation',
  rent: 'rent',
  software: 'software',
  professional: 'professional',
  travel: 'travel',
  utilities: 'utilities',
  marketing: 'marketing',
  office: 'office',
  itcReversed: 'itc_reversed',
  otherExp: 'other_exp',
} as const;

const def = (id: string, code: string, name: string, group: GroupId): Account => ({ id, code, name, group, system: true });

/** The default chart. Codes: 1xxx owner's funds, 2xxx liabilities, 3xxx assets, 4xxx income, 5xxx direct, 6xxx indirect. */
export const DEFAULT_ACCOUNTS: readonly Account[] = [
  def(A.capital, '1000', 'Capital account', 'CAPITAL'),
  def(A.drawings, '1010', 'Drawings', 'CAPITAL'),
  def(A.openingDiff, '1090', 'Opening balance difference', 'CAPITAL'),
  def(A.reserves, '1100', 'Reserves & surplus', 'RESERVES'),
  def(A.securedLoans, '2000', 'Secured loans', 'LOANS_LT'),
  def(A.unsecuredLoans, '2010', 'Unsecured loans', 'LOANS_LT'),
  def(A.bankOd, '2100', 'Bank overdraft / cash credit', 'LOANS_ST'),
  def(A.creditors, '2200', 'Sundry creditors', 'TRADE_PAYABLES'),
  def(A.outCgst, '2300', 'Output CGST', 'DUTIES_TAXES'),
  def(A.outSgst, '2301', 'Output SGST / UTGST', 'DUTIES_TAXES'),
  def(A.outIgst, '2302', 'Output IGST', 'DUTIES_TAXES'),
  def(A.outCess, '2303', 'Output cess', 'DUTIES_TAXES'),
  def(A.outGst, '2304', 'Output GST (unsplit, legacy)', 'DUTIES_TAXES'),
  def(A.rcmPayable, '2310', 'GST payable — reverse charge', 'DUTIES_TAXES'),
  def(A.importIgst, '2311', 'IGST payable on imports (customs)', 'DUTIES_TAXES'),
  def(A.tcsPayable, '2320', 'TCS payable', 'DUTIES_TAXES'),
  def(A.tdsPayable, '2330', 'TDS payable', 'DUTIES_TAXES'),
  // TDS deducted from suppliers, one ledger per section (Tally parity); 2330 takes anything else.
  def(A.tds194c, '2331', 'TDS payable — 194C contractors', 'DUTIES_TAXES'),
  def(A.tds194j, '2332', 'TDS payable — 194J professional / technical', 'DUTIES_TAXES'),
  def(A.tds194i, '2333', 'TDS payable — 194I rent', 'DUTIES_TAXES'),
  def(A.tds194h, '2334', 'TDS payable — 194H commission', 'DUTIES_TAXES'),
  def(A.tds194q, '2335', 'TDS payable — 194Q purchase of goods', 'DUTIES_TAXES'),
  def(A.tds194a, '2336', 'TDS payable — 194A interest', 'DUTIES_TAXES'),
  def(A.inCgst, '2350', 'Input CGST (credit ledger)', 'DUTIES_TAXES'),
  def(A.inSgst, '2351', 'Input SGST / UTGST (credit ledger)', 'DUTIES_TAXES'),
  def(A.inIgst, '2352', 'Input IGST (credit ledger)', 'DUTIES_TAXES'),
  def(A.inCess, '2353', 'Input cess (credit ledger)', 'DUTIES_TAXES'),
  def(A.gstCash, '2360', 'GST electronic cash ledger', 'DUTIES_TAXES'),
  def(A.tdsReceivable, '2370', 'TDS receivable', 'DUTIES_TAXES'),
  // Advances (5.3): GST paid on service advances, recovered when the invoice's own GST is booked.
  def(A.gstOnAdvances, '2380', 'GST paid on advances received', 'DUTIES_TAXES'),
  def(A.otherCl, '2400', 'Other current liabilities', 'OTHER_CL'),
  def(A.custAdvances, '2410', 'Advances from customers', 'OTHER_CL'),
  def(A.provisions, '2500', 'Provisions & expenses payable', 'PROVISIONS'),
  def(A.faBuilding, '3000', 'Buildings', 'FIXED_ASSETS'),
  def(A.faFurniture, '3010', 'Furniture & fittings', 'FIXED_ASSETS'),
  def(A.faPlant, '3020', 'Plant & machinery', 'FIXED_ASSETS'),
  def(A.faComputers, '3030', 'Computers & software', 'FIXED_ASSETS'),
  def(A.faVehicles, '3040', 'Motor vehicles', 'FIXED_ASSETS'),
  def(A.faOffice, '3050', 'Office equipment', 'FIXED_ASSETS'),
  def(A.faIntangible, '3060', 'Intangible assets', 'FIXED_ASSETS'),
  def(A.accDep, '3090', 'Accumulated depreciation', 'FIXED_ASSETS'),
  def(A.investments, '3100', 'Investments', 'INVESTMENTS'),
  def(A.deposits, '3200', 'Security deposits', 'LOANS_ADV_LT'),
  def(A.stock, '3300', 'Stock-in-hand', 'INVENTORIES'),
  def(A.debtors, '3400', 'Sundry debtors', 'TRADE_RECEIVABLES'),
  def(A.cash, '3500', 'Cash in hand', 'CASH_BANK'),
  def(A.bank, '3510', 'Bank account', 'CASH_BANK'),
  def(A.advances, '3600', 'Advances & prepaid expenses', 'LOANS_ADV_ST'),
  def(A.otherCa, '3700', 'Other current assets', 'OTHER_CA'),
  def(A.sales, '4000', 'Sales', 'SALES'),
  def(A.salesReturns, '4010', 'Sales returns (credit notes)', 'SALES'),
  def(A.freightOut, '4020', 'Freight & other charges recovered', 'SALES'),
  def(A.roundOff, '4900', 'Round off', 'OTHER_INCOME'),
  def(A.otherIncome, '4910', 'Other income', 'OTHER_INCOME'),
  def(A.interestIncome, '4920', 'Interest received', 'OTHER_INCOME'),
  // Realised exchange differences (6.19): credit = gain, debit = loss (net shown under other income).
  def(A.fxGain, '4930', 'Foreign exchange gain / loss', 'OTHER_INCOME'),
  def(A.purchases, '5000', 'Purchases', 'PURCHASES'),
  def(A.directExp, '5100', 'Direct expenses', 'DIRECT_EXPENSES'),
  def(A.freightIn, '5110', 'Freight inward', 'DIRECT_EXPENSES'),
  def(A.salaries, '6000', 'Salaries & wages', 'EMPLOYEE'),
  def(A.interestExp, '6100', 'Interest on loans', 'FINANCE'),
  def(A.bankCharges, '6110', 'Bank charges', 'FINANCE'),
  def(A.depreciation, '6200', 'Depreciation', 'DEPRECIATION'),
  def(A.rent, '6300', 'Rent', 'INDIRECT_EXPENSES'),
  def(A.software, '6310', 'Software & subscriptions', 'INDIRECT_EXPENSES'),
  def(A.professional, '6320', 'Professional fees', 'INDIRECT_EXPENSES'),
  def(A.travel, '6330', 'Travel & conveyance', 'INDIRECT_EXPENSES'),
  def(A.utilities, '6340', 'Utilities', 'INDIRECT_EXPENSES'),
  def(A.marketing, '6350', 'Marketing & advertising', 'INDIRECT_EXPENSES'),
  def(A.office, '6360', 'Office supplies', 'INDIRECT_EXPENSES'),
  def(A.itcReversed, '6370', 'GST input credit reversed', 'INDIRECT_EXPENSES'),
  def(A.tdsInterest, '6380', 'Interest & fees on TDS / TCS (not deductible)', 'INDIRECT_EXPENSES'),
  def(A.otherExp, '6390', 'Other expenses', 'INDIRECT_EXPENSES'),
];

/** Expense category on a bill (src/types/purchases.ts PURCHASE_CATEGORIES) → default account. */
export const EXPENSE_CATEGORY_ACCOUNTS: Readonly<Record<string, string>> = {
  rent: A.rent,
  salaries: A.salaries,
  'software & subscriptions': A.software,
  'professional fees': A.professional,
  travel: A.travel,
  utilities: A.utilities,
  marketing: A.marketing,
  'office supplies': A.office,
  'bank charges': A.bankCharges,
};

/** TDS payable ledger for a section code (`194J-T` → 194J …); unknown / custom codes go to 2330. */
export function tdsAccountFor(sectionCode: string | undefined): string {
  const s = (sectionCode ?? '').toUpperCase();
  if (s.startsWith('194C')) return A.tds194c;
  if (s.startsWith('194J')) return A.tds194j;
  if (s.startsWith('194I')) return A.tds194i;
  if (s.startsWith('194H')) return A.tds194h;
  if (s.startsWith('194Q')) return A.tds194q;
  if (s.startsWith('194A')) return A.tds194a;
  return A.tdsPayable;
}

/* ── User accounts (table `accounts`) ───────────────────────────── */

export const ACCOUNTS_TABLE = 'accounts';

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Tolerant read of stored rows: anything without an id, name or valid group is skipped. */
export function normalizeUserAccounts(rows: unknown[]): Account[] {
  const out: Account[] = [];
  const taken = new Set(DEFAULT_ACCOUNTS.map((a) => a.id));
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = clean(o.id);
    const name = clean(o.name);
    if (!id || !name || taken.has(id) || !isGroupId(o.group)) continue;
    taken.add(id);
    out.push({ id, code: clean(o.code) || id.slice(0, 6), name, group: o.group, created_at: clean(o.created_at) || undefined });
  }
  return out;
}

/* ── Synthesised ledgers (WP-5 hook) ─────────────────────────────
 * The ONE registration point for modules that derive ledgers from their own masters instead of the
 * `accounts` table (bank accounts → one ledger each, `src/lib/bank-ledgers.ts`). A source is a
 * fail-soft read returning system accounts; a row whose id is a default account only renames it. */
const ledgerSources: Array<() => readonly Account[]> = [];
export function registerLedgerSource(source: () => readonly Account[]): void {
  if (!ledgerSources.includes(source)) ledgerSources.push(source);
}
function synthesisedLedgers(): Account[] {
  const out: Account[] = [];
  for (const src of ledgerSources) {
    try {
      out.push(...src());
    } catch {
      /* a broken source never hides the chart */
    }
  }
  return out;
}

/** Defaults + synthesised ledgers + user accounts, ordered by code. */
export function chartOf(userAccounts: readonly Account[] = []): Account[] {
  const extra = synthesisedLedgers();
  const rename = new Map(extra.map((a) => [a.id, a.name]));
  const defaults = DEFAULT_ACCOUNTS.map((a) => (rename.has(a.id) ? { ...a, name: rename.get(a.id)! } : a));
  const own = extra.filter((a) => !DEFAULT_ACCOUNTS.some((d) => d.id === a.id) && !userAccounts.some((u) => u.id === a.id));
  return [...defaults, ...own, ...userAccounts].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.name.localeCompare(b.name));
}

export function loadUserAccounts(): Account[] {
  return normalizeUserAccounts(getTable<unknown>(ACCOUNTS_TABLE));
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

/** Problems with a new / edited user account (empty list = fine). */
export function validateAccount(input: { id?: string; code: string; name: string; group: string }, chart: readonly Account[]): string[] {
  const errors: string[] = [];
  const code = clean(input.code);
  const name = clean(input.name);
  if (!name) errors.push('Enter an account name.');
  if (!code) errors.push('Enter an account code.');
  else if (!/^[A-Za-z0-9-]{1,10}$/.test(code)) errors.push('Account codes are up to 10 letters, digits or dashes.');
  if (!isGroupId(input.group)) errors.push('Choose the group the account belongs to.');
  const others = chart.filter((a) => a.id !== input.id);
  if (code && others.some((a) => a.code.toLowerCase() === code.toLowerCase())) errors.push(`Code ${code} is already used.`);
  if (name && others.some((a) => a.name.toLowerCase() === name.toLowerCase())) errors.push(`An account called “${name}” already exists.`);
  return errors;
}

/** Add or rename a user account. Default accounts cannot be edited. Audited. */
export function saveUserAccount(input: { id?: string; code: string; name: string; group: GroupId }): Account {
  const users = loadUserAccounts();
  if (input.id && DEFAULT_ACCOUNTS.some((a) => a.id === input.id)) throw new AccountError('Default accounts cannot be changed.');
  const errors = validateAccount(input, chartOf(users));
  if (errors.length) throw new AccountError(errors[0]);
  const prev = input.id ? users.find((a) => a.id === input.id) : undefined;
  const row: Account = {
    id: prev?.id ?? generateId(),
    code: clean(input.code),
    name: clean(input.name),
    group: input.group,
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  setTable(ACCOUNTS_TABLE, prev ? users.map((a) => (a.id === row.id ? row : a)) : [...users, row]);
  audit.record({
    entity: 'account',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    doc_number: row.code,
    summary: prev ? `Account ${row.code} renamed to “${row.name}”` : `Account ${row.code} “${row.name}” added under ${groupOf(row.group).label}`,
  });
  return row;
}

/** Remove a user account that nothing posts to. `inUse` is supplied by the caller (vouchers / asset register). */
export function deleteUserAccount(id: string, inUse: boolean): void {
  const users = loadUserAccounts();
  const row = users.find((a) => a.id === id);
  if (!row) throw new AccountError('Only accounts you added can be deleted.');
  if (inUse) throw new AccountError(`${row.name} has entries; it cannot be deleted.`);
  setTable(ACCOUNTS_TABLE, users.filter((a) => a.id !== id));
  audit.record({ entity: 'account', entity_id: id, action: 'delete', doc_number: row.code, summary: `Account ${row.code} “${row.name}” deleted` });
}
