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

/**
 * The 24 fixed Schedule III primary groups. Their ids never change: stored rows, reports and
 * other packages compare against them.
 */
export type PrimaryGroupId =
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

/**
 * Any group id: one of the primaries above, or the generated id of a user-defined group /
 * sub-group (table `groups`, WP-1). Opened to `string` so sub-groups can nest like Tally's.
 */
export type GroupId = string;

export interface GroupDef {
  id: GroupId;
  label: string;
  nature: AccountNature;
  /** Schedule III heading the group rolls up to (for the chart view). */
  head: string;
  /** Direct costs feed gross profit (Tally's "Direct Expenses"/"Purchase Accounts"). */
  direct?: boolean;
  /** User groups only: the group it sits under (a primary or another user group). */
  parent?: GroupId;
  /** The Schedule III primary it rolls up to (itself for a primary). Nature / gross-profit effect come from it. */
  primary?: PrimaryGroupId;
  /** User groups only: nesting depth below the primary (1 = directly under it). */
  depth?: number;
  /** Tally "Behaves like a sub-ledger": reports may show the group's total instead of each ledger. */
  subledger?: boolean;
  /** Tally "Nett Debit/Credit balances for reporting". */
  net_balances?: boolean;
  alias?: string;
  /** Built-in primary (cannot be altered or deleted). */
  system?: boolean;
}

