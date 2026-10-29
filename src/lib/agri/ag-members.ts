/**
 * AG-D5 members' capital (table `member_shares`, `books.edit`, dated `date`; certificates `SHC/FY…`). Members are
 * vendors / clients with `ag.member` (the AG-A2 master; one person is one member, matched by `ag.code`).
 * Share ledger rows: allot (+), transfer in (+), transfer out (−), surrender (−), forfeit (−), refund (money only).
 *  - Allotment from application money (cycles' `share` deductions or receipts sit in "Share application money —
 *    members"): JOURNAL Dr application money | Cr "Share capital — members"; or paid straight in: RECEIPT Dr bank /
 *    cash | Cr share capital. A transfer moves shares between members (two rows, a new certificate; capital unchanged).
 *  - Register of members as at a date (folio, shares held, paid up, membership date, cessation) and the certificate.
 * One-member-one-vote is a governance fact, not modelled; producer-company members must be primary producers or
 * producer institutions — a checkbox with "verify AG18". Pure above "Storage".
 */
import './ag-registry';
import type { MemberShareRow, ShareKind } from '../../types/agri-r12d';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable, KEYS } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts } from '../ledger/accounts';
import { loadLedger } from '../ledger/index';
import { closingBalances } from '../ledger/reports';
import { deleteVoucher } from '../ledger/vouchers';
import { ensureLedger, postPair } from '../trade/tr-ledger';
import { AG_SERIES, AG_TABLES } from './ag-shared';
import { smallPaper } from './ag-cold-lots';

export const SHARES_TABLE = AG_TABLES.memberShares;
export const APPLICATION_LEDGER = 'Share application money — members';
export const CAPITAL_LEDGER = 'Share capital — members';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SIGN: Readonly<Record<ShareKind, number>> = { allot: 1, transfer_in: 1, transfer_out: -1, surrender: -1, forfeit: -1, refund: 0 };

export interface Member { id: string; name: string; code?: string; member_no?: string; since?: string; address?: string; kind: 'vendor' | 'client'; other_id?: string }

/* ── Pure ── */

type Party = { id: string; name: string; address?: string; ag?: { code?: string; member?: boolean; member_no?: string; member_since?: string } };

/** Members from vendors and clients with `ag.member` (one row per `ag.code`; the vendor side wins, the other id kept). */
export function membersOf(vendors: readonly Party[], clients: readonly Party[]): Member[] {
  const out = new Map<string, Member>();
  const put = (p: Party, kind: Member['kind']) => {
    if (!p?.ag?.member) return;
    const key = p.ag.code?.trim() || `${kind}:${p.id}`;
    const had = out.get(key);
    if (had) { had.other_id ??= p.id; return; }
    out.set(key, { id: p.id, name: p.name, kind, ...(p.ag.code ? { code: p.ag.code } : {}), ...(p.ag.member_no ? { member_no: p.ag.member_no } : {}), ...(p.ag.member_since ? { since: p.ag.member_since } : {}), ...(p.address ? { address: p.address } : {}) });
  };
  for (const v of vendors) put(v, 'vendor');
  for (const c of clients) put(c, 'client');
  return [...out.values()].sort((a, b) => (a.member_no ?? a.code ?? a.name).localeCompare(b.member_no ?? b.code ?? b.name, undefined, { numeric: true }));
}

/** Shares held by each member as at `asOf` (inclusive). */
export function holdings(rows: readonly MemberShareRow[], asOf = '9999-12-31'): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.date <= asOf) m.set(r.member_id, (m.get(r.member_id) ?? 0) + SIGN[r.kind] * num(r.shares));
  return m;
}

/** Paid-up share capital as at `asOf` (shares held × their face value). */
export const paidUp = (rows: readonly MemberShareRow[], asOf = '9999-12-31'): number => round2(rows.filter((r) => r.date <= asOf).reduce((s, r) => s + SIGN[r.kind] * num(r.shares) * num(r.face_value), 0));

