/**
 * R14 PS-C3: evidence of realisation per services export — IRMs allocated (`export_irms`), the bank's FIRA / e-FIRC
 * reference (`ExportIrm.ps.fira_no`), e-BRC no. / date, realised foreign currency and rupees, and the short realisation
 * split into charges deducted abroad (foreign bank charges or a platform fee — a receipt noted "Platform: …": what the
 * receipts record but the IRMs do
 * not, plus a write-off whose reason names charges — a reduction the exporter may declare, Reg 6 proviso, ≤ ₹10 lakh)
 * and the unrealised rest (Rule 96A clock, X2). Pure over the register rows. Working paper — verify with your CA (PS17).
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { ExportIrm } from '../../types/trade-r4';
import type { RealisationRow } from '../trade/export-register';
import { receiptInr } from '../fx-gain';
import { fxRate } from '../fx';
import { mulRound2, round2 } from '../invoice-calc';
import { movedNoCash } from '../advance-tax';
import type { PsExport } from './ps-export-check';

/** `ExportIrm.ps` (PS-C block). */
export interface PsIrm {
  fira_no?: string;
}
export const CHARGES_LIMIT_INR = 1000000;
const CHARGE_WORDS = /charge|platform|fee/i;

export interface BrcRow {
  invoiceId: string;
  number: string;
  date: string;
  party: string;
  currency: string;
  fcy: number;
  valueInr: number;
  realisedFcy: number;
  realisedInr: number;
  fira: string[];
  ebrc: { no: string; date?: string; status?: string }[];
  chargesFcy: number;
  chargesReason: '' | 'bank' | 'platform';
  /** Charges above the declaration limit (Reg 6 proviso). */
  chargesOver: boolean;
  unrealisedFcy: number;
  dueDate: string;
  status: RealisationRow['status'];
}

type Inv = Partial<InvoiceRecord> & { ps?: { export?: PsExport } };

export function brcRows(rows: readonly RealisationRow[], invoices: readonly Inv[], payments: readonly Partial<Payment>[], irms: readonly (ExportIrm & { ps?: PsIrm })[]): BrcRow[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const irmById = new Map(irms.map((m) => [m.id, m]));
  return rows.map((r) => {
    const inv = byId.get(r.invoiceId) ?? {};
    const rate = fxRate(inv) ?? 1;
    const mine = payments.filter((p) => p?.invoice_id === r.invoiceId && (!movedNoCash(p) || !!p.advance_id));
    const receivedInr = round2(mine.reduce((s, p) => s + receiptInr({ amount: Number(p.amount) || 0, realised_rate: p.realised_rate }, inv as InvoiceRecord), 0));
    // Charges: received in the books but not at the bank (IRMs), else the fees a platform receipt noted.
    const noted = mine.reduce((s, p) => s + (Number(/^Platform:.*\(fees ([\d.]+)/.exec(String(p.note ?? ''))?.[1]) || 0), 0);
    const deducted = r.irms.length ? round2(Math.max(Math.min(r.receivedFcy, r.fcy) - r.irmFcy, 0)) : round2(noted);
    const declared = r.writeOffReason && CHARGE_WORDS.test(r.writeOffReason) ? r.writtenOffFcy : 0;
    const chargesFcy = round2(deducted + declared);
    const platform = !!inv.ps?.export?.platform || mine.some((p) => /^Platform:/.test(String(p.note ?? ''))) || /platform/i.test(r.writeOffReason ?? '');
    return {
      invoiceId: r.invoiceId,
      number: r.number,
      date: r.invoiceDate,
      party: r.party,
      currency: r.currency,
      fcy: r.fcy,
      valueInr: mulRound2(r.fcy, rate),
      realisedFcy: r.realisedFcy,
      realisedInr: receivedInr || mulRound2(r.realisedFcy, rate),
      fira: [...new Set(r.irms.map((m) => String(irmById.get(m.id)?.ps?.fira_no ?? '').trim()).filter(Boolean))],
      ebrc: r.irms.filter((m) => m.ebrc_no).map((m) => ({ no: String(m.ebrc_no), date: irmById.get(m.id)?.ebrc_date, status: m.ebrc_status })),
      chargesFcy,
      chargesReason: chargesFcy > 0 ? (platform ? 'platform' : 'bank') : '',
      chargesOver: mulRound2(chargesFcy, rate) > CHARGES_LIMIT_INR,
      unrealisedFcy: r.outstandingFcy,
      dueDate: r.dueDate,
      status: r.status,
    };
  });
}