const PRIMARY_GROUPS: ReadonlyArray<Omit<GroupDef, 'id'> & { id: PrimaryGroupId }> = [
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

/** The primaries, in Schedule III order. */
export const GROUPS: readonly GroupDef[] = PRIMARY_GROUPS.map((g) => ({ ...g, primary: g.id, system: true }));

const GROUP_BY_ID = new Map<string, GroupDef>(GROUPS.map((g) => [g.id, g]));

const isPrimary = (id: string): id is PrimaryGroupId => GROUP_BY_ID.has(id);

/* ── User-defined groups (table `groups`, WP-1) ─────────────────── */

export const GROUPS_TABLE = 'groups';

/** A stored user group. Nature, Schedule III head and gross-profit effect are inherited from its primary. */
export interface UserGroup {
  id: string;
  name: string;
  alias?: string;
  /** Parent group: a primary id or another user group's id. */
  parent: GroupId;
  subledger?: boolean;
  net_balances?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Walk up from `parent` to a primary; undefined on an unknown parent or a cycle. */
function climb(parent: string, byId: Map<string, UserGroup>, selfId?: string): { primary: PrimaryGroupId; depth: number } | undefined {
  let depth = 1;
  let cur = parent;
  const visited = new Set<string>(selfId ? [selfId] : []);
  while (!isPrimary(cur)) {
    const next = byId.get(cur);
    if (!next || visited.has(cur)) return undefined;
    visited.add(cur);
    cur = next.parent;
    depth++;
  }
  return { primary: cur, depth };
}

/**
 * Tolerant read of stored group rows. Rows without an id / name / parent, with an id or name
 * already taken, or whose parent chain does not end at a primary (unknown parent, cycle) are
 * skipped. Idempotent: normalising the output again returns the same rows.
 */
export function normalizeUserGroups(rows: unknown[]): UserGroup[] {
  const raw: UserGroup[] = [];
  const seen = new Set<string>(GROUP_BY_ID.keys());
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = clean(o.id);
    const name = clean(o.name);
    const parent = clean(o.parent);
    if (!id || !name || !parent || seen.has(id) || id === parent) continue;
    seen.add(id);
    raw.push({
      id,
      name,
      parent,
      ...(clean(o.alias) ? { alias: clean(o.alias) } : {}),
      ...(o.subledger === true ? { subledger: true } : {}),
      ...(o.net_balances === true ? { net_balances: true } : {}),
      ...(clean(o.created_at) ? { created_at: clean(o.created_at) } : {}),
      ...(clean(o.updated_at) ? { updated_at: clean(o.updated_at) } : {}),
    });
  }
  const byId = new Map(raw.map((g) => [g.id, g]));
  const names = new Set(GROUPS.map((g) => g.label.toLowerCase()));
  let out = raw.filter((g) => {
    if (!climb(g.parent, byId, g.id)) return false;
    const k = g.name.toLowerCase();
    if (names.has(k)) return false;
    names.add(k);
    return true;
  });
  // A row dropped for its name may have been another row's parent: drop orphans until stable.
  for (;;) {
    const kept = new Map(out.map((g) => [g.id, g]));
    const next = out.filter((g) => !!climb(g.parent, kept, g.id));
    if (next.length === out.length) return next;
    out = next;
  }
}

/** User groups from storage (fail-soft). */
export function loadUserGroups(): UserGroup[] {
  return normalizeUserGroups(getTable<unknown>(GROUPS_TABLE));
}

function resolveUserGroup(g: UserGroup, byId: Map<string, UserGroup>): GroupDef | undefined {
  const c = climb(g.parent, byId, g.id);
  if (!c) return undefined;
  const p = GROUP_BY_ID.get(c.primary)!;
  return {
    id: g.id,
    label: g.name,
    nature: p.nature,
    head: p.head,
    ...(p.direct ? { direct: true } : {}),
    parent: g.parent,
    primary: c.primary,
    depth: c.depth,
    ...(g.alias ? { alias: g.alias } : {}),
    ...(g.subledger ? { subledger: true } : {}),
    ...(g.net_balances ? { net_balances: true } : {}),
  };
}

/** Primaries followed by every resolvable user group, each right after its parent (depth-first, by name). */
export function allGroups(userGroups: readonly UserGroup[] = []): GroupDef[] {
  const byId = new Map(userGroups.map((g) => [g.id, g]));
  const children = new Map<string, UserGroup[]>();
  for (const g of userGroups) children.set(g.parent, [...(children.get(g.parent) ?? []), g]);
  const out: GroupDef[] = [];
  const walk = (parent: string) => {
    const list = (children.get(parent) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const g of list) {
      const def = resolveUserGroup(g, byId);
      if (!def) continue;
      out.push(def);
      walk(g.id);
    }
  };
  for (const p of GROUPS) {
    out.push(p);
    walk(p.id);
  }
  return out;
}

/**
 * The group definition for `id`. Primaries resolve on their own; a user group needs `userGroups`
 * (it then carries its primary's nature / head / `direct` — Tally's inheritance). Unknown ids fall
 * back to the first primary, as before.
 */
export function groupOf(id: GroupId, userGroups: readonly UserGroup[] = []): GroupDef {
  const p = GROUP_BY_ID.get(id);
  if (p) return p;
  if (userGroups.length) {
    const g = userGroups.find((x) => x.id === id);
    const def = g ? resolveUserGroup(g, new Map(userGroups.map((x) => [x.id, x]))) : undefined;
    if (def) return def;
  }
  return GROUPS[0];
}

/** The Schedule III primary a group id rolls up to, or undefined when it does not resolve. */
export function primaryOf(id: GroupId, userGroups: readonly UserGroup[] = []): PrimaryGroupId | undefined {
  if (isPrimary(id)) return id;
  const g = userGroups.find((x) => x.id === id);
  return g ? climb(g.parent, new Map(userGroups.map((x) => [x.id, x])), g.id)?.primary : undefined;
}

/** True for one of the 24 primary ids (existing callers keep their meaning). */
export function isGroupId(v: unknown): v is PrimaryGroupId {
  return typeof v === 'string' && isPrimary(v);
}

export const isPrimaryGroupId = isGroupId;

/** Interest parameters on a ledger (P1-7, Tally "Activate interest calculation"). */
export interface LedgerInterestParams {
  /** Simple interest, % a year. */
  rate: number;
  /** Which balances earn interest: debit (loans / advances given), credit (loans taken) or both. */
  on: 'dr' | 'cr' | 'both';
  /** Days in the year for the daily rate (365 unless set). */
  days_in_year?: 365 | 360;
  /** Interest runs from this local day (YYYY-MM-DD); absent = from the period start. */
  from?: string;
}

export interface Account {
  id: string;
  /** Short numeric-ish code shown in the chart, unique across the chart. */
  code: string;
  name: string;
  /**
   * The Schedule III PRIMARY group — always a primary id, so statements keep working. A ledger
   * placed in a user sub-group keeps its primary here and names the sub-group in `under`.
   */
  group: PrimaryGroupId;
  /** Additive (WP-1): the user group / sub-group the ledger sits in (absent = directly under `group`). */
  under?: string;
  /** Additive (WP-1): Tally alias. */
  alias?: string;
  /** Additive (WP-1, P1-7): interest parameters (`src/lib/ledger/ledger-interest.ts`). */
  interest?: LedgerInterestParams;
  /** Default account (not stored, cannot be deleted). */
  system?: boolean;
  created_at?: string;
}

/** The group a ledger is shown under: its sub-group when it has one, else its primary. */
export function immediateGroupOf(a: Pick<Account, 'group' | 'under'>): GroupId {
  return a.under || a.group;
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
  tdsSalaryPayable: 'tds_salary_payable',
  pfPayable: 'pf_payable',
  esiPayable: 'esi_payable',
  ptPayable: 'pt_payable',
  inCgst: 'in_cgst',
  inSgst: 'in_sgst',
  inIgst: 'in_igst',
  inCess: 'in_cess',
  gstCash: 'gst_cash',
  tdsReceivable: 'tds_receivable',
  gstOnAdvances: 'gst_on_advances',
  otherCl: 'other_cl',
  custAdvances: 'cust_advances',
  salaryPayable: 'salary_payable',
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
  staffAdvances: 'staff_advances',
  otherCa: 'other_ca',
  sales: 'sales',
  /** Sec 25(4) inter-branch supplies (WP-9): kept apart from Sales so they net out on consolidation. */
  branchTransferOut: 'branch_transfer_out',
  branchTransferIn: 'branch_transfer_in',
  salesReturns: 'sales_returns',
  freightOut: 'freight_out',
  roundOff: 'round_off',
  otherIncome: 'other_income',
  interestIncome: 'interest_income',
  fxGain: 'fx_gain',
  purchases: 'purchases',
  purchaseReturns: 'purchase_returns', // WP-3 (P0-5): debit notes / supplier credit notes
  directExp: 'direct_exp',
  freightIn: 'freight_in',
  salaries: 'salaries',
  allowances: 'allowances',
  bonus: 'bonus',
  pfEmployer: 'pf_employer',
  esiEmployer: 'esi_employer',
  pfAdmin: 'pf_admin',
  gratuity: 'gratuity', // 7P payroll: gratuity paid / provided
  leaveEncashment: 'leave_encashment', // 7P payroll: leave encashment
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
  // Round 2 (R2-A): settlement discounts / short payments, bad debts and their recovery
  discountAllowed: 'discount_allowed',
  badDebts: 'bad_debts',
  badDebtsRecovered: 'bad_debts_recovered',
} as const;

const def = (id: string, code: string, name: string, group: PrimaryGroupId): Account => ({ id, code, name, group, system: true });

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
  def(A.rcmPayable, '2310', 'GST payable: reverse charge', 'DUTIES_TAXES'),
  def(A.importIgst, '2311', 'IGST payable on imports (customs)', 'DUTIES_TAXES'),
  def(A.tcsPayable, '2320', 'TCS payable', 'DUTIES_TAXES'),
  def(A.tdsPayable, '2330', 'TDS payable', 'DUTIES_TAXES'),
  // TDS deducted from suppliers, one ledger per section (Tally parity); 2330 takes anything else.
  def(A.tds194c, '2331', 'TDS payable: 194C contractors', 'DUTIES_TAXES'),
  def(A.tds194j, '2332', 'TDS payable: 194J professional / technical', 'DUTIES_TAXES'),
  def(A.tds194i, '2333', 'TDS payable: 194I rent', 'DUTIES_TAXES'),
  def(A.tds194h, '2334', 'TDS payable: 194H commission', 'DUTIES_TAXES'),
  def(A.tds194q, '2335', 'TDS payable: 194Q purchase of goods', 'DUTIES_TAXES'),
  def(A.tds194a, '2336', 'TDS payable: 194A interest', 'DUTIES_TAXES'),
  // Payroll (Phase 7): statutory dues withheld from salaries / employer contributions.
  def(A.tdsSalaryPayable, '2337', 'TDS payable: salaries (192)', 'DUTIES_TAXES'),
  def(A.pfPayable, '2343', 'PF payable', 'DUTIES_TAXES'),
  def(A.esiPayable, '2344', 'ESI payable', 'DUTIES_TAXES'),
  def(A.ptPayable, '2345', 'Professional tax payable', 'DUTIES_TAXES'),
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
  def(A.salaryPayable, '2425', 'Salary payable', 'OTHER_CL'),
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
  def(A.staffAdvances, '3615', 'Loans & advances to employees', 'LOANS_ADV_ST'),
  def(A.otherCa, '3700', 'Other current assets', 'OTHER_CA'),
  def(A.sales, '4000', 'Sales', 'SALES'),
  def(A.salesReturns, '4010', 'Sales returns (credit notes)', 'SALES'),
  def(A.freightOut, '4020', 'Freight & other charges recovered', 'SALES'),
  def(A.branchTransferOut, '4030', 'Branch transfer (outward, distinct GSTIN)', 'SALES'),
  def(A.roundOff, '4900', 'Round off', 'OTHER_INCOME'),
  def(A.otherIncome, '4910', 'Other income', 'OTHER_INCOME'),
  def(A.interestIncome, '4920', 'Interest received', 'OTHER_INCOME'),
  // Realised exchange differences (6.19): credit = gain, debit = loss (net shown under other income).
  def(A.fxGain, '4930', 'Foreign exchange gain / loss', 'OTHER_INCOME'),
  def(A.purchases, '5000', 'Purchases', 'PURCHASES'),
  def(A.purchaseReturns, '5010', 'Purchase returns (debit notes)', 'PURCHASES'), // WP-3 (P0-5)
  def(A.branchTransferIn, '5020', 'Branch transfer (inward, distinct GSTIN)', 'PURCHASES'),
  def(A.directExp, '5100', 'Direct expenses', 'DIRECT_EXPENSES'),
  def(A.freightIn, '5110', 'Freight inward', 'DIRECT_EXPENSES'),
  def(A.salaries, '6000', 'Salaries & wages', 'EMPLOYEE'),
  def(A.allowances, '6001', 'Allowances & overtime', 'EMPLOYEE'),
  def(A.bonus, '6002', 'Bonus', 'EMPLOYEE'),
  def(A.pfEmployer, '6003', "Employer's contribution to PF", 'EMPLOYEE'),
  def(A.esiEmployer, '6004', "Employer's contribution to ESI", 'EMPLOYEE'),
  def(A.pfAdmin, '6005', 'PF admin & EDLI charges', 'EMPLOYEE'),
  def(A.gratuity, '6006', 'Gratuity', 'EMPLOYEE'), // 7P payroll
  def(A.leaveEncashment, '6007', 'Leave encashment', 'EMPLOYEE'), // 7P payroll
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
  // Round 2 (R2-A): financial credit notes (settlement discount / kasar) and bad debts — verify with your CA.
  def(A.discountAllowed, '6392', 'Discount allowed', 'INDIRECT_EXPENSES'),
  def(A.badDebts, '6394', 'Bad debts written off', 'INDIRECT_EXPENSES'),
  def(A.badDebtsRecovered, '4940', 'Bad debts recovered', 'OTHER_INCOME'),
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

function cleanInterest(v: unknown): LedgerInterestParams | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const rate = typeof o.rate === 'number' ? o.rate : Number(o.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return undefined;
  const on = o.on === 'cr' || o.on === 'both' ? o.on : 'dr';
  const from = clean(o.from);
  return {
    rate,
    on,
    ...(o.days_in_year === 360 ? { days_in_year: 360 as const } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? { from } : {}),
  };
}

/**
 * Tolerant read of stored rows: anything without an id, name or resolvable group is skipped.
 * `group` is normally a primary; a row whose `group` is a user group id (written by newer code)
 * maps to `{ group: <its primary>, under: <that id> }` when `userGroups` is given. An `under`
 * that no longer resolves is dropped (the ledger shows directly under its primary). Idempotent.
 */
export function normalizeUserAccounts(rows: unknown[], userGroups: readonly UserGroup[] = []): Account[] {
  const out: Account[] = [];
  const taken = new Set(DEFAULT_ACCOUNTS.map((a) => a.id));
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = clean(o.id);
    const name = clean(o.name);
    if (!id || !name || taken.has(id)) continue;
    const rawGroup = clean(o.group);
    const primary = primaryOf(rawGroup, userGroups);
    if (!primary) continue;
    let under = isPrimary(rawGroup) ? clean(o.under) : rawGroup;
    if (under && primaryOf(under, userGroups) !== primary) under = '';
    taken.add(id);
    const interest = cleanInterest(o.interest);
    out.push({
      id,
      code: clean(o.code) || id.slice(0, 6),
      name,
      group: primary,
      ...(under ? { under } : {}),
      ...(clean(o.alias) ? { alias: clean(o.alias) } : {}),
      ...(interest ? { interest } : {}),
      created_at: clean(o.created_at) || undefined,
    });
  }
  return out;
}

