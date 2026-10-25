/**
 * Migration from Tally (WP-7, gap P0-7): read a Tally XML export, map it onto this app's masters
 * and build a dry-run plan. Pure — the storage side is `tally-import-apply.ts`.
 *
 * What is read (`ENVELOPE/BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE` or `…/DATA/TALLYMESSAGE`):
 *  - GROUP     → user groups / sub-groups (WP-1 `groups`) under the matching Schedule III primary;
 *                Tally's reserved groups map onto the primaries and are not created.
 *  - LEDGER    → chart accounts, or clients (under Sundry Debtors) / vendors (Sundry Creditors), with
 *                GSTIN, state, PAN, credit period; opening balance (Tally: negative = Dr) and bill-wise
 *                opening bills (`BILLALLOCATIONS.LIST`).
 *  - STOCKITEM / UNIT / GODOWN → stock items with opening quantity and value, godowns.
 *  - VOUCHER   → Sales, Purchase, Receipt, Payment, Journal, Contra, Credit / Debit Note (custom types
 *                resolved through VOUCHERTYPE masters). Every voucher becomes a MANUAL voucher
 *                (Contra / Payment / Receipt keep their type, the rest are journals) — never an
 *                invoice or a bill, so nothing imported can leak into GSTR-1 / 3B, e-invoice or
 *                numbering working papers.
 *
 * Re-import: groups, ledgers and parties are matched by name (parties also by GSTIN); vouchers by a
 * fingerprint tag `[tally:xxxxxxxx]` kept in the narration (Tally GUID, else type + date + number +
 * amount), so importing the same Day Book twice adds nothing.
 *
 * Working papers — verify with your CA. The opening trial balance after import should match Tally's
 * to the paisa; the plan reports any difference instead of forcing it.
 */

import { A, GROUPS, type Account, type PrimaryGroupId, type UserGroup } from './ledger/accounts';
import { validateVoucher, type ManualVoucherInput, type ManualVoucherLine, type ManualVoucherType } from './ledger/vouchers';
import { sha256 } from './sha256';
import { resolveStateCode } from './india-states';
import { isValidGstin } from './gstin';
import { findAll, kid, kids, textOf, type XmlNode, type XmlParser, parseXmlLite, TallyXmlError } from './tally-xml-read';

export { TallyXmlError };

/* ── Parsed records ───────────────────────────────────────────── */

export type TallyBaseType =
  | 'Sales' | 'Purchase' | 'Receipt' | 'Payment' | 'Journal' | 'Contra' | 'Credit Note' | 'Debit Note'
  | 'Stock Journal' | 'Memorandum' | 'Other';

const BASE_TYPES: readonly TallyBaseType[] = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Credit Note', 'Debit Note', 'Stock Journal', 'Memorandum'];

export interface TallyGroupRec {
  name: string;
  /** '' for a primary group. */
  parent: string;
}

export interface TallyBillRec {
  ref: string;
  date: string;
  /** Debit-positive paise. */
  paise: number;
  creditDays?: number;
}

export interface TallyLedgerRec {
  name: string;
  alias?: string;
  parent: string;
  /** Debit-positive paise (Tally writes debit as negative; flipped here). */
  opening: number;
  gstin?: string;
  stateName?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: string;
  pincode?: string;
  creditDays?: number;
  billwise: boolean;
  bills: TallyBillRec[];
}

export interface TallyStockItemRec {
  name: string;
  parent?: string;
  unit: string;
  hsn?: string;
  gstRate?: number;
  openingQty: number;
  /** Positive paise. */
  openingValue: number;
}

export interface TallyLineRec {
  ledger: string;
  /** Debit-positive paise. */
  paise: number;
  costCentres: Array<{ name: string; paise: number }>;
}

export interface TallyVoucherRec {
  guid: string;
  /** Voucher type as written in the file (may be a custom type, e.g. "Sales GST"). */
  vtype: string;
  base: TallyBaseType;
  date: string;
  number: string;
  narration: string;
  party: string;
  reference: string;
  cancelled: boolean;
  optional: boolean;
  postDated: boolean;
  lines: TallyLineRec[];
  /** Had inventory entries (quantity) — imported for their accounting effect only. */
  hasInventory: boolean;
}

export interface TallyParsed {
  company: string;
  groups: TallyGroupRec[];
  ledgers: TallyLedgerRec[];
  stockItems: TallyStockItemRec[];
  units: string[];
  godowns: string[];
  vouchers: TallyVoucherRec[];
  warnings: string[];
}

/* ── Value readers ────────────────────────────────────────────── */

/** Tally amount text → signed paise (as written: debit negative). Forex "… = ₹ 8200.00" takes the rupee part. */
export function tallyPaise(text: string): number {
  let t = String(text ?? '').trim();
  if (!t) return 0;
  const eq = t.lastIndexOf('=');
  if (eq >= 0) t = t.slice(eq + 1);
  const neg = /^\s*\(?\s*-/.test(t) || /\bDr\b/i.test(t);
  const digits = t.replace(/[^0-9.]/g, '');
  if (!digits || !/^\d*\.?\d*$/.test(digits)) return 0;
  const [whole, frac = ''] = digits.split('.');
  const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac.charAt(2) || '0') >= 5 ? 1 : 0);
  return neg ? -paise : paise;
}

