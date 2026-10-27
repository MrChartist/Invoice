/**
 * PS-D3 194J (and 194C / 194H) receivable side by client: the client's default section (`Client.ps.tds`, else the
 * profile default), the expected TDS on a fee note — on the FEE BASE (taxable value of the fee lines; pure-agent
 * recoveries and GST out, PS25 / Q33) once the client's FY total passes the section's threshold in `tds-rules.ts` —
 * and the Form 131 (16A) chase list per client × quarter from the TDS receivable register, with a chase letter.
 * Labels follow `ita2025.ts` by date. Pure except `clientsTotals` callers pass the tables. Working paper — verify with
 * your CA (PS18, PS25).
 */
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClientTdsDefault } from '../../types/prof-r14d';
import type { EntityType } from '../../types/books-r2';
import { num, round2 } from '../invoice-calc';
import { isPureAgentLine } from '../trade/pure-agent';
import { isRevenueDoc } from '../stats';
import { sectionRate, tdsThreshold } from '../tds-rules';
import { fyQuarterOf } from '../tds-payables';
import { form16aDueDate, type TdsRegister, type Quarter } from '../tds-register';
import { formText, quarterStart, sectionText } from '../ita2025';

type Section = ClientTdsDefault['section'];

/** Profile defaults (A1 table, D3 criterion 1): consulting is asked per client (PS18), so it has none. */
export function profileTdsDefault(profKind: string): ClientTdsDefault | undefined {
  if (['ca', 'legal', 'design', 'freelancer'].includes(profKind)) return { section: '194J' };
  if (profKind === 'agency') return { section: '194C' };
  return undefined;
}

/** `Client.ps.tds` (PS-A's additive field), else the profile default. */
export function clientTdsDefault(client: unknown, profKind = ''): ClientTdsDefault | undefined {
  const t = (client as { ps?: { tds?: ClientTdsDefault } } | null)?.ps?.tds;
  if (t && ['194J', '194J-T', '194C', '194H', 'none'].includes(t.section)) return t;
  return profileTdsDefault(profKind);
}

/** The stored invoice code and the threshold family of a client section. 194C by OUR entity form (1 % individual / HUF). */
export function codeFor(section: Section, ourForm: EntityType): { code: string; family: string } {
  if (section === '194C') return { code: ourForm === 'proprietorship' ? '194C-1' : '194C-2', family: '194C' };
  return { code: section, family: section };
}

/** A recovery line (pure agent): the R8 / B1 charge-head line, or a 0 % timesheet reimbursement line. */
export const isRecoveryLine = (l: Pick<InvoiceItem, 'tax_rate' | 'description'> & { charge_head_id?: string }): boolean =>
  isPureAgentLine(l) || (num(l.tax_rate) === 0 && /pure agent/i.test(l.description ?? ''));

/** Fee base of a document: its taxable value × the share of fee lines (recoveries out; GST never in). */
export function feeBase(inv: Pick<InvoiceRecord, 'items' | 'taxable_value'>): number {
  const items = inv.items ?? [];
  const all = items.reduce((s, i) => s + num(i.amount), 0);
  const fees = items.filter((i) => !isRecoveryLine(i)).reduce((s, i) => s + num(i.amount), 0);
  if (!(all > 0)) return 0;
  return round2((num(inv.taxable_value) * fees) / all);
}

const sameClient = (a: Pick<InvoiceRecord, 'client'>, c: Pick<Client, 'id' | 'name'>) => (c.id && a.client?.id ? a.client.id === c.id : (a.client?.name ?? '').trim().toLowerCase() === (c.name ?? '').trim().toLowerCase());

export interface ExpectedTds {
  applies: boolean;
  section: Section;
  code: string;
  rate: number;
  base: number;
  amount: number;
  /** The client's fee base in the FY before this document. */
  fyBefore: number;
  threshold: number;
  message: string;
}

/**
 * Expected TDS on a fee note to `client` dated `date` with `base` (fee base). Prior = the client's issued revenue
 * documents of the same FY (credit notes reduce it), drafts and cancelled out, `excludeId` = the note itself.
 */
