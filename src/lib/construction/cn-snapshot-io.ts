/**
 * CN-A3: the one call `saveRaBill` makes. Reads the company's construction settings and the BOQ's contract (CN-B1
 * table `works_contracts`, a row with `boq_id` — read only when present, never created here), and returns the
 * deviation limit plus a builder for the bill's `boq_terms.cn` snapshot. Lazy (works chunk only).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { MeasurementLine } from '../../types/transport-works-r5';
import type { CnSite, CnSnapshot } from '../../types/construction-r11';
import { num } from '../invoice-calc';
import { peekTable } from '../storage';
import { shiftDay } from '../dates';
import { contractValue } from '../works/boq';
import { readConstructionSettings } from './cn-settings';
import { buildRaSnapshot, cnHeaderSnapshot, deviationPct, type ContractLike } from './cn-snapshot';

/** CN-B1's contract row as this package reads it (`boq_id` links it to the BOQ). */
export type ContractRow = ContractLike & { id: string; boq_id?: string; boq_ids?: string[] };

/** The contract of a BOQ (CN-B1), if that package has recorded one. */
export function contractOfBoq(boqId: string): ContractRow | undefined {
  return peekTable<ContractRow>('works_contracts').find((c) => c && (c.boq_id === boqId || (Array.isArray(c.boq_ids) && c.boq_ids.includes(boqId))));
}

/** The site of a BOQ: its contract's, else the BOQ's typed header / site. */
export const siteOfBoq = (boq: Pick<InvoiceRecord, 'boq_terms'>, contract?: ContractLike): CnSite | undefined => {
  const s = contract?.site ?? boq.boq_terms?.header?.site ?? boq.boq_terms?.site;
  return s && (s.address || s.state_code) ? s : undefined;
};

export interface RaSnapshotPlan {
  contract?: ContractRow;
  deviationPct: number;
  build: (bill: InvoiceRecord, invoices: readonly InvoiceRecord[], lines: readonly MeasurementLine[]) => CnSnapshot;
}

/** Plan the snapshot of RA bill `raNo` of `boq` (`req` = the measurement request: date, final, period, measured on). */
export function raSnapshotFor(boq: InvoiceRecord, raNo: number, req: { date: string; final?: boolean; period_from?: string; period_to?: string; measured_on?: string }): RaSnapshotPlan {
  const settings = readConstructionSettings();
  const contract = contractOfBoq(boq.id);
  const pct = deviationPct(boq, contract, settings, req.date);
  return {
    contract,
    deviationPct: pct,
    build: (bill, invoices, lines) => {
      // Period from: the day after the last live RA bill's period (else blank: the first bill states its own).
      const lastTo = invoices.filter((i) => i.boq_id === boq.id && i.id !== bill.id && i.status !== 'Cancelled' && num(i.ra_no) > 0 && num(i.ra_no) < raNo)
        .map((i) => i.boq_terms?.cn?.header?.period_to ?? i.issue_date).sort().pop();
      const header = cnHeaderSnapshot(boq, contract, {
        raNo, final: req.final, date: req.date, period_from: req.period_from || (lastTo ? shiftDay(lastTo, 1) : undefined), period_to: req.period_to, measured_on: req.measured_on,
        mb_refs: lines.map((l) => l.mb_ref),
      }, contractValue(boq));
      return buildRaSnapshot({ boq, bill, invoices, measured: lines, header, settings, deviation_pct: pct });
    },
  };
}