export interface RegisterRow { member: Member; folio: string; shares: number; paid: number; joined: string; ceased?: string; certificates: string[] }

/** Register of members as at `asOf`: every member with a share row (and every member of the master), cessation when holdings went to 0. */
export function registerAt(members: readonly Member[], rows: readonly MemberShareRow[], asOf: string): RegisterRow[] {
  return members.map((m) => {
    const mine = rows.filter((r) => (r.member_id === m.id || r.member_id === m.other_id) && r.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
    let held = 0;
    let ceased: string | undefined;
    for (const r of mine) {
      held += SIGN[r.kind] * num(r.shares);
      ceased = held <= 0 && SIGN[r.kind] < 0 ? r.date : held > 0 ? undefined : ceased;
    }
    return { member: m, folio: m.member_no ?? m.code ?? '', shares: held, paid: round2(mine.reduce((s, r) => s + SIGN[r.kind] * num(r.shares) * num(r.face_value), 0)), joined: m.since ?? mine[0]?.date ?? '', ...(ceased ? { ceased } : {}), certificates: mine.filter((r) => r.certificate_no && SIGN[r.kind] > 0).map((r) => r.certificate_no!) };
  });
}

/**
 * Application money a member has from the pooled cycles' `share` deductions (AG-A4), less what allotments used.
 * `null` ids = every farmer (the cycle money of all members together).
 */
export function applicationMoney(memberIds: readonly string[] | null, cycles: readonly unknown[], rows: readonly MemberShareRow[]): number {
  const ids = memberIds && new Set(memberIds.filter(Boolean));
  const has = (id: string | undefined) => !ids || ids.has(id ?? '');
  let got = 0;
  for (const c of cycles as { status?: string; lines?: { farmer_id?: string; deductions?: { kind?: string; amount?: number }[] }[] }[]) {
    if (!c || c.status === 'draft') continue;
    for (const l of c.lines ?? []) if (has(l.farmer_id)) for (const d of l.deductions ?? []) if (d.kind === 'share') got += num(d.amount);
  }
  const used = rows.filter((r) => has(r.member_id) && r.kind === 'allot' && r.paid_from === 'application').reduce((s, r) => s + num(r.amount), 0);
  return round2(got - used);
}

/**
 * QA13: what an allotment from application money may use. The ledger's credit balance is the ceiling (receipts may also
 * feed it, not only cycles); cycle money is the member's own, so another member's unused cycle money is held back and
 * only the unattributed rest (ledger − all members' cycle money, e.g. receipts) is open to anyone.
 */
export function applicationAvailable(ledgerBalance: number, member: number, all: number): number {
  const l = Math.max(num(ledgerBalance), 0);
  return round2(Math.max(Math.min(l, Math.max(num(member), 0) + Math.max(l - Math.max(num(all), 0), 0)), 0));
}

/** Share certificate (A5). */
export function certificateHtml(r: MemberShareRow, ctx: { company: string; folio?: string; from?: number; to?: number }): string {
  return smallPaper(`Share certificate ${r.certificate_no ?? ''}`.trim(), ctx.company, [
    ['Member', r.member_name], ['Folio / member no.', ctx.folio ?? ''], ['Shares', r.shares], ['Face value (₹)', r.face_value], ['Amount paid (₹)', round2(num(r.shares) * num(r.face_value))],
    ['Distinctive nos.', ctx.from && ctx.to ? `${ctx.from} to ${ctx.to}` : ''], ['Date of allotment', r.date], ['Approved on', r.approved_on ?? ''],
  ], 'Issued under the articles / bye-laws. Working paper: verify the form with your CS / Registrar (AG18, AG19).', 'Director / Secretary');
}

/** Distinctive numbers of a certificate: shares issued before it + 1 … + its shares (allotments and transfers in, by date then entry). */
export function distinctive(rows: readonly MemberShareRow[], id: string): { from: number; to: number } | undefined {
  let n = 0;
  for (const r of [...rows].filter((x) => x.certificate_no).sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)))) {
    if (r.id === id) return { from: n + 1, to: n + num(r.shares) };
    n += num(r.shares);
  }
  return undefined;
}

