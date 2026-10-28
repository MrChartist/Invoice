/**
 * CN-B4: what the client recovers from an RA bill besides the statutory deductions — client-issued material (at the
 * issue rate; wastage beyond the ±3% band at 2× the issue rate), water & electricity (1% + 1%, contract term, from the
 * contract's rules), hire of the client's plant, withheld amounts (reason + expected release, held bucket) and
 * liquidated damages (not a supply, Circular 178/10/2022 — the taxable value of the bill is unchanged). Free-issue
 * material is quantity only (never valued in the bill, CN9). `cnBillDeductions` is the one call `saveRaBill` makes:
 * it adds the contract's advance recovery / interest (`cn-advances.ts`), secured-advance recoveries and the typed rows.
 * GST and the invoice total never change; each row settles at receipt through the RA clearing account
 * (`ra-receivable.ts`, `ra_journal_id`) or stays held. Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { RaDeduction } from '../../types/transport-works-r5';
import type { CnRecoveryInput, WorksContract } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { RECOVERY_DEFAULTS } from '../construction-rules';
import { advanceDeductions, type AdvanceLike } from './cn-advances';
import { securedRecovered, securedRecovery } from './cn-secured';
import { delayDays, ldFrom } from './cn-contracts';
import type { SecuredAdvance } from '../../types/construction-r11';

export interface WastageResult {
  /** Quantity allowed: theoretical × (1 ± band). */
  min: number;
  max: number;
  excess: number;
  shortfall: number;
  /** Excess at `factor` × rate plus shortfall at the issue rate (contract terms). */
  amount: number;
}

/** Pure: recovery for client-issued material consumed outside the band (default ±3%, excess at 2× the issue rate). */
export function wastageRecovery(issued: number, theoretical: number, rate: number, date?: string, band?: number, factor?: number): WastageResult {
  const d = ruleAt(RECOVERY_DEFAULTS, date);
  const b = (band ?? d.wastage_band_pct) / 100;
  const q = (n: number) => Math.round(n * 1000) / 1000;
  const max = q(theoretical * (1 + b));
  const min = q(theoretical * (1 - b));
  const excess = q(Math.max(issued - max, 0));
  const shortfall = q(Math.max(min - issued, 0));
  return { min, max, excess, shortfall, amount: round2(excess * rate * (factor ?? d.penal_factor) + shortfall * rate) };
}

const LABEL: Record<CnRecoveryInput['kind'], string> = {
  secured_advance: 'Secured advance recovery',
  material_recovery: 'Material issued by client — recovery',
  hire_charges: 'Hire of client plant / equipment',
  withheld: 'Amount withheld',
  ld: 'Liquidated damages',
  other: 'Other recovery',
};

/** Pure: one typed recovery row (amount, or qty × rate for material). Null when it comes to nothing. */
export function recoveryRow(r: CnRecoveryInput, taxable: number, ldNote = ''): RaDeduction | null {
  const amount = round2(num(r.amount) > 0 ? num(r.amount) : num(r.qty) * num(r.rate));
  if (!(amount > 0)) return null;
  const extra = r.kind === 'material_recovery' && num(r.qty) > 0 ? ` (${num(r.qty)} @ ₹${num(r.rate)})` : r.kind === 'ld' ? ldNote : '';
  return {
    kind: r.kind, label: `${r.label?.trim() || LABEL[r.kind]}${extra}`.slice(0, 120), base: round2(taxable), amount,
    ...(r.ref_id ? { ref_id: r.ref_id } : {}), ...(r.reason?.trim() ? { reason: r.reason.trim().slice(0, 120) } : {}), ...(r.release_on ? { release_on: r.release_on } : {}),
  };
}

export interface BillDeductionCtx {
  base: readonly RaDeduction[];
  contract?: WorksContract;
  taxable: number;
  date: string;
  /** Earlier live RA bills of the BOQ. */
  earlier: readonly InvoiceRecord[];
  /** Every invoice (secured advances recovered so far). */
  invoices: readonly InvoiceRecord[];
  advances: readonly AdvanceLike[];
  secured: readonly SecuredAdvance[];
  recoveries?: readonly CnRecoveryInput[];
  boqAdvanceId?: string;
  /** The BOQ rule's advance recovery %. */
  rulePct?: number;
}

/** The bill's deductions: base rules, then the contract's advance rows, secured-advance recoveries and typed rows. */
export function cnBillDeductions(x: BillDeductionCtx): RaDeduction[] {
  const c = x.contract;
  const out = c?.advance_terms?.length ? x.base.filter((d) => d.kind !== 'advance_recovery') : [...x.base];
  if (c?.advance_terms?.length) out.push(...advanceDeductions({ contract: c, advances: x.advances, earlier: x.earlier, taxable: x.taxable, date: x.date, boqAdvanceId: x.boqAdvanceId, rulePct: x.rulePct }));
  const days = c ? delayDays(c, x.date) : 0;
  const ldNote = c && days > 0 ? ` (delay ${days} days beyond ${ldFrom(c)})` : '';
  for (const r of x.recoveries ?? []) {
    if (r.kind === 'secured_advance') {
      const sa = x.secured.find((s) => s.id === r.ref_id && s.status === 'open' && (!c || s.contract_id === c.id));
      const amount = sa ? securedRecovery(sa, securedRecovered(sa.id, x.invoices), r) : 0;
      if (sa && amount > 0) out.push({ kind: 'secured_advance', label: `Secured advance recovery (${sa.date})`, base: sa.amount, amount, ref_id: sa.id });
      continue;
    }
    const row = recoveryRow(r, x.taxable, ldNote);
    if (row) out.push(row);
  }
  return out;
}
