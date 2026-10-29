/**
 * Bank rules + memory (8.45) — the Zoho Books "banking rules" / Xero "bank rules + JAX suggestions"
 * pattern for imported bank statements. Pure matching here; writes are in `bank-rules-apply.ts`.
 *
 * A rule (table `bank_rules`) has conditions joined by ALL / ANY — narration contains / starts with /
 * regex (length-capped, no nested quantifiers or back-references), counterparty token, amount range,
 * debit / credit, bank account — and one action: record an expense (category, supplier, GST rate +
 * ITC, e.g. bank charges at 18% with ITC, cost centre, branch, mode), post a payment / receipt voucher
 * to a ledger, receive against a customer's open invoices, mark a contra transfer, or ignore.
 *
 * Suggestions run AFTER invoice matching: a line that already has a Match suggestion (or is matched /
 * ignored) gets none. Every suggestion says where it came from — 'rule' or 'memory' (the screen shows
 * the engine's matches as 'match'). Memory is derived, never stored: the counterparty token of every
 * debit line that was matched to a paid expense teaches "this token → this expense head / supplier /
 * GST rate", so a manual categorisation is remembered with no extra step. 8.46: `buildActionMemory` adds the same for
 * credits received against a customer's invoices (token → receipt from that customer) and for lines posted as a
 * payment / receipt voucher (token → voucher to that ledger), read back from the matched receipts / voucher numbers.
 */

