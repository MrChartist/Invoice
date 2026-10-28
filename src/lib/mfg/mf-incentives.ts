/**
 * MF-D4 incentive claims register (table `incentive_claims`, `books.edit`, dated by `period_to`): PLI, state capital
 * subsidy, interest subvention, power / SGST reimbursement, freight and other grants, tracked from claim to receipt.
 *
 * Ind AS 20 / AS 12: a grant is recognised only with reasonable assurance that the conditions are met and it will be
 * received — the user records that date ("assurance") and only then the recognition journal is posted:
 *   income   Dr Incentive receivable | Cr Government grant income
 *   capital  Dr Incentive receivable | Cr the asset's ledger (reduce its cost — the default policy) or Cr Capital subsidy
 *            (reserve), by the user's policy (MF19)
 *   receive  Dr Bank | Cr Incentive receivable   (a receipt before recognition is refused: record assurance first)
 * Journals through `saveVoucher` (period lock, roles, audit), on ledgers created on first use. Bell: claims pending
 * more than 180 days after the claim (`INCENTIVE_RULES`). Tax treatment (subsidy as income, Explanation 10 to Sec 43(1),
 * 2025 Act mapping) is help text only. Working paper — verify MF19 with your CA.
 */
import './mf-registry';
import { MF_TABLES } from './mf-shared';
import { num, round2 } from '../invoice-calc';
import { isoDay } from '../dates';
import { ruleAt } from '../tax-rules';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount, type GroupId } from '../ledger/accounts';
import { saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { INCENTIVE_RULES } from '../mfg-rules';

export const INCENTIVE_CLAIMS_TABLE = MF_TABLES.incentiveClaims;
export const GRANT_CLASS = 'Government grant';

export type IncentiveScheme = 'pli' | 'state_capital' | 'interest_subvention' | 'power' | 'sgst_reimbursement' | 'freight' | 'other';
export const INCENTIVE_SCHEMES: readonly IncentiveScheme[] = ['pli', 'state_capital', 'interest_subvention', 'power', 'sgst_reimbursement', 'freight', 'other'];

export interface IncentiveClaim {
  id: string;
  scheme: IncentiveScheme;
  name: string;
  sanction_ref?: string;
  period_from: string;
  period_to: string;
  eligible_base?: number;
  rate_pct?: number;
  claimed: number;
  /** Day the claim was lodged (absent = the period end). */
  claimed_on?: string;
  approved?: number;
  received?: number;
  received_on?: string;
  kind: 'income' | 'capital';
  /** Capital grant: credit this asset ledger (reduce cost) — absent = Capital subsidy (reserve). */
  asset_account_id?: string;
  conditions?: string;
  /** Day the user recorded reasonable assurance (recognition date). */
  recognised_on?: string;
  recognised?: number;
  voucher_ids: string[];
  created_at?: string;
  updated_at?: string;
}

const GRANT_LEDGERS = {
  receivable: { name: 'Incentive receivable', group: 'OTHER_CA', code: 3760 },
  income: { name: 'Government grant income', group: 'OTHER_INCOME', code: 4960 },
  capital: { name: 'Capital subsidy', group: 'RESERVES', code: 1260 },
} as const satisfies Record<string, { name: string; group: GroupId; code: number }>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Id of the ledger (looked up by name, so a ledger the user renamed back or made by hand is reused). */
export function ensureGrantLedger(which: keyof typeof GRANT_LEDGERS): string {
  const spec = GRANT_LEDGERS[which];
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(spec.name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let code: number = spec.code;
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name: spec.name, group: spec.group }).id;
}

/* ── Maths (pure) ─────────────────────────────────────────────── */

const paise = (rupees: number) => Math.round(round2(rupees) * 100);
const dr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: amount, cr: 0 });
const cr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: 0, cr: amount });

/** Recognition journal lines (paise): Dr receivable | Cr grant income / asset / capital subsidy. */
export function recognitionLines(amount: number, l: { receivable: string; credit: string }): ManualVoucherLine[] {
  const p = paise(amount);
  return [dr(l.receivable, p), cr(l.credit, p)];
}
/** Receipt journal lines (paise): Dr bank | Cr receivable. */
export function receiptLines(amount: number, l: { receivable: string; bank: string }): ManualVoucherLine[] {
  const p = paise(amount);
  return [dr(l.bank, p), cr(l.receivable, p)];
}

export interface ClaimFigures {
  /** What is recognised (or approved, else claimed) once assurance is recorded. */
  recognisable: number;
  recognised: number;
  received: number;
  /** Recognised − received. */
  receivable: number;
  /** Claimed but not yet received (memo, before or after recognition). */
  pending: number;
  /** Days since the claim (claimed_on, else period end) while pending. */
  age: number;
  /** Pending past `INCENTIVE_RULES.pendingDays`. */
  bell: boolean;
}

