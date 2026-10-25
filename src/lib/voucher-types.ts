/**
 * Voucher Types master (P1-13, Tally "Voucher Type Creation"): user voucher types under a base type —
 * "Sales – Retail", "Sales – Export", "Receipt – Cash" … — each with its own numbering (prefix / suffix /
 * starting number / yearly or monthly restart), default print title and template, default bank ledger
 * (receipt / payment / contra) or godown (sales / notes), and "use for POS".
 *
 * Table `voucher_types` (backed up, `TABLE_ACTIONS: master.edit`, every row change in the edit log).
 * The built-in default type of each base is implicit and never stored: a document or voucher without
 * `voucher_type_id` keeps the Indian-FY series `INV/FY25-26/0001` (Critical Rule 4). Numbering itself is
 * in the tiny `voucher-series.ts` so the save path can use it without loading this module.
 */
import { requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';
import { DOCUMENT_CODES } from '../types/invoice';
import {
  VOUCHER_TYPES_TABLE,
  baseOfDoc,
  typedNumber,
  type VoucherBase,
  type VoucherSeries,
} from './voucher-series';

export { VOUCHER_TYPES_TABLE, baseOfDoc, typedNumber, seriesPrefix, seriesTypeFor, recordTypedNumber } from './voucher-series';
export type { VoucherBase, VoucherSeries } from './voucher-series';

export const VOUCHER_BASES: readonly VoucherBase[] = ['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL'];

/** Built-in series prefix of each base (what a document without a user type is numbered with). */
export const BUILT_IN_PREFIX: Readonly<Record<VoucherBase, string>> = {
  SALES: DOCUMENT_CODES.INVOICE,
  CREDIT_NOTE: DOCUMENT_CODES.CREDIT_NOTE,
  DEBIT_NOTE: DOCUMENT_CODES.DEBIT_NOTE,
  RECEIPT: 'RV',
  PAYMENT: 'PV',
  CONTRA: 'CV',
  JOURNAL: 'JV',
};

/** Prefixes other series already use (vouchers, stock / purchase / payroll series): never a user type's prefix. */
const RESERVED_PREFIXES = new Set([
  ...Object.values(DOCUMENT_CODES), 'RV', 'PV', 'CV', 'JV', 'STR', 'PO', 'DN', 'GRN', 'RJO', 'RJI', 'PIS', 'ADV', 'RFV', 'RCPT', 'MFG', 'SJ', 'PHY',
  'JWO', 'JWC', 'JWR', 'JWP', 'PRL', 'PYP', 'LOAN', 'FNF', 'OPENING',
]);

export interface VoucherType extends VoucherSeries {
  name: string;
  /** Title printed on documents of this type (snapshotted on the document at save). */
  print_title?: string;
  /** Default template id for documents of this type. */
  template_id?: string;
  /** Default cash / bank ledger (account id) for receipt / payment / contra entry. */
  bank_account_id?: string;
  /** Default godown for sales / credit / debit notes. */
  godown_id?: string;
  /** Sales types only: POS bills are numbered in this type (one type at most). */
  use_for_pos?: boolean;
  created_at: string;
  updated_at?: string;
}

export type VoucherTypeInput = Omit<VoucherType, 'id' | 'created_at' | 'updated_at'> & { id?: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const PREFIX_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const SUFFIX_RE = /^[A-Z0-9-]{1,8}$/;

/** Tolerant read: malformed rows are dropped; text fields trimmed; numbering fields upper-cased. */
export function normalizeVoucherTypes(rows: readonly unknown[]): VoucherType[] {
  const out: VoucherType[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const base = o.base as VoucherBase;
    if (typeof o.id !== 'string' || !o.id || !VOUCHER_BASES.includes(base) || !str(o.name) || !str(o.prefix)) continue;
    const start = Math.floor(Number(o.start_number));
    const width = Math.floor(Number(o.width));
    out.push({
      id: o.id,
      name: str(o.name),
      base,
      prefix: str(o.prefix).toUpperCase(),
      ...(str(o.suffix) ? { suffix: str(o.suffix).toUpperCase() } : {}),
      ...(start > 1 ? { start_number: start } : {}),
      ...(width >= 1 && width <= 9 && width !== 4 ? { width } : {}),
      ...(o.restart === 'monthly' ? { restart: 'monthly' as const } : {}),
      ...(str(o.print_title) ? { print_title: str(o.print_title) } : {}),
      ...(str(o.template_id) ? { template_id: str(o.template_id) } : {}),
      ...(str(o.bank_account_id) ? { bank_account_id: str(o.bank_account_id) } : {}),
      ...(str(o.godown_id) ? { godown_id: str(o.godown_id) } : {}),
      ...(o.use_for_pos === true && base === 'SALES' ? { use_for_pos: true } : {}),
      ...(o.inactive === true ? { inactive: true } : {}),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export function loadVoucherTypes(): VoucherType[] {
  return normalizeVoucherTypes(getTable<unknown>(VOUCHER_TYPES_TABLE));
}

/** Active user types of a base, by name (the picker shows them only when this is non-empty). */
export function typesForBase(base: VoucherBase | undefined, all: readonly VoucherType[] = loadVoucherTypes(), keepId?: string): VoucherType[] {
  if (!base) return [];
  return all.filter((t) => t.base === base && (!t.inactive || t.id === keepId)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Types offered for a document type (sales types for INVOICE / TAX_INVOICE, note types for notes). */
export const typesForDoc = (docType: string | undefined, all?: readonly VoucherType[], keepId?: string) => typesForBase(baseOfDoc(docType), all, keepId);

/** The sales type POS bills are numbered in, if any. */
export function posVoucherType(all: readonly VoucherType[] = loadVoucherTypes()): VoucherType | undefined {
  return all.find((t) => t.base === 'SALES' && t.use_for_pos && !t.inactive);
}

/** Problems with a type (empty = it may be saved). */
export function validateVoucherType(input: VoucherTypeInput, others: readonly VoucherType[]): string[] {
  const errors: string[] = [];
  const name = str(input.name);
  const prefix = str(input.prefix).toUpperCase();
  const suffix = str(input.suffix).toUpperCase();
  const rest = others.filter((o) => o.id !== input.id);
  if (!name) errors.push('Enter a name for the voucher type.');
  else if (rest.some((o) => o.name.toLowerCase() === name.toLowerCase())) errors.push(`A voucher type named "${name}" already exists.`);
  if (!VOUCHER_BASES.includes(input.base)) errors.push('Choose the base voucher type.');
  if (!PREFIX_RE.test(prefix)) errors.push('Prefix: 1–12 capital letters, digits or hyphens (e.g. EXP or RET-B).');
  else if (RESERVED_PREFIXES.has(prefix) && !suffix) errors.push(`${prefix} is a built-in series: choose another prefix or add a suffix.`);
  if (suffix && !SUFFIX_RE.test(suffix)) errors.push('Suffix: up to 8 capital letters, digits or hyphens.');
  const key = `${prefix}|${suffix}`;
  if (prefix && rest.some((o) => `${o.prefix}|${o.suffix ?? ''}` === key)) errors.push('Another voucher type already numbers with this prefix and suffix.');
  const start = Number(input.start_number ?? 1);
  if (!Number.isInteger(start) || start < 1 || start > 99_999_999) errors.push('Starting number must be a whole number from 1.');
  const width = Number(input.width ?? 4);
  if (!Number.isInteger(width) || width < 1 || width > 9) errors.push('Number width: 1 to 9 digits.');
  if (input.restart !== undefined && input.restart !== 'yearly' && input.restart !== 'monthly') errors.push('Restart numbering yearly or monthly.');
  if (input.use_for_pos && input.base !== 'SALES') errors.push('Only a sales voucher type can be used for POS bills.');
  if (input.bank_account_id && !['RECEIPT', 'PAYMENT', 'CONTRA'].includes(input.base)) errors.push('A default bank applies to receipt, payment and contra types only.');
  if (input.godown_id && !['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(input.base)) errors.push('A default godown applies to sales and note types only.');
  return errors;
}

export class VoucherTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoucherTypeError';
  }
}

/** Create or alter a voucher type (role `master.edit`, audited). Marking it "use for POS" clears the flag elsewhere. */
export function saveVoucherType(input: VoucherTypeInput): VoucherType {
  requireAccess('master.edit');
  const all = loadVoucherTypes();
  const errors = validateVoucherType(input, all);
  if (errors.length) throw new VoucherTypeError(errors[0]);
  const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
  const now = new Date().toISOString();
  const [row] = normalizeVoucherTypes([{
    ...input,
    id: prev?.id ?? generateId(),
    restart: input.restart === 'monthly' ? 'monthly' : undefined,
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  }]);
  const next = (prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]).map((t) =>
    row.use_for_pos && t.id !== row.id && t.use_for_pos ? { ...t, use_for_pos: undefined, updated_at: now } : t,
  );
  setTable(VOUCHER_TYPES_TABLE, next.map(stripUndefined));
  audit.record({
    entity: 'settings',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    summary: `${prev ? 'Altered' : 'Created'} voucher type "${row.name}" (${row.base.toLowerCase().replace('_', ' ')}, numbers ${typedNumber(row, undefined, [], 0)})`,
  });
  return row;
}

/** Documents / vouchers numbered in a type (a used type can be made inactive, not deleted). */
export function voucherTypeUsage(id: string): number {
  const docs = getTable<{ voucher_type_id?: string }>('invoices').filter((d) => d?.voucher_type_id === id).length;
  const vch = getTable<{ voucher_type_id?: string }>('vouchers').filter((v) => v?.voucher_type_id === id).length;
  return docs + vch;
}

export function deleteVoucherType(id: string): void {
  requireAccess('master.edit');
  const all = loadVoucherTypes();
  const row = all.find((t) => t.id === id);
  if (!row) return;
  const used = voucherTypeUsage(id);
  if (used) throw new VoucherTypeError(`"${row.name}" numbers ${used} saved document${used === 1 ? '' : 's'} or voucher${used === 1 ? '' : 's'}: mark it inactive instead.`);
  setTable(VOUCHER_TYPES_TABLE, all.filter((t) => t.id !== id).map(stripUndefined));
  audit.record({ entity: 'settings', entity_id: id, action: 'delete', summary: `Deleted voucher type "${row.name}"` });
}

function stripUndefined<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

/**
 * What choosing a type in the invoice editor changes on the draft: the type id, and its default
 * template / godown / print title. Choosing the default type (undefined) clears the id and title.
 */
export function documentDefaults(t: VoucherType | undefined): { voucher_type_id?: string; print_title?: string; template_id?: string; godown_id?: string } {
  if (!t) return { voucher_type_id: undefined, print_title: undefined };
  return {
    voucher_type_id: t.id,
    print_title: t.print_title || undefined,
    ...(t.template_id ? { template_id: t.template_id } : {}),
    ...(t.godown_id ? { godown_id: t.godown_id } : {}),
  };
}

/** Example numbers for the master form: first number and, for a monthly type, May's. */
export function numberingExample(t: Pick<VoucherSeries, 'prefix' | 'suffix' | 'start_number' | 'width' | 'restart'>, date: string): string {
  const s: VoucherSeries = { id: '', base: 'SALES', ...t, prefix: str(t.prefix).toUpperCase() || 'X', suffix: str(t.suffix).toUpperCase() || undefined };
  return typedNumber(s, date, [], 0);
}