import type { BankLine, BankStatement } from './bank-recon';
import { guessCounterparty, nameTokens } from './bank-recon';
import type { PayMode } from './bank-recon';
import type { PurchaseRecord } from '../types/purchases';
import { requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';

export const BANK_RULES_TABLE = 'bank_rules';
export const MAX_RULE_TEXT = 120;
const MAX_NARRATION = 500;

export type RuleCondition =
  | { kind: 'contains'; text: string }
  | { kind: 'starts'; text: string }
  | { kind: 'regex'; pattern: string }
  | { kind: 'counterparty'; token: string }
  | { kind: 'amount'; min?: number; max?: number }
  | { kind: 'direction'; dir: 'debit' | 'credit' }
  | { kind: 'account'; bankAccountId: string };

export type RuleActionKind = 'expense' | 'voucher' | 'receipt' | 'contra' | 'ignore';

export interface RuleAction {
  kind: RuleActionKind;
  /** expense: expense head (`PURCHASE_CATEGORIES`). */
  category?: string;
  /** voucher: ledger account id; contra: the other cash / bank ledger. */
  ledger_id?: string;
  vendor_id?: string;
  vendor_name?: string;
  /** receipt: customer whose open invoices the credit settles (oldest first). */
  client_id?: string;
  mode?: PayMode;
  /** expense: GST slab included in the amount (0 = none) and whether ITC is claimed. */
  gst_rate?: number;
  itc?: boolean;
  cost_centre_id?: string;
  branch_id?: string;
}

export interface BankRule {
  id: string;
  name: string;
  match: 'all' | 'any';
  conditions: RuleCondition[];
  action: RuleAction;
  /** Lower runs first. */
  priority: number;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export type SuggestionSource = 'rule' | 'memory';

export interface RuleSuggestion {
  lineId: string;
  source: SuggestionSource;
  action: RuleAction;
  ruleId?: string;
  /** Rule name, or the remembered token. */
  label: string;
  /** Memory: how many past lines taught it. */
  count?: number;
}

export interface MatchContext {
  /** Bank account id of a line's statement ('' / undefined = the main account). */
  accountOf: (lineId: string) => string | undefined;
}

/* ── Conditions ─────────────────────────────────────────────────── */

const cut = (s: string) => String(s ?? '').slice(0, MAX_NARRATION);

/**
 * Compile a user regex safely, or null: at most 120 characters, no back-references, no lookbehind and
 * no quantified group that itself contains a quantifier or an alternation (the catastrophic-backtracking shapes).
 * Always case-insensitive; narrations are capped at 500 characters before testing.
 */
export function safeRegex(pattern: string): RegExp | null {
  const p = String(pattern ?? '');
  if (!p || p.length > MAX_RULE_TEXT) return null;
  if (/\\[1-9]|\\k<|\(\?<[=!]/.test(p)) return null;
  if (/\([^)]*(?:[*+?}]|\|)[^)]*\)\s*[*+{?]/.test(p)) return null;
  try {
    return new RegExp(p, 'i');
  } catch {
    return null;
  }
}

/** Significant counterparty token of a narration ("UPI-BHARAT TRADERS-…" → "BHARAT TRADERS"), '' if none. */
export function counterpartyToken(narration: string): string {
  return nameTokens(guessCounterparty(cut(narration))).slice(0, 2).join(' ');
}

const amountOf = (l: Pick<BankLine, 'debit' | 'credit'>) => (l.credit > 0 ? l.credit : l.debit);

export function conditionMatches(c: RuleCondition, line: BankLine, ctx: MatchContext): boolean {
  const text = cut(`${line.narration} ${line.ref}`).toUpperCase();
  switch (c.kind) {
    case 'contains':
      return !!c.text.trim() && text.includes(c.text.trim().toUpperCase().slice(0, MAX_RULE_TEXT));
    case 'starts':
      return !!c.text.trim() && cut(line.narration).trim().toUpperCase().startsWith(c.text.trim().toUpperCase().slice(0, MAX_RULE_TEXT));
    case 'regex': {
      const re = safeRegex(c.pattern);
      return !!re && re.test(cut(line.narration));
    }
    case 'counterparty': {
      const want = c.token.trim().toUpperCase();
      return !!want && (counterpartyToken(line.narration) === want || ` ${text.replace(/[^A-Z0-9]+/g, ' ')} `.includes(` ${want} `));
    }
    case 'amount': {
      const a = amountOf(line);
      const min = Number(c.min);
      const max = Number(c.max);
      return (!(c.min !== undefined && Number.isFinite(min)) || a >= min - 0.004) && (!(c.max !== undefined && Number.isFinite(max)) || a <= max + 0.004);
    }
    case 'direction':
      return c.dir === 'credit' ? line.credit > 0 : line.debit > 0;
    case 'account':
      return (ctx.accountOf(line.id) || 'default') === (c.bankAccountId || 'default');
    default:
      return false;
  }
}

/** Does the action fit the line's direction? (an expense needs a debit, a receipt a credit). */
export function actionFits(action: RuleAction, line: Pick<BankLine, 'debit' | 'credit'>): boolean {
  if (action.kind === 'expense') return line.debit > 0;
  if (action.kind === 'receipt') return line.credit > 0;
  return line.debit > 0 || line.credit > 0;
}

export function ruleMatches(rule: BankRule, line: BankLine, ctx: MatchContext): boolean {
  if (!rule.active || !rule.conditions.length || !actionFits(rule.action, line)) return false;
  return rule.match === 'any' ? rule.conditions.some((c) => conditionMatches(c, line, ctx)) : rule.conditions.every((c) => conditionMatches(c, line, ctx));
}

/* ── Memory ─────────────────────────────────────────────────────── */

export interface MemoryEntry {
  token: string;
  category: string;
  vendor_id?: string;
  vendor_name: string;
  gst_rate: number;
  itc: boolean;
  count: number;
  last: string;
}

/**
 * Learn token → expense head from past categorisations: debit lines matched to payments of an
 * expense. The most frequent head per token wins (latest on a tie).
 */
export function buildMemory(
  statements: readonly BankStatement[],
  purchases: readonly Pick<PurchaseRecord, 'id' | 'kind' | 'category' | 'vendor_id' | 'vendor_name' | 'lines' | 'itc_eligible' | 'status'>[],
  payments: readonly { id?: string; purchase_id?: string }[],
): Map<string, MemoryEntry> {
  const bill = new Map(purchases.map((p) => [p.id, p]));
  const payTo = new Map<string, string>();
  for (const p of payments) if (p?.id && p.purchase_id) payTo.set(String(p.id), String(p.purchase_id));
  const tally = new Map<string, Map<string, MemoryEntry>>();
  for (const st of statements) {
    for (const l of st.lines) {
      if (!(l.debit > 0) || l.matched_to?.type !== 'purchase_payment') continue;
      const id = l.matched_to.id ?? l.matched_to.ids?.[0];
      const p = id ? bill.get(payTo.get(id) ?? '') : undefined;
      if (!p || p.kind !== 'EXPENSE' || p.status === 'draft') continue;
      const token = counterpartyToken(l.narration);
      if (!token) continue;
      const key = `${p.category}|${p.vendor_id ?? p.vendor_name}`;
      const byHead = tally.get(token) ?? new Map<string, MemoryEntry>();
      const prev = byHead.get(key);
      const rate = p.lines?.length === 1 ? Number(p.lines[0].tax_rate) || 0 : 0;
      byHead.set(key, {
        token,
        category: p.category,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_name,
        gst_rate: rate,
        itc: p.itc_eligible !== false && rate > 0,
        count: (prev?.count ?? 0) + 1,
        last: prev && prev.last > l.date ? prev.last : l.date,
      });
      tally.set(token, byHead);
    }
  }
  const out = new Map<string, MemoryEntry>();
  for (const [token, heads] of tally) {
    const best = [...heads.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))[0];
    if (best) out.set(token, best);
  }
  return out;
}

