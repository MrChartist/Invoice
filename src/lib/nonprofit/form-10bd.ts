/**
 * R5-C3 Form 10BD (Form 113 from FY 2026-27) working file and Form 10BE (Form 114) tracking. One row per donor ×
 * section × donation type × mode, in the column order of the portal's CSV template (`FORM_10BD_COLUMNS`, date-keyed:
 * the template may change). Donations that cannot be reported (no / invalid donor id, anonymous, no section,
 * cancelled) are listed apart. "Mark filed" stores the ARN and a snapshot; receipts of that FY are then frozen.
 * Working paper — verify with your CA (§7 Q10).
 */
import type { Client } from '../../types/invoice';
import type { Donation, Form10bdFiling, Form10bdRow, Form10beRow, NpoProfile } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { toCsv } from '../csv';
import { round2 } from '../invoice-calc';
import { FORM_10BD_COLUMNS, FORM_10BD_DUE_RULES, afterFy, ruleAt } from '../r5c-rules';
import { FORM_10BD_TABLE, FORM_10BE_TABLE, R5cError, day, findCol, str } from '../institutions/r5c';
import { donorIdValid, fyOf } from './donations';

export type Unreportable = 'cancelled' | 'anonymous' | 'section' | 'id';

/** 10BD rows for FY `fy` (start year) and the donations left out, with why. */
export function build10bd(donations: readonly Donation[], donors: ReadonlyMap<string, Client>, fy: number): { rows: Form10bdRow[]; left: { d: Donation; why: Unreportable }[] } {
  const t = ruleAt(FORM_10BD_COLUMNS, `${fy + 1}-04-01`);
  const groups = new Map<string, Form10bdRow>();
  const left: { d: Donation; why: Unreportable }[] = [];
  for (const d of donations) {
    if (fyOf(d.date) !== fy) continue;
    const donor = donors.get(d.donor_id);
    const why: Unreportable | '' = d.cancelled ? 'cancelled' : d.anonymous ? 'anonymous' : d.section === 'none' ? 'section' : !donorIdValid(donor?.donor?.id_code, donor?.donor?.id_no) ? 'id' : '';
    if (why) {
      if (why !== 'cancelled') left.push({ d, why });
      continue;
    }
    const k = `${d.donor_id}|${d.section}|${d.type}|${d.mode}`;
    const g = groups.get(k);
    if (g) g.amount = round2(g.amount + d.amount);
    else groups.set(k, {
      sr: 0, donor_id: d.donor_id, id_code: t.idCodes[donor!.donor!.id_code] ?? donor!.donor!.id_code, id_no: str(donor!.donor!.id_no).toUpperCase(),
      section: t.sections[d.section] ?? d.section, name: donor!.company || donor!.name, address: [donor!.address, donor!.city, donor!.zip].filter(Boolean).join(', '),
      type: t.types[d.type] ?? d.type, mode: t.modes[d.mode] ?? d.mode, amount: round2(d.amount),
    });
  }
  const rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.section.localeCompare(b.section)).map((r, i) => ({ ...r, sr: i + 1 }));
  return { rows, left };
}

/** The 10BD CSV in the template's column order (URN and its date from the registration profile). */
export function form10bdCsv(rows: readonly Form10bdRow[], fy: number, npo: Partial<NpoProfile> | undefined): string {
  const t = ruleAt(FORM_10BD_COLUMNS, `${fy + 1}-04-01`);
  const urnDate = day(npo?.urn_80g_date);
  const dmy = urnDate ? `${urnDate.slice(8, 10)}/${urnDate.slice(5, 7)}/${urnDate.slice(0, 4)}` : '';
  return toCsv([t.columns, ...rows.map((r) => [r.sr, '', r.id_code, r.id_no, r.section, str(npo?.urn_80g), dmy, r.name, r.address, r.type, r.mode, r.amount])]);
}

/** Due date of the FY's 10BD and the 10BE certificates. */
export function due10bd(fy: number): { bd: string; be: string; lateFeePerDay: number } {
  const r = ruleAt(FORM_10BD_DUE_RULES, `${fy + 1}-04-01`);
  return { bd: afterFy(fy, r.monthDay), be: afterFy(fy, r.beBy), lateFeePerDay: r.lateFeePerDay };
}

export const loadFilings = (): Form10bdFiling[] => peekTable<Form10bdFiling>(FORM_10BD_TABLE).filter((f) => f && f.id) as Form10bdFiling[];
export const filingFor = (fy: number) => loadFilings().find((f) => f.fy === fy);