export function expectedTds(input: { client: Pick<Client, 'id' | 'name'>; def: ClientTdsDefault | undefined; date: string; base: number; invoices: readonly InvoiceRecord[]; ourForm: EntityType; excludeId?: string }): ExpectedTds | null {
  const def = input.def;
  if (!def || def.section === 'none') return null;
  const { code, family } = codeFor(def.section, input.ourForm);
  const rate = def.rate ?? sectionRate(code, input.date, input.ourForm === 'proprietorship' ? 'INDIVIDUAL' : 'FIRM') ?? 0;
  const fy = fyQuarterOf(input.date)?.fy;
  const fyBefore = round2(input.invoices
    .filter((i) => i.id !== input.excludeId && i.status !== 'Draft' && i.status !== 'Cancelled' && sameClient(i, input.client) && fyQuarterOf(String(i.issue_date ?? '').slice(0, 10))?.fy === fy && String(i.issue_date) <= input.date)
    .reduce((s, i) => s + (i.doc_type === 'CREDIT_NOTE' ? -1 : isRevenueDoc(i) ? 1 : 0) * feeBase(i), 0));
  const th = tdsThreshold(family, input.date) ?? {};
  const after = round2(fyBefore + input.base);
  const single = th.single && input.base > th.single;
  const agg = th.aggregate && after > th.aggregate;
  const limit = th.aggregate ?? th.single ?? 0;
  const applies = !th.single && !th.aggregate ? true : !!(single || agg);
  const amount = applies ? round2((input.base * rate) / 100) : 0;
  const label = sectionText(code, input.date);
  return {
    applies, section: def.section, code, rate, base: round2(input.base), amount, fyBefore, threshold: limit,
    message: applies ? `TDS expected u/s ${label} at ${rate}% on the fee base ₹${round2(input.base)} (GST and pure-agent recoveries out) — verify with your CA.` : `TDS not expected yet (₹${after} of ₹${limit} this FY, ${label}).`,
  };
}

/** One client × quarter whose Form 131 / 16A is not in hand (from the receivable register). */
export interface ChaseRow {
  partyKey: string;
  partyName: string;
  fy: number;
  quarter: Quarter;
  due: string;
  overdue: boolean;
  tds: number;
  invoices: { number: string; date: string; tds: number }[];
}

/** Certificates to chase in an FY: every deductor × quarter not received; `overdue` once its due date has passed. */
export function chaseList(reg: TdsRegister, today: string, fy?: number): ChaseRow[] {
  const out: ChaseRow[] = [];
  for (const q of reg.quarters) {
    if (fy !== undefined && q.fy !== fy) continue;
    const due = form16aDueDate(q.fy, q.quarter);
    const by = new Map<string, ChaseRow>();
    for (const r of q.rows) {
      if (r.certificate === 'received') continue;
      const row = by.get(r.partyKey) ?? { partyKey: r.partyKey, partyName: r.partyName, fy: q.fy, quarter: q.quarter, due, overdue: today > due, tds: 0, invoices: [] };
      row.tds = round2(row.tds + r.tdsExpected);
      row.invoices.push(...r.invoices.map((i) => ({ number: i.number, date: i.date, tds: i.tds })));
      by.set(r.partyKey, row);
    }
    out.push(...by.values());
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due) || a.partyName.localeCompare(b.partyName));
}

/** The chase letter (plain text for PDF / `wa.me` / `mailto:`); form names by the quarter's date (Form 131 from TY 2026-27). */
export function chaseLetter(r: ChaseRow, firm: string): string {
  const qs = quarterStart(r.fy, r.quarter);
  const form = formText('16A', qs, { old: '(earlier {code})', verify: '', form: 'Form {n}' });
  const fyText = `FY ${r.fy}-${String(r.fy + 1).slice(2)}`;
  return [
    `Dear ${r.partyName},`,
    '',
    `We have not yet received your TDS certificate (${form}) for Q${r.quarter} of ${fyText}, due by ${r.due}, for the tax you deducted on our invoices:`,
    ...r.invoices.map((i) => `• ${i.number} dated ${i.date}: TDS ₹${i.tds}`),
    `Total TDS: ₹${r.tds}.`,
    '',
    `Please send the certificate, and check that the deduction appears against our PAN in ${formText('26AS', qs, { old: '(earlier {code})', verify: '', form: 'Form {n}' })}.`,
    '',
    'Thank you,',
    firm,
  ].join('\n');
}
