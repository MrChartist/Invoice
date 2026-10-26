/**
 * R4-C3 Bill of Entry duty calculator and import costing (pure, plus one posting helper).
 *
 *   AV   = CIF × customs exchange rate × (1 + landing charge %)      (landing charge: 1% historically, 0 now — dated)
 *   BCD  = AV × BCD %
 *   SWS  = BCD × SWS %                                                (10% of BCD by default — dated)
 *   IGST = (AV + BCD + SWS + other duties) × IGST %                   (base set by the dated rule; cess not in it)
 *   cess = same base × cess %
 * each rounded to the rupee (Sec 154A, rule flag). The AV is split over the bill's goods lines by value unless typed.
 *
 * Applying the sheet to an import-of-goods bill: IGST and cess go into the bill's own tax fields (ITC as today,
 * GSTR-3B 4A(1)); BCD, SWS and other duties become `landed_costs` rows ("BCD", "SWS", "Other customs duties"), so
 * they load stock cost through the existing landed-cost path; the sheet is stored on the bill (`boe_duty`).
 * "Post duty" writes Dr Customs duty on imports | Cr Customs duty payable. Duty is in stock cost for valuation and
 * an expense in the books; closing stock carries it — verify with your CA.
 */
import type { BoeDuty, BoeDutyLine, BoeDutyTotals } from '../../types/trade-r4';
import type { PurchaseRecord } from '../../types/purchases';
import { round2 } from '../invoice-calc';
import { readPurchase } from '../purchase-normalize';
import { cleanLandedCosts, type LandedCharge } from '../landed-cost';
import { customsIgstBase, customsLandingChargePct, customsSwsPct } from './trade-rules';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface BoeLineInput {
  line_id: string;
  cth?: string;
  /** Line value used to split the AV (quantity × rate on the bill). */
  value: number;
  /** Typed assessable value (₹); absent → allocated by value. */
  av?: number;
  bcd_pct: number;
  /** Absent → the dated default (10% of BCD). */
  sws_pct?: number;
  igst_pct: number;
  cess_pct?: number;
  other?: number;
}

export interface BoeInput {
  /** BOE date (rules are read on it). */
  date: string;
  rate: number;
  currency?: string;
  fob?: number;
  freight?: number;
  insurance?: number;
  /** CIF in foreign currency (wins over FOB + freight + insurance). */
  cif?: number;
  lines: readonly BoeLineInput[];
}

/** CIF in foreign currency: typed, else FOB + freight + insurance. */
export const cifOf = (i: Pick<BoeInput, 'cif' | 'fob' | 'freight' | 'insurance'>): number =>
  n(i.cif) > 0 ? round2(n(i.cif)) : round2(n(i.fob) + n(i.freight) + n(i.insurance));

/** Split `total` by `weights` in paise; drift to the largest share, so the parts add up exactly. */
function splitByValue(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  const p = Math.round(total * 100);
  if (!(sum > 0)) {
    const each = weights.length ? Math.floor(p / weights.length) : 0;
    return weights.map((_, i) => (each + (i === 0 ? p - each * weights.length : 0)) / 100);
  }
  const parts = weights.map((w) => Math.round((p * Math.max(w, 0)) / sum));
  const drift = p - parts.reduce((s, x) => s + x, 0);
  if (drift) {
    let big = 0;
    parts.forEach((x, i) => (x > parts[big] ? (big = i) : 0));
    parts[big] += drift;
  }
  return parts.map((x) => x / 100);
}

export class BoeError extends Error {}

