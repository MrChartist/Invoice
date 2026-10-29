import type { InvoiceRecord } from '../../../types/invoice';
import styles from './manpower-paper.module.css';

const dmy = (at: string) => at.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1');

/**
 * R21-A4 pump particulars (every layout, receipts included): one row per fuel line — "Petrol (MS) — Nozzle 2-B ·
 * 41.230 L @ ₹94.72 (price of 29-10-2026 06:00)", with the vehicle and slip no. when present — from the document's `fu`
 * snapshot only (a later price or nozzle change never reprints an old bill). Lazy inside TemplateEngine; the R17
 * particulars box styles (template variables only). Loads no Round 21 code.
 */
export default function FuelLines({ invoice }: { invoice: InvoiceRecord }) {
  const rows = (invoice.items ?? []).flatMap((i) => {
    const f = invoice.fu?.lines?.[i.id];
    return f ? [[i.id, `${i.name} — ${[f.nozzle && `Nozzle ${f.nozzle}`, `${f.litres.toFixed(3)} ${f.unit === 'KG' ? 'kg' : 'L'}${f.rsp ? ` @ ₹${f.rsp}` : ''}${f.at ? ` (price of ${dmy(f.at)})` : ''}`, f.vehicle && `Vehicle ${f.vehicle}`, f.slip_no && `Slip ${f.slip_no}`].filter(Boolean).join(' · ')}`]] : [];
  });
  if (!rows.length) return null;
  return <section className={styles.block} aria-label="Fuel" data-fuel-lines>{rows.map(([k, v]) => <div key={k}>{v}</div>)}</section>;
}
