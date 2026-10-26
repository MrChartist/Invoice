/** R5-B4: "New measurement" — cumulative (or this-bill) quantity per BOQ line, MB ref, excess / variation, final bill. */
import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord } from '../../types/invoice';
import { boqLines } from '../../lib/works/boq';
import { billedQty, nextRaNo, saveRaBill, type MeasureInput } from '../../lib/works/measurements';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import type { LinkLike } from '../../lib/progress-billing';
import { B, errText, fmtMoney, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';
import own from './works.module.css';

type Cell = { cum: string; mb: string; extra: string };

export function MeasurementForm({ boq, notify, refresh, tick }: PanelProps & { boq: InvoiceRecord }) {
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => billedQty(boq, invoices, getTable<LinkLike>('doc_links')), [boq, invoices]);
  const raNo = nextRaNo(boq.id, invoices);
  const [date, setDate] = useState(today());
  const [final, setFinal] = useState(false);
  const [draft, setDraft] = useState(false);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const set = (id: string, p: Partial<Cell>) => setCells((c) => ({ ...c, [id]: { ...{ cum: '', mb: '', extra: '' }, ...c[id], ...p } }));
  const lines = boqLines(boq);
  const save = () => {
    const input: MeasureInput[] = Object.entries(cells).filter(([, c]) => c.cum.trim() !== '').map(([line_id, c]) => ({ line_id, cumulative_qty: Number(c.cum), mb_ref: c.mb, extra_reason: c.extra }));
    try {
      const { invoice } = saveRaBill(boq.id, { date, lines: input, final, draft });
      notify(twT('raSaved', { ra: invoice.ra_no ?? '', no: invoice.invoice_number, net: fmtMoney(invoice.ra_net_payable ?? invoice.total) }));
      setCells({});
      setFinal(false);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <section className={styles.box} data-ra-form>
      <h4 className={styles.toolbar}><ClipboardList size={16} aria-hidden="true" /> {twT('newMeasurement', { ra: raNo })}</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{twT('itemNo')}</th><th>{twT('description')}</th><th className={surface.numeric}>{twT('boqQty')}</th><th className={surface.numeric}>{twT('prevQty')}</th><th>{twT('cumQty')}</th><th className={surface.numeric}>{twT('thisQty')}</th><th>{twT('mbRef')}</th><th>{twT('excessReason')}</th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const c = cells[l.id];
              const p = prev.get(l.id) ?? 0;
              const thisQty = c?.cum ? Math.round((Number(c.cum) - p) * 1e6) / 1e6 : 0;
              const over = c?.cum ? Number(c.cum) > l.quantity : false;
              return (
                <tr key={l.id}>
                  <td>{l.boq_ref ?? ''}</td><td>{l.name}</td><td className={surface.numeric}>{l.quantity} {l.unit}</td><td className={surface.numeric}>{p}</td>
                  <td><input className={`${controls.input} ${own.qty}`} type="number" value={c?.cum ?? ''} onChange={(e) => set(l.id, { cum: e.target.value })} aria-label={`${twT('cumQty')} ${l.name}`} data-ra-cum={l.boq_ref || l.name} /></td>
                  <td className={`${surface.numeric} ${thisQty < 0 ? styles.bad : ''}`}>{thisQty || ''}</td>
                  <td><input className={`${controls.input} ${own.qty}`} value={c?.mb ?? ''} onChange={(e) => set(l.id, { mb: e.target.value })} aria-label={twT('mbRef')} /></td>
                  <td>{over && <input className={controls.input} value={c?.extra ?? ''} onChange={(e) => set(l.id, { extra: e.target.value })} aria-label={twT('excessReason')} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.toolbar}>
        <F l={twT('date')}><input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></F>
        <label className={controls.check}><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} /> {twT('finalBill')}</label>
        <label className={controls.check}><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {twT('saveAsDraft')}</label>
        <button type="button" className={B.p} onClick={save} data-ra-save>{twT('saveRa')}</button>
      </div>
    </section>
  );
}
