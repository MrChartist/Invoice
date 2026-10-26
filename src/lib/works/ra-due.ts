/**
 * R5-B5 `raDueSplit`: an RA bill's open balance split into DUE NOW (net payable less receipts) and HELD buckets —
 * retention (with its release day), GST TDS awaiting credit, labour cess, security deposit, LD / other. Income-tax TDS
 * is not held: receivables already clear it. A held bucket is settled by receipt rows tagged with its `ra_kind`
 * (advance recovery: the advance adjustment). Pure and tiny: it sits in the receivables chunk. Verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';

export interface RaHeld {
  kind: string;
  label: string;
  amount: number;
  release_on?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function raDueSplit(inv: Pick<InvoiceRecord, 'id' | 'ra_deductions' | 'retention_release_on'>, payments: readonly Pick<Payment, 'invoice_id' | 'amount' | 'ra_kind' | 'advance_id'>[], outstanding: number): { dueNow: number; held: RaHeld[]; heldTotal: number } {
  const held: RaHeld[] = [];
  let room = Math.max(outstanding, 0);
  for (const d of inv.ra_deductions ?? []) {
    if (d.kind === 'it_tds') continue;
    const settled = payments.filter((p) => p.invoice_id === inv.id && (d.kind === 'advance_recovery' ? !!p.advance_id : p.ra_kind === d.kind)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const same = (inv.ra_deductions ?? []).filter((x) => x.kind === d.kind);
    const left = r2(Math.min(Math.max(same.reduce((s, x) => s + x.amount, 0) - settled, 0), room));
    if (same[0] !== d || !(left > 0)) continue;
    room = r2(room - left);
    held.push({ kind: d.kind, label: d.label, amount: left, ...(d.kind === 'retention' && inv.retention_release_on ? { release_on: inv.retention_release_on } : {}) });
  }
  const heldTotal = r2(held.reduce((s, h) => s + h.amount, 0));
  return { dueNow: r2(Math.max(outstanding, 0) - heldTotal), held, heldTotal };
}