/** "10 Nos" / "10.500 kg" → 10 / 10.5; unit returned separately. */
function qtyOf(text: string): { qty: number; unit: string } {
  const m = /(-?[\d,]*\.?\d+)\s*(.*)$/.exec(String(text ?? '').trim());
  if (!m) return { qty: 0, unit: '' };
  return { qty: Math.abs(Number(m[1].replace(/,/g, '')) || 0), unit: m[2].trim() };
}

/** YYYYMMDD → YYYY-MM-DD (a real calendar day) or ''. Parsed as a local day, never via Date(string). */
export function tallyDay(text: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(text ?? '').trim()) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const yes = (s: string) => /^yes$/i.test(s.trim());
/** Tally writes a primary group's / ledger's parent as "Primary" (after the `&#4;` marker is removed). */
const parentOf = (n: XmlNode) => {
  const p = textOf(n, 'PARENT');
  return /^primary$/i.test(p) ? '' : p;
};
const nameOf = (n: XmlNode) => (n.attrs.NAME ?? '').trim() || textOf(n, 'NAME') || (kid(kid(kid(n, 'LANGUAGENAME.LIST'), 'NAME.LIST'), 'NAME')?.text ?? '').trim();

function aliasOf(n: XmlNode, name: string): string | undefined {
  const names = kids(kid(kid(n, 'LANGUAGENAME.LIST'), 'NAME.LIST'), 'NAME').map((x) => x.text.trim()).filter(Boolean);
  return names.find((x) => x !== name);
}

function creditDaysOf(text: string): number | undefined {
  const m = /(\d+)/.exec(text ?? '');
  return m ? Number(m[1]) : undefined;
}

function readLedger(n: XmlNode): TallyLedgerRec | null {
  const name = nameOf(n);
  if (!name) return null;
  const gstDetails = kids(n, 'LEDGSTREGDETAILS.LIST').pop();
  const mailing = kids(n, 'LEDMAILINGDETAILS.LIST').pop();
  const addrNode = kid(mailing, 'ADDRESS.LIST') ?? kid(n, 'ADDRESS.LIST');
  const address = kids(addrNode, 'ADDRESS').map((a) => a.text.trim()).filter(Boolean).join(', ');
  const gstin = (textOf(n, 'PARTYGSTIN') || textOf(gstDetails, 'GSTIN')).toUpperCase();
  const bills: TallyBillRec[] = [];
  for (const b of kids(n, 'BILLALLOCATIONS.LIST')) {
    const ref = textOf(b, 'NAME');
    const paise = -tallyPaise(textOf(b, 'OPENINGBALANCE') || textOf(b, 'AMOUNT'));
    if (!ref || !paise) continue;
    bills.push({ ref, date: tallyDay(textOf(b, 'BILLDATE')), paise, ...(creditDaysOf(textOf(b, 'BILLCREDITPERIOD')) ? { creditDays: creditDaysOf(textOf(b, 'BILLCREDITPERIOD')) } : {}) });
  }
  const credit = creditDaysOf(textOf(n, 'BILLCREDITPERIOD'));
  const rec: TallyLedgerRec = {
    name,
    parent: parentOf(n),
    opening: -tallyPaise(textOf(n, 'OPENINGBALANCE')),
    billwise: yes(textOf(n, 'ISBILLWISEON')),
    bills,
  };
  const alias = aliasOf(n, name);
  if (alias) rec.alias = alias;
  if (gstin) rec.gstin = gstin;
  const state = textOf(n, 'LEDSTATENAME') || textOf(mailing, 'STATE') || textOf(n, 'STATENAME');
  if (state) rec.stateName = state;
  const pan = textOf(n, 'INCOMETAXNUMBER');
  if (pan) rec.pan = pan.toUpperCase();
  const email = textOf(n, 'EMAIL');
  if (email) rec.email = email;
  const phone = textOf(n, 'LEDGERMOBILE') || textOf(n, 'LEDGERPHONE');
  if (phone) rec.phone = phone;
  if (address) rec.address = address;
  const pin = textOf(mailing, 'PINCODE') || textOf(n, 'PINCODE');
  if (pin) rec.pincode = pin;
  if (credit) rec.creditDays = credit;
  return rec;
}

function readStockItem(n: XmlNode): TallyStockItemRec | null {
  const name = nameOf(n);
  if (!name) return null;
  const { qty, unit } = qtyOf(textOf(n, 'OPENINGBALANCE'));
  const hsnNode = kids(n, 'HSNDETAILS.LIST').pop() ?? kids(n, 'GSTDETAILS.LIST').pop();
  const hsn = textOf(hsnNode, 'HSNCODE') || textOf(n, 'GSTHSNCODE');
  let gstRate: number | undefined;
  for (const g of kids(n, 'GSTDETAILS.LIST')) {
    for (const s of kids(g, 'STATEWISEDETAILS.LIST')) {
      for (const r of kids(s, 'RATEDETAILS.LIST')) {
        if (/integrated/i.test(textOf(r, 'GSTRATEDUTYHEAD'))) {
          const v = Number(textOf(r, 'GSTRATE'));
          if (Number.isFinite(v)) gstRate = v;
        }
      }
    }
  }
  return {
    name,
    ...(textOf(n, 'PARENT') ? { parent: textOf(n, 'PARENT') } : {}),
    unit: textOf(n, 'BASEUNITS') || unit || 'Nos',
    ...(hsn ? { hsn } : {}),
    ...(gstRate !== undefined ? { gstRate } : {}),
    openingQty: qty,
    openingValue: Math.abs(tallyPaise(textOf(n, 'OPENINGVALUE'))),
  };
}