/* ── Synthesised ledgers (WP-5 hook) ─────────────────────────────
 * Sources merged straight into `chartOf` for modules that derive ledgers from their own masters instead of the
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

/* ── Provided ledgers (WP-1 API: added to `loadUserAccounts`, not to `chartOf`) ── */

const providers = new Map<string, () => Account[]>();

/**
 * Register a source of extra, NOT stored ledgers (e.g. one ledger per bank account). Provided
 * accounts need a stable id and a primary `group`; an id already in the chart is ignored.
 * Returns an unregister function.
 */
export function registerAccountProvider(name: string, fn: () => Account[]): () => void {
  providers.set(name, fn);
  return () => {
    if (providers.get(name) === fn) providers.delete(name);
  };
}

/** Accounts from every registered provider (a provider that throws is skipped). */
export function providedAccounts(): Account[] {
  const out: Account[] = [];
  for (const fn of providers.values()) {
    try {
      for (const a of fn()) if (a && a.id && a.name && isGroupId(a.group)) out.push({ ...a, system: true });
    } catch {
      /* a broken provider never breaks the books */
    }
  }
  return out;
}

/**
 * Defaults + synthesised ledgers (WP-5 `registerLedgerSource`) + user accounts, ordered by code.
 * A synthesised row whose id is a default account only renames it; a duplicate id keeps the first.
 */
