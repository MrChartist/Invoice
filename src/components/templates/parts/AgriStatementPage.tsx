import type { InvoiceRecord } from '../../../types/invoice';
import styles from './agri-paper.module.css';

/**
 * R12 (AG-A5) agri statement as a following page (the R3-B4 annexure pattern): the rent working (D2), the custom-milling
 * statement (C3) and the shift-wise milk lines (B3) — from the `ag` snapshot only, never recomputed. Nothing without one.
 */
export default function AgriStatementPage({ invoice }: { invoice: InvoiceRecord }) {
  const ag = invoice.ag;
  if (!ag) return null;
  const working = ag.rent?.working ?? [];
  const milk = (invoice.items ?? []).map((it) => [it, ag.lines?.[it.id]] as const).filter(([, l]) => l && (l.fat !== undefined || l.litres !== undefined));
  if (!working.length && !milk.length && !ag.cmr) return null;
  return (
    <section className={styles.page} data-agri-statement>
      <div className={styles.title}>Statement: {invoice.invoice_number || 'draft'}</div>
      {working.length > 0 && (
        <table className={styles.table} data-agri-working>
          <tbody>{working.map((w, i) => <tr key={i}><th>{w.label}</th><td>{w.value}</td></tr>)}</tbody>
        </table>
      )}
      {ag.cmr && (
        <table className={styles.table} data-agri-cmr>
          <tbody>
            {([['Paddy received (qtl)', ag.cmr.paddy_qtl], ['Outturn %', ag.cmr.outturn_pct], ['Rice due (qtl)', ag.cmr.rice_due_qtl], ['Rice delivered (qtl)', ag.cmr.rice_delivered_qtl], ['Goods share of value %', ag.cmr.goods_pct]] as const).filter(([, v]) => v !== undefined).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
          </tbody>
        </table>
      )}
      {milk.length > 0 && (
        <table className={styles.table} data-agri-milk>
          <thead><tr><th>Item</th><th>Litres</th><th>Fat %</th><th>SNF %</th><th>Amount</th></tr></thead>
          <tbody>{milk.map(([it, l]) => <tr key={it.id}><td>{it.name}</td><td>{l?.litres ?? it.quantity}</td><td>{l?.fat ?? ''}</td><td>{l?.snf ?? ''}</td><td>{(Number(it.quantity) * Number(it.rate)).toFixed(2)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