/** 8.46: a remembered receipt / voucher action, keyed `D|token` (debit) or `C|token` (credit). */
export interface ActionMemory {
  action: RuleAction;
  count: number;
  last: string;
}

type VoucherLike = { number?: string; type?: string; lines?: readonly { account_id?: string; party?: string }[] };

/**
 * Learn token → receipt / voucher from past lines: a credit matched to receipts of a customer's invoices (or an
 * on-account receipt of the party) teaches "receipt from that customer"; a line posted as a payment / receipt voucher
 * (its note starts with the voucher number) teaches "voucher to that ledger" when the voucher has one other ledger.
 * The most frequent action per token and direction wins (latest on a tie). Pure.
 */
export function buildActionMemory(
  statements: readonly BankStatement[],
  receipts: readonly { id?: string; invoice_id?: string; client_id?: string }[],
  invoices: readonly { id: string; client?: { id?: string } }[],
  vouchers: readonly VoucherLike[],
  isBankLedger: (id: string) => boolean,
): Map<string, ActionMemory> {
  const clientOfInv = new Map(invoices.map((i) => [i.id, i.client?.id ?? '']));
  const clientOfPay = new Map(receipts.filter((p) => p?.id).map((p) => [String(p.id), p.client_id || clientOfInv.get(p.invoice_id ?? '') || '']));
  const byNo = new Map(vouchers.filter((v) => v?.number).map((v) => [v.number!, v]));
  const tally = new Map<string, Map<string, ActionMemory>>();
  for (const st of statements) {
    for (const l of st.lines) {
      const m = l.matched_to;
      const token = m ? counterpartyToken(l.narration) : '';
      if (!token) continue;
      let action: RuleAction | null = null;
      if (m!.type === 'payment' && l.credit > 0) {
        const client = [m!.id, ...(m!.ids ?? [])].map((id) => clientOfPay.get(id ?? '')).find(Boolean);
        if (client) action = { kind: 'receipt', client_id: client };
      } else if (m!.type === 'manual' && l.note) {
        const v = byNo.get(l.note.trim().split(/\s+/)[0]);
        const others = v && (v.type === 'PAYMENT' || v.type === 'RECEIPT') ? (v.lines ?? []).filter((x) => x.account_id && !isBankLedger(x.account_id)) : [];
        if (others.length && new Set(others.map((x) => x.account_id)).size === 1) action = { kind: 'voucher', ledger_id: others[0].account_id, ...(others[0].party ? { vendor_name: others[0].party } : {}) };
      }
      if (!action) continue;
      const key = `${l.credit > 0 ? 'C' : 'D'}|${token}`;
      const sub = `${action.kind}|${action.client_id ?? action.ledger_id}`;
      const per = tally.get(key) ?? new Map<string, ActionMemory>();
      const prev = per.get(sub);
      per.set(sub, { action, count: (prev?.count ?? 0) + 1, last: prev && prev.last > l.date ? prev.last : l.date });
      tally.set(key, per);
    }
  }
  const out = new Map<string, ActionMemory>();
  for (const [key, per] of tally) out.set(key, [...per.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))[0]);
  return out;
}

/* ── Suggestions ────────────────────────────────────────────────── */

/**
 * Rule and memory suggestions for open lines. `skip` = lines that are matched / ignored or already
 * carry a Match suggestion from invoice matching (rules run after it). First matching rule wins
 * (priority, then oldest); memory only for lines no rule caught.
 */
export function suggestCategorisations(
  lines: readonly BankLine[],
  rules: readonly BankRule[],
  memory: ReadonlyMap<string, MemoryEntry>,
  ctx: MatchContext,
  skip: ReadonlySet<string> = new Set(),
  actions: ReadonlyMap<string, ActionMemory> = new Map(),
): RuleSuggestion[] {
  const ordered = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  const out: RuleSuggestion[] = [];
  for (const line of lines) {
    if (skip.has(line.id) || line.ignored || line.matched_to) continue;
    const rule = ordered.find((r) => ruleMatches(r, line, ctx));
    if (rule) {
      out.push({ lineId: line.id, source: 'rule', action: rule.action, ruleId: rule.id, label: rule.name });
      continue;
    }
    const token = counterpartyToken(line.narration);
    const am = token ? actions.get(`${line.credit > 0 ? 'C' : 'D'}|${token}`) : undefined;
    const m = token && line.debit > 0 ? memory.get(token) : undefined;
    if (!m && am) out.push({ lineId: line.id, source: 'memory', label: token, count: am.count, action: am.action });
    if (m) {
      out.push({
        lineId: line.id,
        source: 'memory',
        label: token,
        count: m.count,
        action: { kind: 'expense', category: m.category, vendor_id: m.vendor_id, vendor_name: m.vendor_name, gst_rate: m.gst_rate, itc: m.itc },
      });
    }
  }
  return out;
}