/** The duty sheet for `input` (throws `BoeError` with an area key for a missing rate / CIF). */
export function computeBoe(input: BoeInput): BoeDuty {
  const rate = n(input.rate);
  if (!(rate > 0)) throw new BoeError('boeRate');
  const cif = cifOf(input);
  if (!(cif > 0)) throw new BoeError('boeCif');
  const date = input.date;
  const base = customsIgstBase(date);
  const R = (x: number) => (base.roundRupee ? Math.round(x) : round2(x));
  const landing = customsLandingChargePct(date);
  const avTotal = round2(cif * rate * (1 + landing / 100));
  const typed = input.lines.map((l) => (l.av !== undefined && n(l.av) > 0 ? round2(n(l.av)) : null));
  const typedSum = typed.reduce<number>((s, x) => s + (x ?? 0), 0);
  const freeIdx = input.lines.map((_, i) => i).filter((i) => typed[i] === null);
  const shares = splitByValue(Math.max(round2(avTotal - typedSum), 0), freeIdx.map((i) => n(input.lines[i].value)));
  const swsDefault = customsSwsPct(date);
  const lines: BoeDutyLine[] = [];
  const t: BoeDutyTotals = { av: 0, bcd: 0, sws: 0, other: 0, igst: 0, cess: 0, duty: 0, total: 0 };
  input.lines.forEach((l, i) => {
    const av = typed[i] ?? shares[freeIdx.indexOf(i)] ?? 0;
    const sws_pct = l.sws_pct === undefined ? swsDefault : n(l.sws_pct);
    const bcd = R((av * n(l.bcd_pct)) / 100);
    const sws = R((bcd * sws_pct) / 100);
    const other = R(n(l.other));
    const taxBase = av + bcd + sws + (base.includeOther ? other : 0);
    const igst = R((taxBase * n(l.igst_pct)) / 100);
    const cess = R((taxBase * n(l.cess_pct)) / 100);
    lines.push({
      line_id: l.line_id,
      ...(l.cth ? { cth: l.cth } : {}),
      av,
      ...(typed[i] !== null ? { av_typed: true } : {}),
      bcd_pct: n(l.bcd_pct),
      sws_pct,
      igst_pct: n(l.igst_pct),
      ...(n(l.cess_pct) ? { cess_pct: n(l.cess_pct) } : {}),
      ...(other ? { other } : {}),
    });
    t.av += av;
    t.bcd += bcd;
    t.sws += sws;
    t.other += other;
    t.igst += igst;
    t.cess += cess;
  });
  for (const k of Object.keys(t) as (keyof BoeDutyTotals)[]) t[k] = round2(t[k]);
  t.duty = round2(t.bcd + t.sws + t.other);
  t.total = round2(t.duty + t.igst + t.cess);
  return {
    rate,
    ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
    ...(n(input.fob) ? { fob: round2(n(input.fob)) } : {}),
    ...(n(input.freight) ? { freight: round2(n(input.freight)) } : {}),
    ...(n(input.insurance) ? { insurance: round2(n(input.insurance)) } : {}),
    cif,
    lines,
    totals: t,
    rule_date: date,
  };
}

/** Per-line figures of a stored sheet (recomputed from its own rates; for the screen and the register). */
export function lineDuties(d: BoeDuty): { line_id: string; av: number; bcd: number; sws: number; other: number; igst: number; cess: number }[] {
  const base = customsIgstBase(d.rule_date);
  const R = (x: number) => (base.roundRupee ? Math.round(x) : round2(x));
  return d.lines.map((l) => {
    const bcd = R((l.av * l.bcd_pct) / 100);
    const sws = R((bcd * l.sws_pct) / 100);
    const other = R(n(l.other));
    const tb = l.av + bcd + sws + (base.includeOther ? other : 0);
    return { line_id: l.line_id, av: l.av, bcd, sws, other, igst: R((tb * l.igst_pct) / 100), cess: R((tb * n(l.cess_pct)) / 100) };
  });
}

/** Labels of the landed-cost rows the sheet writes (a re-apply replaces exactly these). */
export const DUTY_LABELS = { bcd: 'BCD', sws: 'SWS', other: 'Other customs duties' } as const;
const DUTY_SET = new Set<string>(Object.values(DUTY_LABELS));

/** The bill's landed costs with the sheet's duty rows (earlier duty rows replaced, other charges kept). */
export function dutyLandedCosts(existing: unknown, d: BoeDuty): LandedCharge[] | undefined {
  const keep = (cleanLandedCosts(existing) ?? []).filter((c) => !DUTY_SET.has(c.label));
  const add: LandedCharge[] = [
    { label: DUTY_LABELS.bcd, amount: d.totals.bcd },
    { label: DUTY_LABELS.sws, amount: d.totals.sws },
    { label: DUTY_LABELS.other, amount: d.totals.other },
  ].filter((c) => c.amount > 0);
  return cleanLandedCosts([...keep, ...add]);
}

