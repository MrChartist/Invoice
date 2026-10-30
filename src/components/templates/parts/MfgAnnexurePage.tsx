import type { InvoiceRecord } from '../../../types/invoice';
import styles from './mfg-paper.module.css';

/**
 * R13 (MF-A5) manufacturing annexure as a following page (the R3-B4 pattern): the size × colour breakdown of a garment
 * invoice (C), the inspection summary of an engineering invoice (B1), the scrap weighment of a scrap invoice (B3) — from
 * the `mf` snapshot only, never recomputed. Nothing without one of them.
 */
export default function MfgAnnexurePage({ invoice }: { invoice: InvoiceRecord }) {
  const mf = invoice.mf;
  const grid = mf?.cmt?.grid ?? [];
  const insp = mf?.drawing?.inspection;
  const scrap = mf?.scrap?.rows ?? [];
  if (!grid.length && !insp && !scrap.length) return null;
  const sizes = mf?.cmt?.sizes ?? [];
  return (
    <section className={styles.page} data-mfg-annexure>
      <div className={styles.title}>Annexure: {invoice.invoice_number || 'draft'}</div>
      {grid.length > 0 && (
        <table className={styles.table} data-mfg-sizes>
          <thead><tr><th>Colour</th>{sizes.map((s) => <th key={s}>{s}</th>)}<th>Total</th></tr></thead>
          <tbody>{grid.map((g) => <tr key={g.colour}><th>{g.colour}</th>{g.qty.map((q, i) => <td key={i}>{q}</td>)}<td>{g.qty.reduce((a, b) => a + (Number(b) || 0), 0)}</td></tr>)}</tbody>
        </table>
      )}
      {insp && (
        <table className={styles.table} data-mfg-inspection>
          <tbody>
            {insp.report_no && <tr><th>Inspection report</th><td>{insp.report_no}</td></tr>}
            {insp.result && <tr><th>Result</th><td>{insp.result}</td></tr>}
            {(insp.rows ?? []).map((r) => <tr key={r.label}><th>{r.label}</th><td>{r.value}</td></tr>)}
          </tbody>
        </table>
      )}
      {scrap.length > 0 && (
        <table className={styles.table} data-mfg-scrap>
          <thead><tr><th>Item</th><th>Gross kg</th><th>Tare kg</th><th>Net kg</th></tr></thead>
          <tbody>{scrap.map((r, i) => <tr key={i}><th>{r.item}</th><td>{r.gross_kg ?? ''}</td><td>{r.tare_kg ?? ''}</td><td>{r.net_kg}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