/** A rule pre-filled from a line just categorised by hand ("Create rule for similar lines?"). */
export function ruleDraftFromLine(line: BankLine, action: RuleAction, bankAccountId?: string): Omit<BankRule, 'id' | 'created_at'> {
  const token = counterpartyToken(line.narration);
  const firstWord = cut(line.narration).toUpperCase().split(/[^A-Z]+/).find((w) => w.length >= 4) ?? '';
  const conditions: RuleCondition[] = [token ? { kind: 'counterparty', token } : { kind: 'contains', text: firstWord }, { kind: 'direction', dir: line.credit > 0 ? 'credit' : 'debit' }];
  if (bankAccountId && bankAccountId !== 'default') conditions.push({ kind: 'account', bankAccountId });
  const who = token ? token.charAt(0) + token.slice(1).toLowerCase() : firstWord || 'Bank line';
  return { name: `${who} → ${action.category || action.kind}`.slice(0, 80), match: 'all', conditions, action, priority: 100, active: true };
}

/* ── Storage ────────────────────────────────────────────────────── */

/** Problems with a rule ('' = fine). */
export function validateRule(r: Pick<BankRule, 'name' | 'conditions' | 'action'>): string {
  if (!r.name.trim()) return 'Give the rule a name.';
  if (!r.conditions.length) return 'Add at least one condition.';
  for (const c of r.conditions) {
    if ((c.kind === 'contains' || c.kind === 'starts') && !c.text.trim()) return 'A text condition is empty.';
    if ((c.kind === 'contains' || c.kind === 'starts') && c.text.length > MAX_RULE_TEXT) return `Text conditions can be up to ${MAX_RULE_TEXT} characters.`;
    if (c.kind === 'regex' && !safeRegex(c.pattern)) return 'That pattern is not allowed (too long, invalid, or it could run very slowly).';
    if (c.kind === 'counterparty' && !c.token.trim()) return 'The counterparty condition is empty.';
    if (c.kind === 'amount' && c.min !== undefined && c.max !== undefined && Number(c.min) > Number(c.max)) return 'The amount range is reversed.';
  }
  const a = r.action;
  if (a.kind === 'expense' && !a.category) return 'Choose the expense head.';
  if ((a.kind === 'voucher' || a.kind === 'contra') && !a.ledger_id) return 'Choose the ledger.';
  if (a.kind === 'receipt' && !a.client_id) return 'Choose the customer.';
  if (a.gst_rate !== undefined && !(a.gst_rate >= 0 && a.gst_rate <= 40)) return 'GST rate must be between 0 and 40%.';
  return '';
}

export function readRules(rows: unknown[]): BankRule[] {
  return rows.filter((r): r is BankRule => !!r && typeof r === 'object' && typeof (r as BankRule).id === 'string' && Array.isArray((r as BankRule).conditions) && !!(r as BankRule).action);
}

export const rulesDb = {
  all: (): BankRule[] => readRules(getTable<unknown>(BANK_RULES_TABLE)),
  save(input: Omit<BankRule, 'id' | 'created_at'> & { id?: string }): BankRule {
    requireAccess('books.edit');
    const problem = validateRule(input);
    if (problem) throw new Error(problem);
    const rows = rulesDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const row: BankRule = {
      ...prev,
      ...input,
      id: prev?.id ?? generateId(),
      name: input.name.trim().slice(0, 80),
      created_at: prev?.created_at ?? new Date().toISOString(),
      ...(prev ? { updated_at: new Date().toISOString() } : {}),
    };
    setTable(BANK_RULES_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    try {
      audit.record({ entity: 'settings', entity_id: `bank_rule:${row.id}`, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Created'} bank rule "${row.name}"` });
    } catch {
      /* logging never blocks */
    }
    return row;
  },
  remove(id: string): void {
    requireAccess('books.edit');
    const row = rulesDb.all().find((r) => r.id === id);
    if (!row) return;
    setTable(BANK_RULES_TABLE, rulesDb.all().filter((r) => r.id !== id));
    try {
      audit.record({ entity: 'settings', entity_id: `bank_rule:${id}`, action: 'delete', summary: `Deleted bank rule "${row.name}"` });
    } catch {
      /* logging never blocks */
    }
  },
};
