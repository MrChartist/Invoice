/**
 * CN-A3 / A4: the construction snapshot `boq_terms.cn` written on an RA bill (by `saveRaBill`) or on any invoice the
 * user marks "works-contract bill" (editor → Contract & RA panel). The paper reads ONLY this snapshot (and
 * `ra_deductions` / `ra_net_payable`), so an issued bill prints the same forever (Critical Rule 3).
 *
 *  - header: contract particulars from the contract (CN-B1, when one exists) or the BOQ's `boq_terms` and typed fields;
 *  - lines: per invoice line — BOQ item no., M-book ref, class, kind, approval and the certified quantities;
 *  - abstract: the abstract of cost rows (`cn-abstract.ts`), printed as the following page.
 * Pure helpers + two small writers (`recomputeDraftSnapshot`, `markWorksBill`). Working paper — verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { MeasurementLine } from '../../types/transport-works-r5';
import type { CnClass, CnHeader, CnLine, CnSite, CnSnapshot, ConstructionKind, ConstructionSettings } from '../../types/construction-r11';
import { num } from '../invoice-calc';
import { localDb } from '../localDb';
import { boqLines } from '../works/boq';
import { DEFAULT_CERTIFICATE, DEVIATION_DEFAULTS } from '../construction-rules';
import { ruleAt } from '../tax-rules';
import { buildAbstract, earlierStages, itemKind } from './cn-abstract';

/** A contract register row (CN-B1) as far as the bill header needs it; every field optional. */
export interface ContractLike {
  name_of_work?: string;
  agreement_no?: string;
  agreement_date?: string;
  work_order_no?: string;
  work_order_date?: string;
  tender_ref?: string;
  client_office?: string;
  engineer?: string;
  site?: CnSite;
  contract_value?: number;
  stipulated_start?: string;
  stipulated_completion?: string;
  extended_completion?: string;
  deviation_pct?: number;
  jv_note?: string;
}

export interface HeaderRequest {
  raNo: number;
  final?: boolean;
  /** Measurement / bill date (local day). */
  date: string;
  period_from?: string;
  period_to?: string;
  measured_on?: string;
  mb_refs?: readonly (string | undefined)[];
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const t = v % 100;
  const s = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th';
  return `${v}${s}`;
}

/** "4th RA bill (running)" / "Final bill". */
export const raLabel = (raNo: number, final?: boolean): string => (final ? 'Final bill' : `${ordinal(raNo)} RA bill (running)`);

/** M-book numbers from refs like "112/45–47" or "MB 112 pp 45" (unique, in order). */
export function mbNumbers(refs: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const m = /(\d+[A-Za-z-]*)/.exec(String(r ?? '').replace(/^\s*MB\s*/i, ''));
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const clean = <T extends object>(o: T): T => {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.keys(v).length)) delete out[k];
  }
  return out as T;
};

/**
 * Pure: the contract-particulars header. Contract (B1) first, then the BOQ's typed header / work order / site, then the
 * BOQ itself (work order no. from its reference, date of the BOQ, contract value = BOQ taxable value).
 */
export function cnHeaderSnapshot(boq: Pick<InvoiceRecord, 'invoice_number' | 'issue_date' | 'po_number' | 'boq_terms'>, contract: ContractLike | undefined, req: HeaderRequest, contractValue?: number): CnHeader {
  const typed = boq.boq_terms?.header ?? {};
  const c = contract ?? {};
  const pick = <K extends keyof CnHeader & keyof ContractLike>(k: K) => (c[k] ?? typed[k]) as CnHeader[K];
  const site = c.site ?? typed.site ?? boq.boq_terms?.site;
  return clean<CnHeader>({
    name_of_work: pick('name_of_work'),
    agreement_no: pick('agreement_no'),
    agreement_date: pick('agreement_date'),
    work_order_no: pick('work_order_no') ?? (boq.boq_terms?.work_order || boq.po_number || undefined),
    work_order_date: pick('work_order_date'),
    tender_ref: pick('tender_ref'),
    client_office: pick('client_office'),
    engineer: pick('engineer'),
    ...(site && (site.address || site.state_code) ? { site: clean({ ...site }) } : {}),
    contract_value: num(c.contract_value) > 0 ? num(c.contract_value) : num(typed.contract_value) > 0 ? num(typed.contract_value) : contractValue,
    stipulated_start: pick('stipulated_start'),
    stipulated_completion: pick('stipulated_completion'),
    extended_completion: pick('extended_completion'),
    ra_label: raLabel(req.raNo, req.final),
    period_from: req.period_from,
    period_to: req.period_to ?? req.date,
    measured_on: req.measured_on ?? req.date,
    mb_nos: mbNumbers(req.mb_refs ?? []),
    jv_note: pick('jv_note'),
  });
}

/** Deviation limit in force: contract, else the BOQ's, else the company setting, else the dated default (25%). */
export function deviationPct(boq: Pick<InvoiceRecord, 'boq_terms'>, contract?: ContractLike, settings?: ConstructionSettings, date?: string): number {
  for (const v of [contract?.deviation_pct, boq.boq_terms?.deviation_pct, settings?.deviation_pct]) if (v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0) return Number(v);
  return ruleAt(DEVIATION_DEFAULTS, date).pct;
}

/** Default class of a BOQ line: the BOQ's own snapshot / catalogue class, else works contract (general). */
const boqClass = (boq: Pick<InvoiceRecord, 'boq_terms'>, l: InvoiceItem): CnClass => boq.boq_terms?.cn?.lines?.[l.id]?.cls ?? l.cn_class ?? 'wc_general';