/* ── Storage ── */

export const loadShares = (): MemberShareRow[] => getTable<MemberShareRow>(SHARES_TABLE).filter((r) => r && typeof r.id === 'string');
export const loadMembers = (): Member[] => membersOf(getTable<Party>('vendors'), getTable<Party>(KEYS.clients));
const ledger = (name: string, group: string, from: number) => ensureLedger(name, group, from);

const base = (m: Member, date: string, shares: number, face: number) => {
  if (!DAY.test(date)) throw new Error('Choose the date.');
  const n = Math.round(num(shares));
  if (!(n > 0) || n !== num(shares)) throw new Error('Shares are whole numbers above 0.');
  if (!(num(face) > 0)) throw new Error('Enter the face value of a share.');
  return { id: generateId(), date, member_id: m.id, member_name: m.name, shares: n, face_value: round2(num(face)), amount: round2(n * num(face)), created_at: new Date().toISOString() };
};

/** Allot shares with a certificate (`SHC/FY…`) and post the money: from application money (journal) or by bank / cash. */
export function allotShares(m: Member, i: { date: string; shares: number; face_value: number; paid_from: 'application' | 'bank' | 'cash'; approved_on?: string; note?: string }): MemberShareRow {
  requireAccess('books.edit');
  const all = loadShares();
  const row = base(m, i.date, i.shares, i.face_value);
  if (i.paid_from === 'application') {
    const cycles = getTable('farmer_cycles');
    const acc = chartOf(loadUserAccounts()).find((a) => a.name.trim().toLowerCase() === APPLICATION_LEDGER.toLowerCase());
    const bal = acc ? round2(Math.max(-(closingBalances(loadLedger(), i.date).get(acc.id) ?? 0), 0) / 100) : 0;
    const avail = applicationAvailable(bal, applicationMoney([m.id, m.other_id ?? ''], cycles, all), applicationMoney(null, cycles, all));
    if (row.amount - avail > 0.004) throw new Error(`Only ₹${avail.toFixed(2)} of share application money is available for ${m.name} on ${i.date} (₹${bal.toFixed(2)} in "${APPLICATION_LEDGER}"); record the application money first or allot against bank / cash.`);
  }
  const number = nextSeriesNumberFor(AG_SERIES.shc, i.date, all.map((r) => r.certificate_no ?? '').filter(Boolean));
  return withTablesRollback([SHARES_TABLE, 'vouchers', 'accounts', 'series_counters'], () => {
    const cap = ledger(CAPITAL_LEDGER, 'CAPITAL', 1060);
    const v = postPair({ type: i.paid_from === 'application' ? 'JOURNAL' : 'RECEIPT', date: i.date, dr: i.paid_from === 'application' ? ledger(APPLICATION_LEDGER, 'OTHER_CL', 2460) : i.paid_from === 'cash' ? A.cash : A.bank, cr: cap, amount: row.amount, narration: `Allotment of ${row.shares} shares of ₹${row.face_value} to ${m.name} (certificate ${number})`, cls: 'Share allotment' });
    const out: MemberShareRow = { ...row, kind: 'allot', certificate_no: number, paid_from: i.paid_from, voucher_id: v.id, ...(i.approved_on ? { approved_on: i.approved_on } : {}), ...(i.note?.trim() ? { note: i.note.trim() } : {}) };
    setTable(SHARES_TABLE, [...all, out]);
    recordSeries(number);
    return out;
  });
}

