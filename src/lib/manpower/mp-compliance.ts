/**
 * R17-C1 client compliance pack (pure). For each row of a site's muster, the month's FINALISED payroll run line of that
 * person × (site duties ÷ the person's duties across every site that month): gross, PF wages, EE / ER PF, EPS, EDLI,
 * admin, ESI EE / ER, deductions and net (MP26). Totals over a site equal the run's for people who worked only there.
 * `proved` needs the PF TRRN and, when ESI is due, the ESI challan (the CN-D2 rule, MP18). A client's hold is shown,
 * never posted: the receivable stays open (MP27). The annexure shows the UAN's last four digits only; bank details are
 * never read. Working papers — verify with your CA / labour-law adviser (MP18, MP26, MP28).
 */
import type { PayslipLine } from '../../types/payroll';
import type { SiteCompliance, SiteMuster } from '../../types/manpower-r17';
import { round2 } from '../invoice-calc';

export const SHARE_KEYS = ['gross', 'pf_wages', 'pf_ee', 'epf_er', 'eps', 'edli', 'pf_admin', 'esi_ee', 'esi_er', 'total_deductions', 'net'] as const;
export type ShareKey = (typeof SHARE_KEYS)[number];
export type RunLine = Pick<PayslipLine, 'employee_id' | 'code' | 'name' | 'uan' | 'earnings' | 'units' | 'payable_days' | ShareKey>;
export type Amounts = Record<ShareKey, number>;
export interface Share extends Amounts { employee_id: string; name: string; code: string; uan: string; duties: number; relief: boolean; ratio: number }

/** A person's duties across every muster of the month. */
export const dutiesOf = (all: readonly SiteMuster[], month: string, employeeId: string): number =>
  all.filter((m) => m.month === month).reduce((t, m) => t + m.rows.filter((r) => r.employee_id === employeeId).reduce((s, r) => s + (Number(r.duties) || 0), 0), 0);

/** `••••1234` (DPDP minimisation on the client's copy). */
export const uan4 = (uan?: string): string => (uan && uan.length >= 4 ? `••••${uan.slice(-4)}` : '');

/** One share per muster row (people missing from the run are left out: the run is the source). */
export function siteShares(m: Pick<SiteMuster, 'month' | 'rows'>, all: readonly SiteMuster[], lines: readonly RunLine[]): Share[] {
  const out: Share[] = [];
  for (const r of m.rows) {
    const l = lines.find((x) => x.employee_id === r.employee_id);
    const tot = dutiesOf(all, m.month, r.employee_id);
    if (!l || !tot || !(r.duties > 0)) continue;
    const ratio = Math.min(1, r.duties / tot);
    const amt = Object.fromEntries(SHARE_KEYS.map((k) => [k, round2((Number(l[k]) || 0) * ratio)])) as Amounts;
    out.push({ ...amt, employee_id: r.employee_id, name: l.name, code: l.code, uan: uan4(l.uan), duties: r.duties, relief: !!r.relief, ratio });
  }
  return out;
}

export const sumShares = (s: readonly Partial<Amounts>[]): Amounts => Object.fromEntries(SHARE_KEYS.map((k) => [k, round2(s.reduce((t, x) => t + (x[k] ?? 0), 0))])) as Amounts;
/** Employer PF (EPF + EPS + EDLI + admin) and ESI of a share. */
export const employerCost = (a: Amounts): number => round2(a.epf_er + a.eps + a.edli + a.pf_admin + a.esi_er);
export const pfDue = (a: Amounts): number => round2(a.pf_ee + a.epf_er + a.eps + a.edli + a.pf_admin);
export const esiDue = (a: Amounts): number => round2(a.esi_ee + a.esi_er);

/** Why a row cannot be saved as given ('' = fine). */
export function proofError(c: Pick<SiteCompliance, 'status' | 'pf' | 'esi'>, totals: Amounts): string {
  if (c.status !== 'proved') return '';
  if (!c.pf?.trrn?.trim()) return 'pf';
  if (esiDue(totals) > 0 && !c.esi?.challan?.trim()) return 'esi';
  return '';
}

/** The amount a client holds on a bill (typed amount, else % of the bill's total). */
export const holdOf = (h: SiteCompliance['hold'], billTotal: number): number => round2(h?.amount ?? ((Number(h?.pct) || 0) * billTotal) / 100);