export function chartOf(userAccounts: readonly Account[] = []): Account[] {
  const extra = synthesisedLedgers();
  const rename = new Map(extra.map((a) => [a.id, a.name]));
  const defaults = DEFAULT_ACCOUNTS.map((a) => (rename.has(a.id) ? { ...a, name: rename.get(a.id)! } : a));
  const seen = new Set<string>();
  const list = [...defaults, ...extra, ...userAccounts].filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return list.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.name.localeCompare(b.name));
}

/** Stored user accounts plus provided (synthesised) ones. */
export function loadUserAccounts(): Account[] {
  const stored = loadStoredAccounts(loadUserGroups());
  const ids = new Set([...DEFAULT_ACCOUNTS, ...stored].map((a) => a.id));
  return [...stored, ...providedAccounts().filter((a) => !ids.has(a.id))];
}

/** Stored user accounts only (what `saveUserAccount` edits). */
function loadStoredAccounts(groups: readonly UserGroup[]): Account[] {
  return normalizeUserAccounts(getTable<unknown>(ACCOUNTS_TABLE), groups);
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

/** Problems with a new / edited user account (empty list = fine). `group` may be a primary or a user group id. */
export function validateAccount(
  input: { id?: string; code: string; name: string; group: string },
  chart: readonly Account[],
  userGroups: readonly UserGroup[] = [],
): string[] {
  const errors: string[] = [];
  const code = clean(input.code);
  const name = clean(input.name);
  if (!name) errors.push('Enter an account name.');
  if (!code) errors.push('Enter an account code.');
  else if (!/^[A-Za-z0-9-]{1,10}$/.test(code)) errors.push('Account codes are up to 10 letters, digits or dashes.');
  if (!primaryOf(input.group, userGroups)) errors.push('Choose the group the account belongs to.');
  const others = chart.filter((a) => a.id !== input.id);
  if (code && others.some((a) => a.code.toLowerCase() === code.toLowerCase())) errors.push(`Code ${code} is already used.`);
  if (name && others.some((a) => a.name.toLowerCase() === name.toLowerCase())) errors.push(`An account called “${name}” already exists.`);
  return errors;
}

export interface AccountInput {
  id?: string;
  code: string;
  name: string;
  /** A primary id, or a user group id (the ledger is then placed in that sub-group). */
  group: GroupId;
  alias?: string;
  /** `null` removes the parameters; `undefined` keeps what is stored. */
  interest?: LedgerInterestParams | null;
}

/** Add or alter a user account (Tally "Ledger Creation / Alteration"). Default accounts cannot be edited. Audited. */
export function saveUserAccount(input: AccountInput, userGroups: readonly UserGroup[] = loadUserGroups()): Account {
  const users = loadStoredAccounts(userGroups);
  if (input.id && DEFAULT_ACCOUNTS.some((a) => a.id === input.id)) throw new AccountError('Default accounts cannot be changed.');
  const errors = validateAccount(input, chartOf(users), userGroups);
  if (errors.length) throw new AccountError(errors[0]);
  const prev = input.id ? users.find((a) => a.id === input.id) : undefined;
  const primary = primaryOf(input.group, userGroups)!;
  const under = isPrimary(input.group) ? '' : input.group;
  const interest = input.interest === null ? undefined : input.interest !== undefined ? cleanInterest(input.interest) : prev?.interest;
  const alias = input.alias !== undefined ? clean(input.alias) : (prev?.alias ?? '');
  const row: Account = {
    id: prev?.id ?? generateId(),
    code: clean(input.code),
    name: clean(input.name),
    group: primary,
    ...(under ? { under } : {}),
    ...(alias ? { alias } : {}),
    ...(interest ? { interest } : {}),
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  setTable(ACCOUNTS_TABLE, prev ? users.map((a) => (a.id === row.id ? row : a)) : [...users, row]);
  const where = groupOf(immediateGroupOf(row), userGroups).label;
  audit.record({
    entity: 'account',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    doc_number: row.code,
    summary: prev
      ? prev.name !== row.name
        ? `Account ${row.code} renamed to “${row.name}”`
        : `Account ${row.code} “${row.name}” altered (under ${where})`
      : `Account ${row.code} “${row.name}” added under ${where}`,
  });
  return row;
}

/** Remove a user account that nothing posts to. `inUse` is supplied by the caller (vouchers / asset register). */
export function deleteUserAccount(id: string, inUse: boolean): void {
  const users = loadStoredAccounts(loadUserGroups());
  const row = users.find((a) => a.id === id);
  if (!row) throw new AccountError('Only accounts you added can be deleted.');
  if (inUse) throw new AccountError(`${row.name} has entries; it cannot be deleted.`);
  setTable(ACCOUNTS_TABLE, users.filter((a) => a.id !== id));
  audit.record({ entity: 'account', entity_id: id, action: 'delete', doc_number: row.code, summary: `Account ${row.code} “${row.name}” deleted` });
}