function readLines(v: XmlNode): TallyLineRec[] {
  const out: TallyLineRec[] = [];
  const take = (e: XmlNode) => {
    const ledger = textOf(e, 'LEDGERNAME');
    const signed = tallyPaise(textOf(e, 'AMOUNT'));
    if (!ledger || !signed) return;
    const costCentres: TallyLineRec['costCentres'] = [];
    for (const cat of kids(e, 'CATEGORYALLOCATIONS.LIST')) {
      for (const cc of kids(cat, 'COSTCENTREALLOCATIONS.LIST')) {
        const name = textOf(cc, 'NAME');
        const p = Math.abs(tallyPaise(textOf(cc, 'AMOUNT')));
        if (name && p) costCentres.push({ name, paise: p });
      }
    }
    out.push({ ledger, paise: -signed, costCentres });
  };
  for (const tag of ['ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST']) kids(v, tag).forEach(take);
  for (const tag of ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST']) {
    for (const inv of kids(v, tag)) kids(inv, 'ACCOUNTINGALLOCATIONS.LIST').forEach(take);
  }
  return out;
}

function baseTypeOf(vtype: string, parents: Map<string, string>): TallyBaseType {
  let t = vtype;
  for (let hop = 0; hop < 10; hop++) {
    const exact = BASE_TYPES.find((b) => b.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    const p = parents.get(t.toLowerCase());
    if (!p) break;
    t = p;
  }
  // Custom type without its master in the file: guess from the name ("Sales GST", "Bank Payment").
  const l = vtype.toLowerCase();
  if (/credit\s*note/.test(l)) return 'Credit Note';
  if (/debit\s*note/.test(l)) return 'Debit Note';
  if (/stock\s*journal/.test(l)) return 'Stock Journal';
  if (/contra/.test(l)) return 'Contra';
  if (/receipt/.test(l)) return 'Receipt';
  if (/payment/.test(l)) return 'Payment';
  if (/purchase/.test(l)) return 'Purchase';
  if (/sales|invoice/.test(l)) return 'Sales';
  if (/journal/.test(l)) return 'Journal';
  if (/memo/.test(l)) return 'Memorandum';
  return 'Other';
}

const MASTER_TAGS = new Set(['GROUP', 'LEDGER', 'STOCKITEM', 'STOCKGROUP', 'UNIT', 'GODOWN', 'VOUCHER', 'VOUCHERTYPE', 'COSTCENTRE', 'CURRENCY', 'COMPANY']);

/** Parse a Tally XML export (text) into records. `parse` defaults to the built-in safe parser. */
export function parseTallyXml(text: string, parse: XmlParser = parseXmlLite): TallyParsed {
  const root = parse(text);
  const envelope = findAll(root, new Set(['ENVELOPE']))[0];
  if (!envelope) throw new TallyXmlError('This is not a Tally XML export (no ENVELOPE). In Tally, export with Format: XML (Data Interchange).');
  const els = findAll(envelope, MASTER_TAGS);
  const parsed: TallyParsed = { company: '', groups: [], ledgers: [], stockItems: [], units: [], godowns: [], vouchers: [], warnings: [] };
  parsed.company = (findAll(envelope, new Set(['SVCURRENTCOMPANY']))[0]?.text ?? '').trim();
  const vtypeParents = new Map<string, string>();
  for (const e of els) if (e.name === 'VOUCHERTYPE') {
    const n = nameOf(e);
    const p = textOf(e, 'PARENT');
    if (n && p && n.toLowerCase() !== p.toLowerCase()) vtypeParents.set(n.toLowerCase(), p);
  }
  const seenLedgers = new Set<string>();
  for (const e of els) {
    if (e.name === 'GROUP') {
      const name = nameOf(e);
      if (name) parsed.groups.push({ name, parent: parentOf(e) });
    } else if (e.name === 'LEDGER') {
      const l = readLedger(e);
      if (l && !seenLedgers.has(l.name.toLowerCase())) {
        seenLedgers.add(l.name.toLowerCase());
        parsed.ledgers.push(l);
      }
    } else if (e.name === 'STOCKITEM') {
      const s = readStockItem(e);
      if (s) parsed.stockItems.push(s);
    } else if (e.name === 'UNIT') {
      const u = nameOf(e);
      if (u) parsed.units.push(u);
    } else if (e.name === 'GODOWN') {
      const g = nameOf(e);
      if (g) parsed.godowns.push(g);
    } else if (e.name === 'VOUCHER') {
      const vtype = (e.attrs.VCHTYPE ?? '').trim() || textOf(e, 'VOUCHERTYPENAME');
      const date = tallyDay(textOf(e, 'DATE'));
      const number = textOf(e, 'VOUCHERNUMBER');
      if (!date) {
        parsed.warnings.push(`A ${vtype || 'voucher'} ${number} has no readable date and was left out.`);
        continue;
      }
      const hasInventory = ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST', 'INVENTORYENTRIESIN.LIST', 'INVENTORYENTRIESOUT.LIST'].some((t) => kids(e, t).length > 0);
      parsed.vouchers.push({
        guid: textOf(e, 'GUID'),
        vtype: vtype || 'Journal',
        base: baseTypeOf(vtype || 'Journal', vtypeParents),
        date,
        number,
        narration: textOf(e, 'NARRATION'),
        party: textOf(e, 'PARTYLEDGERNAME'),
        reference: textOf(e, 'REFERENCE'),
        cancelled: yes(textOf(e, 'ISCANCELLED')) || /cancel/i.test(e.attrs.ACTION ?? ''),
        optional: yes(textOf(e, 'ISOPTIONAL')),
        postDated: yes(textOf(e, 'ISPOSTDATED')),
        lines: readLines(e),
        hasInventory,
      });
    }
  }
  if (!els.length) parsed.warnings.push('The file has no masters or vouchers in it.');
  return parsed;
}

/* ── Group mapping ────────────────────────────────────────────── */

/** Tally's reserved (pre-defined) groups → this app's Schedule III primaries. */
export const TALLY_RESERVED_GROUPS: Readonly<Record<string, PrimaryGroupId>> = {
  'capital account': 'CAPITAL',
  'reserves & surplus': 'RESERVES',
  'loans (liability)': 'LOANS_LT',
  'secured loans': 'LOANS_LT',
  'unsecured loans': 'LOANS_LT',
  'bank od a/c': 'LOANS_ST',
  'bank od accounts': 'LOANS_ST',
  'current liabilities': 'OTHER_CL',
  'sundry creditors': 'TRADE_PAYABLES',
  'duties & taxes': 'DUTIES_TAXES',
  provisions: 'PROVISIONS',
  'fixed assets': 'FIXED_ASSETS',
  investments: 'INVESTMENTS',
  'current assets': 'OTHER_CA',
  'bank accounts': 'CASH_BANK',
  'cash-in-hand': 'CASH_BANK',
  'cash in hand': 'CASH_BANK',
  'deposits (asset)': 'LOANS_ADV_LT',
  'loans & advances (asset)': 'LOANS_ADV_ST',
  'stock-in-hand': 'INVENTORIES',
  'stock in hand': 'INVENTORIES',
  'sundry debtors': 'TRADE_RECEIVABLES',
  'misc. expenses (asset)': 'OTHER_CA',
  'sales accounts': 'SALES',
  'purchase accounts': 'PURCHASES',
  'direct incomes': 'SALES',
  'income (direct)': 'SALES',
  'indirect incomes': 'OTHER_INCOME',
  'income (indirect)': 'OTHER_INCOME',
  'direct expenses': 'DIRECT_EXPENSES',
  'expenses (direct)': 'DIRECT_EXPENSES',
  'indirect expenses': 'INDIRECT_EXPENSES',
  'expenses (indirect)': 'INDIRECT_EXPENSES',
  'branch / divisions': 'OTHER_CL',
  'suspense a/c': 'OTHER_CL',
};

/** Own keys only: a Tally name such as "constructor" or "__proto__" is untrusted text, never an inherited key (L2). */
const reservedOf = (name: string): PrimaryGroupId | undefined => {
  const key = name.trim().toLowerCase();
  return Object.hasOwn(TALLY_RESERVED_GROUPS, key) ? TALLY_RESERVED_GROUPS[key] : undefined;
};

/* ── Plan ─────────────────────────────────────────────────────── */

export interface ExistingBooks {
  userGroups: readonly UserGroup[];
  /** The whole chart (defaults + user + synthesised). */
  chart: readonly Account[];
  clients: ReadonlyArray<{ id?: string; name: string; company?: string; gstin?: string }>;
  vendors: ReadonlyArray<{ id: string; name: string; gstin?: string }>;
  vouchers: ReadonlyArray<{ narration: string }>;
  openings: ReadonlyArray<{ ledger_id: string; dr: number; cr: number }>;
  stockItems: ReadonlyArray<{ id: string; name: string }>;
  godowns: ReadonlyArray<{ id: string; name: string }>;
  costCentres: ReadonlyArray<{ id: string; name: string }>;
  /** Period lock date ('' = open). */
  lockUntil: string;
}

export interface ImportOptions {
  /** Books beginning: openings are balances at the start of this day; vouchers before it are left out. */
  booksBegin: string;
  includeOpenings?: boolean;
  includeVouchers?: boolean;
  includeStock?: boolean;
  /** Per-ledger override (key: Tally ledger name, lower case): map onto an existing chart account id. */
  mapTo?: Readonly<Record<string, string>>;
}

export type PlannedTarget =
  | { kind: 'account'; accountId: string; existing: true }
  | { kind: 'account'; existing: false; group: PrimaryGroupId; underGroup?: string; code: string }
  | { kind: 'client'; existingId?: string; groupName?: string }
  | { kind: 'vendor'; existingId?: string; groupName?: string };

export interface PlannedGroup {
  name: string;
  /** Parent: a primary id, or the name of another planned / existing user group. */
  parent: string;
  parentIsPrimary: boolean;
  primary: PrimaryGroupId;
  existingId?: string;
}

export interface PlannedLedger {
  rec: TallyLedgerRec;
  primary: PrimaryGroupId;
  target: PlannedTarget;
  issues: string[];
}

export type PlannedVoucherStatus = 'ok' | 'duplicate' | 'locked' | 'cancelled' | 'before_books' | 'error';

export interface PlannedVoucher {
  rec: TallyVoucherRec;
  status: PlannedVoucherStatus;
  reason?: string;
  type: ManualVoucherType;
  tag: string;
  /** Lines with ledger names resolved later (Tally ledger name, debit-positive paise, cost centre name). */
  lines: Array<{ ledger: string; dr: number; cr: number; costCentre?: string }>;
  narration: string;
  variant?: 'OPTIONAL' | 'MEMO';
  postDated?: boolean;
}

export interface PlannedStockItem {
  rec: TallyStockItemRec;
  existingId?: string;
}

export interface ImportPlan {
  booksBegin: string;
  company: string;
  groups: PlannedGroup[];
  ledgers: PlannedLedger[];
  stock: PlannedStockItem[];
  godowns: Array<{ name: string; existingId?: string }>;
  costCentres: Array<{ name: string; existingId?: string }>;
  vouchers: PlannedVoucher[];
  /** Opening on Stock-in-hand from stock item values when no Stock-in-Hand ledger carries one (paise). */
  stockOpening: number;
  /** Tally's opening trial balance as read (paise). `diff` = dr − cr (Tally's "Difference in opening balances"). */
  openingTotals: { dr: number; cr: number; diff: number };
  errors: string[];
  warnings: string[];
  counts: {
    groupsNew: number; groupsExisting: number;
    accountsNew: number; accountsExisting: number;
    clientsNew: number; clientsExisting: number;
    vendorsNew: number; vendorsExisting: number;
    openings: number; openingBills: number;
    stockNew: number; stockExisting: number;
    vouchersOk: number; vouchersDuplicate: number; vouchersSkipped: number; vouchersError: number;
  };
}

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Voucher fingerprint tag kept in the narration (re-import detection). */
export function voucherTag(v: Pick<TallyVoucherRec, 'guid' | 'vtype' | 'date' | 'number' | 'lines'>): string {
  const total = v.lines.reduce((s, l) => s + Math.max(l.paise, 0), 0);
  const basis = v.guid ? `guid:${v.guid}` : `${lower(v.vtype)}|${v.date}|${v.number}|${total}`;
  return `[tally:${sha256(basis).slice(0, 12)}]`;
}

/** Default-chart accounts a Tally ledger of this name normally stands for (only within the same primary). */
function defaultAccountFor(name: string, primary: PrimaryGroupId): string | undefined {
  const l = lower(name);
  if (primary === 'CASH_BANK' && /^cash(\s|-)?(in\s*hand|a\/c|account)?$/.test(l)) return A.cash;
  if (primary === 'DUTIES_TAXES') {
    const input = /\b(input|itc|in)\b/.test(l);
    if (/cgst/.test(l)) return input ? A.inCgst : A.outCgst;
    if (/sgst|utgst/.test(l)) return input ? A.inSgst : A.outSgst;
    if (/igst/.test(l)) return input ? A.inIgst : A.outIgst;
    if (/cess/.test(l)) return input ? A.inCess : A.outCess;
    if (/tcs/.test(l)) return A.tcsPayable;
  }
  if ((primary === 'INDIRECT_EXPENSES' || primary === 'OTHER_INCOME') && /round(ed)?\s*-?\s*off|rounding/.test(l)) return A.roundOff;
  if (primary === 'SALES' && /^sales(\s+a\/c|\s+account)?$/.test(l)) return A.sales;
  if (primary === 'PURCHASES' && /^purchases?(\s+a\/c|\s+account)?$/.test(l)) return A.purchases;
  return undefined;
}

/** Build the dry-run plan. Pure: `existing` is a snapshot of what is already in the books. */
export function planTallyImport(parsed: TallyParsed, existing: ExistingBooks, opts: ImportOptions): ImportPlan {
  const errors: string[] = [];
  const warnings = [...parsed.warnings];
  const includeOpenings = opts.includeOpenings !== false;
  const includeVouchers = opts.includeVouchers !== false;
  const includeStock = opts.includeStock !== false;

  /* Groups: resolve each to its primary through the parent chain. */
  const groupParent = new Map(parsed.groups.map((g) => [lower(g.name), g.parent]));
  const existingGroupByName = new Map(existing.userGroups.map((g) => [lower(g.name), g]));
  const primaryLabels = new Map(GROUPS.map((g) => [lower(g.label), g.id as PrimaryGroupId]));
  const primaryCache = new Map<string, PrimaryGroupId | undefined>();
  const primaryOfTally = (name: string): PrimaryGroupId | undefined => {
    const key = lower(name);
    if (primaryCache.has(key)) return primaryCache.get(key);
    let cur = name;
    let result: PrimaryGroupId | undefined;
    for (let hop = 0; hop < 32 && cur; hop++) {
      const r = reservedOf(cur);
      if (r) {
        result = r;
        break;
      }
      const ex = existingGroupByName.get(lower(cur));
      const next = groupParent.get(lower(cur));
      if (next === undefined && ex) {
        // An existing user group of the same name: follow it in this app's tree.
        let p = ex.parent;
        for (let h = 0; h < 32; h++) {
          if (GROUPS.some((g) => g.id === p)) {
            result = p as PrimaryGroupId;
            break;
          }
          const up = existing.userGroups.find((g) => g.id === p);
          if (!up) break;
          p = up.parent;
        }
        break;
      }
      if (next === undefined) {
        result = primaryLabels.get(lower(cur));
        break;
      }
      cur = next;
    }
    primaryCache.set(key, result);
    return result;
  };

  const groups: PlannedGroup[] = [];
  const planned = new Set<string>();
  const addGroup = (name: string, depth = 0): void => {
    const key = lower(name);
    if (!key || planned.has(key) || reservedOf(name) || depth > 32) return;
    const primary = primaryOfTally(name);
    if (!primary) {
      errors.push(`Group “${name}”: its parent chain does not reach a Tally primary group; it was left out.`);
      planned.add(key);
      return;
    }
    const parent = groupParent.get(key) ?? '';
    const parentPrimary = reservedOf(parent);
    if (parent && !parentPrimary) addGroup(parent, depth + 1);
    planned.add(key);
    const ex = existingGroupByName.get(key);
    if (!ex && primaryLabels.has(key)) {
      // Same name as one of this app's primaries: use the primary itself.
      return;
    }
    groups.push({
      name,
      parent: parentPrimary ?? (parent ? parent : primary),
      parentIsPrimary: !!parentPrimary || !parent,
      primary,
      ...(ex ? { existingId: ex.id } : {}),
    });
  };
  for (const g of parsed.groups) addGroup(g.name);

  /* Ledgers */
  const chartByName = new Map<string, Account>();
  for (const a of existing.chart) {
    chartByName.set(lower(a.name), a);
    if (a.alias) chartByName.set(lower(a.alias), a);
  }
  const clientByName = new Map<string, { id?: string }>();
  const clientByGstin = new Map<string, { id?: string }>();
  for (const c of existing.clients) {
    clientByName.set(lower(c.company || c.name), c);
    clientByName.set(lower(c.name), c);
    if (c.gstin) clientByGstin.set(c.gstin.toUpperCase(), c);
  }
  const vendorByName = new Map(existing.vendors.map((v) => [lower(v.name), v]));
  const vendorByGstin = new Map(existing.vendors.filter((v) => v.gstin).map((v) => [v.gstin!.toUpperCase(), v]));
  const usedCodes = new Set(existing.chart.map((a) => lower(a.code)));
  let codeSeq = 1;
  const nextCode = () => {
    while (usedCodes.has(lower(`T${String(codeSeq).padStart(4, '0')}`))) codeSeq++;
    const c = `T${String(codeSeq).padStart(4, '0')}`;
    usedCodes.add(lower(c));
    return c;
  };
  const userGroupName = (parent: string) => (parent && !reservedOf(parent) && planned.has(lower(parent)) && groups.some((g) => lower(g.name) === lower(parent)) ? parent : undefined);

  const ledgers: PlannedLedger[] = [];
  for (const rec of parsed.ledgers) {
    const issues: string[] = [];
    let primary: PrimaryGroupId | undefined;
    if (!rec.parent) {
      // Tally's primary ledger "Profit & Loss A/c": accumulated profit → reserves & surplus.
      if (/profit\s*&\s*loss/i.test(rec.name)) primary = 'RESERVES';
    } else primary = primaryOfTally(rec.parent);
    if (!primary) {
      issues.push(`Group “${rec.parent || '(none)'}” not found; placed under Other current assets — check it.`);
      primary = 'OTHER_CA';
    }
    const override = opts.mapTo && Object.hasOwn(opts.mapTo, lower(rec.name)) ? opts.mapTo[lower(rec.name)] : undefined;
    let target: PlannedTarget;
    if (override && existing.chart.some((a) => a.id === override)) {
      target = { kind: 'account', accountId: override, existing: true };
    } else if (primary === 'TRADE_RECEIVABLES') {
      const hit = (rec.gstin && clientByGstin.get(rec.gstin)) || clientByName.get(lower(rec.name));
      target = { kind: 'client', ...(hit?.id ? { existingId: hit.id } : {}), ...(userGroupName(rec.parent) ? { groupName: rec.parent } : {}) };
    } else if (primary === 'TRADE_PAYABLES') {
      const hit = (rec.gstin && vendorByGstin.get(rec.gstin)) || vendorByName.get(lower(rec.name));
      target = { kind: 'vendor', ...(hit ? { existingId: hit.id } : {}), ...(userGroupName(rec.parent) ? { groupName: rec.parent } : {}) };
    } else {
      const byName = chartByName.get(lower(rec.name)) ?? (rec.alias ? chartByName.get(lower(rec.alias)) : undefined);
      const def = /profit\s*&\s*loss/i.test(rec.name) && !rec.parent ? A.reserves : defaultAccountFor(rec.name, primary);
      if (byName) target = { kind: 'account', accountId: byName.id, existing: true };
      else if (def) target = { kind: 'account', accountId: def, existing: true };
      else {
        const under = userGroupName(rec.parent);
        target = { kind: 'account', existing: false, group: primary, ...(under ? { underGroup: under } : {}), code: nextCode() };
      }
    }
    if (rec.gstin && !isValidGstin(rec.gstin)) issues.push(`GSTIN ${rec.gstin} fails the GSTIN check; the party is saved without it — correct it in the party master.`);
    ledgers.push({ rec, primary, target, issues });
  }

  /* Openings */
  let dr = 0;
  let cr = 0;
  for (const l of ledgers) {
    if (l.rec.opening > 0) dr += l.rec.opening;
    else cr -= l.rec.opening;
  }
  const stockLedgerOpening = ledgers.some((l) => l.primary === 'INVENTORIES' && l.rec.opening !== 0);
  const stockValue = parsed.stockItems.reduce((s, i) => s + i.openingValue, 0);
  const stockOpening = includeOpenings && !stockLedgerOpening ? stockValue : 0;
  if (stockOpening) dr += stockOpening;
  const openingTotals = { dr, cr, diff: dr - cr };
  if (includeOpenings && openingTotals.diff !== 0) {
    warnings.push(`Opening balances in the file differ by ₹${(Math.abs(openingTotals.diff) / 100).toFixed(2)} ${openingTotals.diff > 0 ? 'Dr' : 'Cr'}; it will show as "Difference in opening balances" (account 1090), as in Tally.`);
  }
  if (includeOpenings) {
    const prevById = new Map(existing.openings.map((o) => [o.ledger_id, o.dr - o.cr]));
    for (const l of ledgers) {
      if (!l.rec.opening || l.target.kind !== 'account' || !l.target.existing) continue;
      const prev = prevById.get(l.target.accountId);
      if (prev !== undefined && prev !== l.rec.opening) l.issues.push(`Replaces the opening already entered (₹${(prev / 100).toFixed(2)}).`);
    }
    for (const l of ledgers) {
      if (!l.rec.bills.length) continue;
      const total = l.rec.bills.reduce((s, b) => s + b.paise, 0);
      if (total !== l.rec.opening) l.issues.push(`Bill-wise openings total ₹${(total / 100).toFixed(2)}, ledger opening ₹${(l.rec.opening / 100).toFixed(2)}: the rest is On Account.`);
    }
  }

  /* Stock */
  const stockByName = new Map(existing.stockItems.map((s) => [lower(s.name), s]));
  const stock: PlannedStockItem[] = includeStock
    ? parsed.stockItems.map((rec) => ({ rec, ...(stockByName.get(lower(rec.name)) ? { existingId: stockByName.get(lower(rec.name))!.id } : {}) }))
    : [];
  const godownByName = new Map(existing.godowns.map((g) => [lower(g.name), g]));
  const godowns = includeStock
    ? parsed.godowns.filter((g) => !/^main location$/i.test(g)).map((name) => ({ name, ...(godownByName.get(lower(name)) ? { existingId: godownByName.get(lower(name))!.id } : {}) }))
    : [];

  /* Vouchers */
  const vouchers: PlannedVoucher[] = [];
  const centres = new Map<string, { name: string; existingId?: string }>();
  const ccByName = new Map(existing.costCentres.map((c) => [lower(c.name), c]));
  if (includeVouchers) {
    const known = new Set<string>();
    for (const v of existing.vouchers) {
      const m = /\[tally:[0-9a-f]{12}\]/.exec(v.narration ?? '');
      if (m) known.add(m[0]);
    }
    // A provisional chart for validation: existing accounts + the accounts this import creates.
    const provisional: Account[] = [...existing.chart];
    const accountFor = new Map<string, string>(); // tally ledger lower → account id (provisional)
    for (const l of ledgers) {
      const t = l.target;
      if (t.kind === 'client') accountFor.set(lower(l.rec.name), A.debtors);
      else if (t.kind === 'vendor') accountFor.set(lower(l.rec.name), A.creditors);
      else if (t.existing === true) accountFor.set(lower(l.rec.name), t.accountId);
      else {
        const id = `new:${lower(l.rec.name)}`;
        provisional.push({ id, code: t.code, name: l.rec.name, group: t.group });
        accountFor.set(lower(l.rec.name), id);
      }
    }
    const resolve = (ledger: string): string | undefined => {
      const k = lower(ledger);
      if (accountFor.has(k)) return accountFor.get(k);
      const a = chartByName.get(k);
      if (a) return a.id;
      if (clientByName.has(k)) return A.debtors;
      if (vendorByName.has(k)) return A.creditors;
      return undefined;
    };
    const tagsInFile = new Set<string>();
    let gstWarned = false;
    for (const rec of parsed.vouchers) {
      const tag = voucherTag(rec);
      const label = `${rec.vtype} ${rec.number || '(no number)'} of ${rec.date}`;
      const lines: PlannedVoucher['lines'] = [];
      for (const ln of rec.lines) {
        const amt = Math.abs(ln.paise);
        const side = ln.paise > 0 ? 'dr' : 'cr';
        const split = ln.costCentres.length && ln.costCentres.reduce((s, c) => s + c.paise, 0) === amt ? ln.costCentres : [];
        if (split.length) {
          for (const c of split) {
            lines.push({ ledger: ln.ledger, dr: side === 'dr' ? c.paise : 0, cr: side === 'cr' ? c.paise : 0, costCentre: c.name });
            if (!centres.has(lower(c.name))) centres.set(lower(c.name), { name: c.name, ...(ccByName.get(lower(c.name)) ? { existingId: ccByName.get(lower(c.name))!.id } : {}) });
          }
        } else lines.push({ ledger: ln.ledger, dr: side === 'dr' ? amt : 0, cr: side === 'cr' ? amt : 0 });
      }
      let type: ManualVoucherType = rec.base === 'Contra' ? 'CONTRA' : rec.base === 'Payment' ? 'PAYMENT' : rec.base === 'Receipt' ? 'RECEIPT' : 'JOURNAL';
      const narration = [`Tally ${rec.vtype}${rec.number ? ` #${rec.number}` : ''}`, rec.reference && `Ref ${rec.reference}`, rec.narration].filter(Boolean).join(' — ');
      const pv: PlannedVoucher = {
        rec, tag, lines, type, status: 'ok',
        narration: `${narration} ${tag}`.slice(0, 1000),
        ...(rec.optional ? { variant: 'OPTIONAL' as const } : rec.base === 'Memorandum' ? { variant: 'MEMO' as const } : {}),
        ...(rec.postDated ? { postDated: true } : {}),
      };
      const fail = (status: PlannedVoucherStatus, reason: string) => {
        pv.status = status;
        pv.reason = reason;
      };
      if (rec.cancelled) fail('cancelled', 'Cancelled in Tally.');
      else if (known.has(tag)) fail('duplicate', 'Already imported earlier.');
      else if (tagsInFile.has(tag)) fail('duplicate', 'Appears twice in this file.');
      else if (rec.date < opts.booksBegin) fail('before_books', `Dated before the books beginning (${opts.booksBegin}); it is already inside the opening balances.`);
      else if (existing.lockUntil && rec.date <= existing.lockUntil) fail('locked', `Inside the locked period (up to ${existing.lockUntil}).`);
      else if (!lines.length) fail('error', rec.hasInventory ? 'Quantity only (no ledger amounts): stock journals are not imported.' : 'No ledger entries.');
      else {
        const missing = [...new Set(lines.map((l) => l.ledger).filter((n) => !resolve(n)))];
        if (missing.length) fail('error', `Ledger${missing.length > 1 ? 's' : ''} not in this file or your books: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
        else {
          const input = (t: ManualVoucherType): ManualVoucherInput => ({
            type: t, date: rec.date, narration: pv.narration,
            lines: lines.map<ManualVoucherLine>((l) => ({ account_id: resolve(l.ledger)!, dr: l.dr, cr: l.cr })),
          });
          let problems = validateVoucher(input(type), provisional);
          if (problems.length && type !== 'JOURNAL') {
            const asJournal = validateVoucher(input('JOURNAL'), provisional);
            if (!asJournal.length) {
              warnings.push(`${label}: kept as a journal (${problems[0]})`);
              type = 'JOURNAL';
              pv.type = type;
              problems = [];
            }
          }
          if (problems.length) fail('error', problems[0]);
        }
      }
      if (pv.status !== 'duplicate') tagsInFile.add(tag);
      if (pv.status === 'ok' && !gstWarned && /sales|purchase|credit note|debit note/i.test(rec.base)) {
        gstWarned = true;
        warnings.push('Sales, purchase and note vouchers come in as journal vouchers: they post to the ledgers but are not GST documents (never in GSTR-1 / 3B, e-invoice or the invoice list).');
      }
      vouchers.push(pv);
    }
  }

  const count = (s: PlannedVoucherStatus) => vouchers.filter((v) => v.status === s).length;
  const counts: ImportPlan['counts'] = {
    groupsNew: groups.filter((g) => !g.existingId).length,
    groupsExisting: groups.filter((g) => g.existingId).length,
    accountsNew: ledgers.filter((l) => l.target.kind === 'account' && !l.target.existing).length,
    accountsExisting: ledgers.filter((l) => l.target.kind === 'account' && l.target.existing).length,
    clientsNew: ledgers.filter((l) => l.target.kind === 'client' && !l.target.existingId).length,
    clientsExisting: ledgers.filter((l) => l.target.kind === 'client' && l.target.existingId).length,
    vendorsNew: ledgers.filter((l) => l.target.kind === 'vendor' && !l.target.existingId).length,
    vendorsExisting: ledgers.filter((l) => l.target.kind === 'vendor' && l.target.existingId).length,
    openings: includeOpenings ? ledgers.filter((l) => l.rec.opening !== 0).length + (stockOpening ? 1 : 0) : 0,
    openingBills: includeOpenings ? ledgers.reduce((s, l) => s + (l.target.kind === 'client' || l.target.kind === 'vendor' ? l.rec.bills.length : 0), 0) : 0,
    stockNew: stock.filter((s) => !s.existingId).length,
    stockExisting: stock.filter((s) => s.existingId).length,
    vouchersOk: count('ok'),
    vouchersDuplicate: count('duplicate'),
    vouchersSkipped: count('cancelled') + count('before_books') + count('locked'),
    vouchersError: count('error'),
  };
  return {
    booksBegin: opts.booksBegin,
    company: parsed.company,
    groups,
    ledgers,
    stock,
    godowns,
    costCentres: [...centres.values()],
    vouchers,
    stockOpening,
    openingTotals,
    errors,
    warnings,
    counts,
  };
}

/** Earliest voucher date's FY start, else the 1 April before `today` — a sensible books-beginning default. */
export function suggestBooksBegin(parsed: TallyParsed, today: string): string {
  const first = parsed.vouchers.map((v) => v.date).filter(Boolean).sort()[0] ?? today;
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** State code for a party: from the GSTIN, else the Tally state name. */
export function stateCodeOf(rec: Pick<TallyLedgerRec, 'gstin' | 'stateName'>): string {
  return resolveStateCode({ gstin: rec.gstin, name: rec.stateName });
}