/** "Mark filed": ARN, date and the rows as filed. Receipts of the FY are frozen from then. */
export function markFiled(fy: number, arn: string, filedOn: string, rows: readonly Form10bdRow[]): Form10bdFiling {
  requireAccess('books.edit');
  if (!str(arn) || !day(filedOn)) throw new R5cError('arn');
  const all = getTable<Form10bdFiling>(FORM_10BD_TABLE);
  const prev = all.find((f) => f.fy === fy);
  const row: Form10bdFiling = { id: prev?.id ?? generateId(), fy, arn: str(arn), filed_on: day(filedOn), rows_snapshot: rows.map((r) => ({ ...r })) };
  setTable(FORM_10BD_TABLE, prev ? all.map((f) => (f.id === row.id ? row : f)) : [...all, row]);
  return row;
}

/* ── 10BE tracking ───────────────────────────────────────────── */

export const load10be = (): Form10beRow[] => peekTable<Form10beRow>(FORM_10BE_TABLE).filter((r) => r && r.id) as Form10beRow[];

/** Save certificate details for donors of a FY (matched by donor id; existing rows updated). */
export function save10be(fy: number, items: readonly { donor_id: string; cert_no: string; cert_date?: string; sent_on?: string }[]): number {
  requireAccess('books.edit');
  const all = getTable<Form10beRow>(FORM_10BE_TABLE);
  let n = 0;
  for (const it of items) {
    if (!str(it.donor_id) || !str(it.cert_no)) continue;
    const i = all.findIndex((r) => r.fy === fy && r.donor_id === it.donor_id);
    const prev = i >= 0 ? all[i] : undefined;
    const row: Form10beRow = { id: prev?.id ?? generateId(), fy, donor_id: it.donor_id, cert_no: str(it.cert_no), ...(day(it.cert_date) || prev?.cert_date ? { cert_date: day(it.cert_date) || prev?.cert_date } : {}), ...(day(it.sent_on) || prev?.sent_on ? { sent_on: day(it.sent_on) || prev?.sent_on } : {}) };
    if (prev) all[i] = row;
    else all.push(row);
    n++;
  }
  setTable(FORM_10BE_TABLE, all);
  return n;
}

/** Mark certificates sent on `date`. */
export function markSent(fy: number, donorIds: readonly string[], date: string): number {
  return save10be(fy, load10be().filter((r) => r.fy === fy && donorIds.includes(r.donor_id)).map((r) => ({ ...r, sent_on: day(date) })));
}

/**
 * Rows of a 10BE file the user downloaded (certificate no., donor id / PAN, date) matched to donors by id number.
 * Returns the matched items and the id numbers that matched nobody.
 */
export function parse10beCsv(headers: readonly string[], rows: readonly (readonly string[])[], donors: readonly Client[]): { items: { donor_id: string; cert_no: string; cert_date?: string }[]; unknown: string[] } {
  const cNo = findCol(headers, ['certificate number', 'certificate no', '10be number', 'acknowledgement number']);
  const cId = findCol(headers, ['unique identification number', 'pan', 'id number', 'identification number']);
  const cDate = findCol(headers, ['date of certificate', 'certificate date', 'date']);
  const byId = new Map(donors.filter((d) => d.donor?.id_no && d.id).map((d) => [str(d.donor!.id_no).toUpperCase(), d.id!]));
  const items: { donor_id: string; cert_no: string; cert_date?: string }[] = [];
  const unknown: string[] = [];
  for (const r of rows) {
    const id = str(r[cId]).toUpperCase();
    const no = str(r[cNo]);
    if (!id || !no) continue;
    const donor = byId.get(id);
    if (!donor) unknown.push(id);
    else items.push({ donor_id: donor, cert_no: no, ...(cDate >= 0 ? { cert_date: dmyToIso(str(r[cDate])) } : {}) });
  }
  return { items, unknown };
}

const dmyToIso = (s: string) => {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : day(s);
};

/** Donors of a filed FY's rows without a certificate sent. */
export function pending10be(filing: Form10bdFiling | undefined, be: readonly Form10beRow[]): string[] {
  if (!filing) return [];
  const sent = new Set(be.filter((r) => r.fy === filing.fy && r.sent_on).map((r) => r.donor_id));
  return [...new Set(filing.rows_snapshot.map((r) => r.donor_id))].filter((id) => !sent.has(id));
}