/**
 * What applying the sheet changes on an import bill: duty rows in `landed_costs`, IGST / cess in the tax fields,
 * the total (taxable + IGST + cess) and the snapshot. CGST / SGST are zero on an import.
 */
export function applyBoe(bill: Pick<PurchaseRecord, 'taxable' | 'landed_costs'>, d: BoeDuty): Pick<PurchaseRecord, 'landed_costs' | 'igst' | 'cgst' | 'sgst' | 'cess_amount' | 'total' | 'boe_duty'> {
  return {
    landed_costs: dutyLandedCosts(bill.landed_costs, d),
    igst: d.totals.igst,
    cgst: 0,
    sgst: 0,
    cess_amount: d.totals.cess > 0 ? d.totals.cess : undefined,
    total: round2(n(bill.taxable) + d.totals.igst + d.totals.cess),
    boe_duty: d,
  };
}

/** Journal lines (paise) for "Post duty": Dr Customs duty on imports | Cr Customs duty payable. */
export function dutyJournalLines(duty: number, ledgers: { customsDuty: string; customsPayable: string }) {
  const p = Math.round(round2(duty) * 100);
  return [
    { account_id: ledgers.customsDuty, dr: p, cr: 0 },
    { account_id: ledgers.customsPayable, dr: 0, cr: p },
  ];
}

/* ── Import register by Bill of Entry ────────────────────────── */

export interface ImportRegisterRow {
  billId: string;
  boeNo: string;
  boeDate: string;
  port: string;
  supplier: string;
  billNo: string;
  av: number;
  bcd: number;
  sws: number;
  other: number;
  igst: number;
  cess: number;
  duty: number;
  total: number;
  /** IGST + cess taken as ITC (0 when the bill's ITC is off). */
  itcTaken: number;
  posted: boolean;
}

/** One row per import bill carrying a BOE sheet, read through `readPurchase` (the purchases contract). */
export function importRegister(purchases: readonly unknown[], range?: { from?: string; to?: string }): ImportRegisterRow[] {
  const out: ImportRegisterRow[] = [];
  for (const raw of purchases) {
    const core = readPurchase(raw);
    const rec = raw as Partial<PurchaseRecord>;
    const d = rec?.boe_duty;
    if (!core || !d || !d.totals) continue;
    const day = String(rec.boe_date || core.date);
    if (range?.from && day < range.from) continue;
    if (range?.to && day > range.to) continue;
    out.push({
      billId: core.id,
      boeNo: String(rec.boe_number ?? ''),
      boeDate: day,
      port: String(rec.port_code ?? ''),
      supplier: core.partyName,
      billNo: core.number,
      av: d.totals.av,
      bcd: d.totals.bcd,
      sws: d.totals.sws,
      other: d.totals.other,
      igst: core.igst,
      cess: core.cess,
      duty: d.totals.duty,
      total: round2(d.totals.duty + core.igst + core.cess),
      itcTaken: core.itcEligible ? round2(core.igst + core.cess - core.itcReversed) : 0,
      posted: !!d.voucher_id,
    });
  }
  return out.sort((a, b) => a.boeDate.localeCompare(b.boeDate) || a.boeNo.localeCompare(b.boeNo));
}

export function importRegisterSheet(rows: readonly ImportRegisterRow[]): (string | number)[][] {
  return [
    ['BOE no.', 'BOE date', 'Port', 'Supplier', 'Bill no.', 'Assessable value', 'BCD', 'SWS', 'Other duties', 'IGST', 'Cess', 'Total duty (stock cost)', 'Paid at customs', 'ITC taken', 'Duty posted'],
    ...rows.map((r) => [r.boeNo, r.boeDate, r.port, r.supplier, r.billNo, r.av, r.bcd, r.sws, r.other, r.igst, r.cess, r.duty, r.total, r.itcTaken, r.posted ? 'Yes' : 'No']),
  ];
}