/** Transfer shares between members (out of one, into the other with a new certificate). Total shares unchanged. */
export function transferShares(from: Member, to: Member, i: { date: string; shares: number; face_value: number; approved_on?: string; note?: string }): MemberShareRow {
  requireAccess('books.edit');
  if (from.id === to.id) throw new Error('Choose two different members.');
  const all = loadShares();
  const held = holdings(all, i.date).get(from.id) ?? 0;
  if (num(i.shares) > held) throw new Error(`${from.name} holds ${held} shares on ${i.date}.`);
  const out: MemberShareRow = { ...base(from, i.date, i.shares, i.face_value), kind: 'transfer_out', ...(i.note?.trim() ? { note: i.note.trim() } : {}) };
  const number = nextSeriesNumberFor(AG_SERIES.shc, i.date, all.map((r) => r.certificate_no ?? '').filter(Boolean));
  const inn: MemberShareRow = { ...base(to, i.date, i.shares, i.face_value), kind: 'transfer_in', from_member_id: from.id, certificate_no: number, created_at: out.created_at, ...(i.approved_on ? { approved_on: i.approved_on } : {}) };
  return withTablesRollback([SHARES_TABLE, 'series_counters'], () => {
    setTable(SHARES_TABLE, [...all, out, inn]);
    recordSeries(number);
    return inn;
  });
}

/** Surrender (refund by bank / cash: PAYMENT Dr share capital | Cr bank / cash) or forfeit (JOURNAL Dr share capital | Cr "Forfeited shares"). */
export function reduceShares(m: Member, kind: 'surrender' | 'forfeit', i: { date: string; shares: number; face_value: number; refund_by?: 'bank' | 'cash'; note?: string }): MemberShareRow {
  requireAccess('books.edit');
  const all = loadShares();
  const held = holdings(all, i.date).get(m.id) ?? 0;
  if (num(i.shares) > held) throw new Error(`${m.name} holds ${held} shares on ${i.date}.`);
  const row = base(m, i.date, i.shares, i.face_value);
  return withTablesRollback([SHARES_TABLE, 'vouchers', 'accounts'], () => {
    const cap = ledger(CAPITAL_LEDGER, 'CAPITAL', 1060);
    const v = kind === 'forfeit'
      ? postPair({ type: 'JOURNAL', date: i.date, dr: cap, cr: ledger('Forfeited shares', 'RESERVES', 1160), amount: row.amount, narration: `Forfeiture of ${row.shares} shares of ${m.name}`, cls: 'Share forfeiture' })
      : i.refund_by ? postPair({ type: 'PAYMENT', date: i.date, dr: cap, cr: i.refund_by === 'cash' ? A.cash : A.bank, amount: row.amount, narration: `Refund on surrender of ${row.shares} shares by ${m.name}`, cls: 'Share surrender' }) : undefined;
    const out: MemberShareRow = { ...row, kind, ...(v ? { voucher_id: v.id } : {}), ...(i.note?.trim() ? { note: i.note.trim() } : {}) };
    setTable(SHARES_TABLE, [...all, out]);
    return out;
  });
}

/** Delete a share entry and its voucher (to the recycle bin); a certificate number stays used. A transfer goes as a pair. */
export function deleteShareRow(id: string): void {
  requireAccess('books.edit');
  const all = loadShares();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  const pair = row.kind === 'transfer_in' || row.kind === 'transfer_out' ? all.find((r) => r.id !== id && r.date === row.date && r.created_at === row.created_at && (r.kind === 'transfer_in' || r.kind === 'transfer_out')) : undefined;
  const gone = new Set([id, pair?.id].filter(Boolean) as string[]);
  const left = all.filter((r) => !gone.has(r.id));
  for (const [mid, n] of holdings(left)) if (n < 0) throw new Error(`Deleting this leaves ${all.find((r) => r.member_id === mid)?.member_name ?? 'a member'} with negative shares: delete the later entries first.`);
  withTablesRollback([SHARES_TABLE, 'vouchers'], () => {
    if (row.voucher_id) deleteVoucher(row.voucher_id);
    setTable(SHARES_TABLE, left);
  });
}