/**
 * Pure: the per-line snapshot of a bill — BOQ no., M-book (from the measurement), class, kind (A4) and the certified
 * quantities of the abstract row the line belongs to.
 */
export function cnLineSnapshot(boq: InvoiceRecord, items: readonly InvoiceItem[], measured: readonly MeasurementLine[], kinds: Readonly<Record<string, CnLine>> = {}): Record<string, CnLine> {
  const out: Record<string, CnLine> = {};
  for (const it of items) {
    const l = boqLines(boq).find((x) => x.id === it.progress_line_of);
    const m = measured.find((x) => x.line_id === it.progress_line_of);
    const own = kinds[it.id] ?? {};
    let kind = own.kind ?? itemKind(it);
    if (m?.kind === 'substituted' && kind === 'boq') kind = 'substituted';
    if (m?.kind === 'extra' && kind === 'boq') kind = 'extra'; // the measured line is declared an extra item
    out[it.id] = clean<CnLine>({
      ref: own.ref ?? l?.boq_ref ?? it.boq_ref,
      mb: own.mb ?? m?.mb_ref,
      cls: own.cls ?? (l ? boqClass(boq, l) : it.cn_class),
      kind,
      approval: own.approval ?? (kind !== 'boq' ? m?.approval || (kind === 'extra' ? m?.extra?.reason : undefined) : undefined),
      substitutes: kind === 'substituted' ? own.substitutes ?? m?.substitutes : undefined,
    });
  }
  return out;
}

/** Copy the certified quantities of the abstract rows onto the line snapshot (BOQ / prev / cumulative). */
export function withLineQuantities(lines: Record<string, CnLine>, items: readonly InvoiceItem[], abstract: NonNullable<CnSnapshot['abstract']>): Record<string, CnLine> {
  const out: Record<string, CnLine> = {};
  for (const it of items) {
    const l = lines[it.id];
    if (!l) continue;
    const kind = l.kind ?? 'boq';
    const row = abstract.find((r) => (kind === 'boq' ? r.id === it.progress_line_of : r.id === `${it.progress_line_of}:${kind}`));
    out[it.id] = row ? { ...l, boq_qty: row.boq_qty, prev_qty: row.prev_qty, cum_qty: row.cum_qty, prev_amount: row.prev_amount, cum_amount: row.cum_amount } : { ...l };
  }
  return out;
}

export interface RaSnapshotInput {
  boq: InvoiceRecord;
  bill: Pick<InvoiceRecord, 'id' | 'items' | 'progress_of'>;
  invoices: readonly InvoiceRecord[];
  measured: readonly MeasurementLine[];
  header: CnHeader;
  settings: ConstructionSettings;
  deviation_pct: number;
}

/** Pure: the whole snapshot of an RA bill. */
export function buildRaSnapshot(i: RaSnapshotInput): CnSnapshot {
  const base = cnLineSnapshot(i.boq, i.bill.items, i.measured);
  const abstract = buildAbstract(i.boq, i.bill, earlierStages(i.boq.id, i.bill, i.invoices), base);
  return clean<CnSnapshot>({
    v: 1,
    works: true,
    header: i.header,
    lines: withLineQuantities(base, i.bill.items, abstract),
    abstract,
    paper: i.settings.ra_paper ?? 'standard',
    certificate: certificateOf(i.settings),
    deviation_pct: i.deviation_pct,
  });
}

/** The certificate snapshot from the company settings (certificate on by default; boxes for government work). */
export function certificateOf(s: ConstructionSettings): CnSnapshot['certificate'] {
  if (s.certificate === false && !s.signoff_boxes) return undefined;
  return clean({ ...(s.certificate !== false ? { text: s.certificate_text || DEFAULT_CERTIFICATE } : {}), ...(s.signoff_boxes ? { boxes: true } : {}) });
}

/** Does a document print the construction paper? (a snapshot or an RA number; never a BOQ's own terms). */
export const hasCnPaper = (inv: Pick<InvoiceRecord, 'boq_terms' | 'ra_no'>): boolean => !!inv.boq_terms?.cn || num(inv.ra_no) > 0;

/**
 * "Recompute" on the RA register: re-snapshot the abstract / line quantities of a DRAFT RA bill only (issued bills
 * never change). Keeps header, M-book refs and classes.
 */
export function recomputeDraftSnapshot(invoiceId: string): InvoiceRecord {
  const bill = localDb.invoices.getById(invoiceId);
  if (!bill || !bill.boq_id) throw new Error('RA bill not found.');
  if (bill.status !== 'Draft') throw new Error('Only a draft RA bill can be recomputed; an issued bill prints as certified.');
  const boq = localDb.invoices.getById(bill.boq_id);
  if (!boq) throw new Error('BOQ not found.');
  const cn = bill.boq_terms?.cn ?? {};
  const lines = cn.lines ?? {};
  const abstract = buildAbstract(boq, bill, earlierStages(boq.id, bill, localDb.invoices.getAll()), lines);
  return localDb.invoices.save({ ...bill, boq_terms: { ...bill.boq_terms, cn: { ...cn, abstract, lines: withLineQuantities(lines, bill.items, abstract) } } });
}

/** Certificate defaults by kind: every construction kind prints the contractor's certificate; builders' demands do not. */
export function defaultCertificateFor(kind: ConstructionKind | undefined, government: boolean): { text?: string; boxes: boolean } {
  return { ...(kind === 'builder' ? {} : { text: DEFAULT_CERTIFICATE }), boxes: government };
}

