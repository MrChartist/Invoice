/**
 * R19-C4 customs broker register (pure; family `f-logistics`): one row per job in a date range — job no., date, client,
 * IEC, GSTIN, bill of entry / shipping bill with its date, the customs port, invoices raised, disbursements, deposits and
 * status — printed (escaped by the view) and exported as CSV: "records … in an orderly and itemised manner" (CBLR 2018
 * Reg 10(k), `CBLR_RULES`). KYC is the client's IEC and a verified-on date / method only (`Client.lg`, Reg 10(n), no
 * document copies). The gross / net reclass journal was cut (PRD §3 cut 1): the ledger stays gross (LG11). Working
 * papers — verify with your CA (LG26, LG27).
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { LgJob } from '../../types/logistics-r19';
import { round2 } from '../invoice-calc';
import { keyedAt, CBLR_RULES } from '../logistics-rules';
import { lgList } from '../../i18n/areas/logistics-r19a';
import type { DepositBal } from './lg-deposits';
import type { LgDisbRow } from './lg-disb';
import { LG_STATUSES } from './lg-job';

export interface RegisterRow { job: string; date: string; client: string; iec: string; gstin: string; doc: string; port: string; invoices: string; billed: number; disb: number; deposits: number; status: string }

const dmy = (d?: string) => (d ? d.split('-').reverse().join('/') : '');

/** The register rows of the jobs dated `from`–`to` (inclusive), in job order. */
export function registerRows(x: { jobs: readonly LgJob[]; clients: readonly Client[]; invoices: readonly Pick<InvoiceRecord, 'invoice_number' | 'status' | 'total' | 'lg'>[]; disb: readonly LgDisbRow[]; deposits: readonly DepositBal[]; from: string; to: string }): RegisterRow[] {
  const cl = new Map(x.clients.map((c) => [c.id ?? '', c]));
  const sum = <T>(rows: readonly T[], id: string, key: (r: T) => string, v: (r: T) => number) => round2(rows.filter((r) => key(r) === id).reduce((s, r) => s + v(r), 0));
  return x.jobs
    .filter((j) => j.date >= x.from && j.date <= x.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .map((j) => {
      const c = cl.get(j.client_id);
      const r = j.refs ?? {};
      const inv = x.invoices.filter((i) => i.lg?.job_id === j.id && i.status !== 'Cancelled');
      const imp = j.dir === 'import';
      const no = imp ? r.boe_no : r.sb_no;
      return {
        job: j.number, date: dmy(j.date), client: c?.name ?? '', iec: c?.lg?.iec ?? '', gstin: c?.gstin ?? '',
        doc: no ? `${imp ? 'BOE' : 'SB'} ${no}${(imp ? r.boe_date : r.sb_date) ? ` dt ${dmy(imp ? r.boe_date : r.sb_date)}` : ''}` : '',
        port: imp ? j.destination : j.origin, invoices: inv.map((i) => i.invoice_number).join(' '), billed: round2(inv.reduce((s, i) => s + (Number(i.total) || 0), 0)),
        disb: sum(x.disb, j.id, (d) => d.job_id, (d) => d.amount), deposits: sum(x.deposits, j.id, (d) => d.job_id, (d) => d.amount), status: lgList('statuses', LG_STATUSES, j.status),
      };
    });
}

export const REGISTER_COLS: readonly (keyof RegisterRow)[] = ['job', 'date', 'client', 'iec', 'gstin', 'doc', 'port', 'invoices', 'billed', 'disb', 'deposits', 'status'];
export const REGISTER_HEAD = ['Job', 'Date', 'Client', 'IEC', 'GSTIN', 'BOE / SB', 'Port', 'Invoices', 'Invoiced (₹)', 'Disbursements (₹)', 'Deposits (₹)', 'Status'];
const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };

/** CSV with a header row; a leading = + - @ is neutralised (formula injection). */
export const registerCsv = (rows: readonly RegisterRow[]): string => [REGISTER_HEAD, ...rows.map((r) => REGISTER_COLS.map((k) => r[k]))].map((l) => l.map(cell).join(',')).join('\r\n');

/** The register's title line, by the rule in force on `date`. */
export const registerTitle = (date: string): string => { const r = keyedAt(CBLR_RULES, 'records', date)?.value; return r ? `Customs broker register — CBLR 2018 ${r.reg}: ${r.text}` : 'Customs broker register'; };

/** True when the client has no KYC date (Reg 10(n) hint on its jobs). */
export const kycMissing = (c: Pick<Client, 'lg'> | undefined): boolean => !c?.lg?.kyc?.verified_on;

const KEY = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
const COL = { job: /^job(no|number)?$/, no: /^(sb|be|boe|besb|sbbe|shippingbill|billofentry)(no|number)?$|^number$/, date: /^(sb|be|boe)?date$/, igm: /^igm(no|number)?$/ };
const toDay = (s: string) => { const t = s.trim(); const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };

/**
 * Shipping bill / bill of entry numbers from a file the broker exported (no ICEGATE call: the app makes no network
 * calls): columns Job, SB / BOE no., Date (YYYY-MM-DD or DD/MM/YYYY), IGM. An export job takes `sb_*`, an import job
 * `boe_*` (+ `igm`). Returns the jobs' new refs and the rows refused (unknown job, no number, bad date) by row number.
 */
export function docRefsFromTable(t: { headers: readonly string[]; rows: readonly (readonly string[])[] }, jobs: readonly LgJob[]): { ok: { id: string; refs: LgJob['refs'] }[]; errors: string[] } {
  const at = (re: RegExp) => t.headers.findIndex((h) => re.test(KEY(h)));
  const [cj, cn, cd, ci] = [at(COL.job), at(COL.no), at(COL.date), at(COL.igm)];
  const byNo = new Map(jobs.map((j) => [j.number.toUpperCase(), j]));
  const ok: { id: string; refs: LgJob['refs'] }[] = [];
  const errors: string[] = [];
  t.rows.forEach((r, i) => {
    const j = byNo.get(String(r[cj] ?? '').trim().toUpperCase());
    const no = String(r[cn] ?? '').trim();
    const raw = String(r[cd] ?? '').trim();
    const d = raw ? toDay(raw) : '';
    if (!j || !no || (raw && !d)) return void errors.push(`Row ${i + 2}: ${!j ? 'job not found' : !no ? 'no SB / BOE number' : 'date not read'}`);
    const imp = j.dir === 'import';
    const igm = ci >= 0 ? String(r[ci] ?? '').trim() : '';
    ok.push({ id: j.id, refs: { ...j.refs, [imp ? 'boe_no' : 'sb_no']: no, ...(d ? { [imp ? 'boe_date' : 'sb_date']: d } : {}), ...(imp && igm ? { igm } : {}) } });
  });
  return { ok, errors };
}