export function claimFigures(c: IncentiveClaim, today: string): ClaimFigures {
  const recognisable = round2(num(c.approved) > 0 ? num(c.approved) : num(c.claimed));
  const recognised = round2(num(c.recognised));
  const received = round2(num(c.received));
  const pending = round2(Math.max(recognisable - received, 0));
  const from = c.claimed_on || c.period_to;
  const age = from ? Math.max(Math.round((Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000), 0) : 0;
  return { recognisable, recognised, received, receivable: round2(Math.max(recognised - received, 0)), pending, age, bell: pending > 0.005 && age > ruleAt(INCENTIVE_RULES, today).pendingDays };
}

/** Claims due a bell on `today` (pending past the limit). */
export const pendingClaims = (rows: readonly IncentiveClaim[], today: string) => rows.filter((r) => claimFigures(r, today).bell);

/** Suggested claim: eligible base × rate %. */
export const suggestedClaim = (base: unknown, ratePct: unknown) => round2((num(base) * num(ratePct)) / 100);

export function validateClaim(c: Pick<IncentiveClaim, 'scheme' | 'name' | 'period_from' | 'period_to' | 'claimed' | 'kind'>): string {
  if (!INCENTIVE_SCHEMES.includes(c.scheme)) return 'Pick the scheme.';
  if (!c.name.trim()) return 'Name the claim.';
  if (!isoDay(c.period_from) || !isoDay(c.period_to) || c.period_to < c.period_from) return 'Type the claim period.';
  if (!(num(c.claimed) > 0)) return 'Type the amount claimed.';
  if (c.kind !== 'income' && c.kind !== 'capital') return 'Pick income or capital grant.';
  return '';
}

/* ── Store ────────────────────────────────────────────────────── */

const TABLES = [INCENTIVE_CLAIMS_TABLE, 'vouchers', 'accounts'];

export const incentiveClaimsDb = {
  all: (): IncentiveClaim[] => getTable<IncentiveClaim>(INCENTIVE_CLAIMS_TABLE).filter((r) => r && typeof r.id === 'string'),

  save(input: Omit<IncentiveClaim, 'id' | 'voucher_ids'> & { id?: string }): IncentiveClaim {
    requireAccess('books.edit');
    const err = validateClaim(input);
    if (err) throw new Error(err);
    const rows = incentiveClaimsDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (prev) assertUnlocked({ issue_date: prev.period_to }, 'edit');
    assertUnlocked({ issue_date: input.period_to }, prev ? 'edit' : 'create');
    if (prev?.recognised_on && (input.kind !== prev.kind || round2(num(input.approved) || num(input.claimed)) !== round2(num(prev.approved) || num(prev.claimed)))) throw new Error('This claim is recognised in the books — its amount and kind can no longer change.');
    const now = new Date().toISOString();
    const row: IncentiveClaim = {
      ...prev, ...input, id: prev?.id ?? generateId(), claimed: round2(num(input.claimed)),
      // Recognition and receipt are set only by their own actions.
      recognised_on: prev?.recognised_on, recognised: prev?.recognised, received: prev?.received, received_on: prev?.received_on,
      voucher_ids: prev?.voucher_ids ?? [], created_at: prev?.created_at ?? now, updated_at: now,
    };
    setTable(INCENTIVE_CLAIMS_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },

  /** Delete (recycle bin); refused once a journal is posted. */
  remove(id: string): void {
    requireAccess('books.edit');
    const rows = incentiveClaimsDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (row.voucher_ids.length) throw new Error('Journals are posted for this claim — it can no longer be deleted.');
    assertUnlocked({ issue_date: row.period_to }, 'delete');
    setTable(INCENTIVE_CLAIMS_TABLE, rows.filter((r) => r.id !== id));
  },
};

function update(id: string, fn: (r: IncentiveClaim) => IncentiveClaim): IncentiveClaim {
  const rows = incentiveClaimsDb.all();
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error('Claim not found.');
  const next = { ...fn(row), updated_at: new Date().toISOString() };
  setTable(INCENTIVE_CLAIMS_TABLE, rows.map((r) => (r.id === id ? next : r)));
  return next;
}

/** Record reasonable assurance on `date` and post the recognition journal (once). */
export function recogniseClaim(id: string, date: string): IncentiveClaim {
  requireAccess('books.edit');
  if (!isoDay(date)) throw new Error('Type the date of reasonable assurance.');
  return withTablesRollback(TABLES, () => {
    const row = incentiveClaimsDb.all().find((r) => r.id === id);
    if (!row) throw new Error('Claim not found.');
    if (row.recognised_on) throw new Error('Already recognised.');
    const amount = claimFigures(row, date).recognisable;
    const credit = row.kind === 'income' ? ensureGrantLedger('income') : row.asset_account_id || ensureGrantLedger('capital');
    const v = saveVoucher({
      type: 'JOURNAL', date, voucher_class: GRANT_CLASS,
      narration: `${row.name} — grant recognised on reasonable assurance (Ind AS 20 / AS 12); verify with your CA (MF19)`,
      lines: recognitionLines(amount, { receivable: ensureGrantLedger('receivable'), credit }),
    });
    return update(id, (r) => ({ ...r, recognised_on: date, recognised: amount, voucher_ids: [...r.voucher_ids, v.id] }));
  });
}

/** Record money received (receipt journal). */
export function receiveClaim(id: string, amount: number, date: string): IncentiveClaim {
  requireAccess('books.edit');
  if (!(amount > 0) || !isoDay(date)) throw new Error('Type the amount and date received.');
  return withTablesRollback(TABLES, () => {
    const row = incentiveClaimsDb.all().find((r) => r.id === id);
    if (!row) throw new Error('Claim not found.');
    if (!row.recognised_on) throw new Error('Record reasonable assurance first (money received is itself assurance — use the same date).');
    const f = claimFigures(row, date);
    if (round2(f.received + amount) > f.recognised + 0.005) throw new Error('More than the amount recognised.');
    const v = saveVoucher({ type: 'RECEIPT', date, voucher_class: GRANT_CLASS, narration: `${row.name} — grant received`, lines: receiptLines(amount, { receivable: ensureGrantLedger('receivable'), bank: A.bank }) });
    return update(id, (r) => ({ ...r, received: round2(num(r.received) + amount), received_on: date, voucher_ids: [...r.voucher_ids, v.id] }));
  });
}
