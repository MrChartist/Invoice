/** R5-B4: "New measurement" — cumulative (or this-bill) quantity per BOQ line, MB ref, excess / variation, final bill. */
import { lazy, Suspense, useMemo, useState } from 'react';
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
import { cnT } from '../../i18n/areas/construction-r11a'; // R11 (CN-A3 / A4)
import { deviationWarnings } from '../../lib/construction/cn-abstract';
import { deviationPct } from '../../lib/construction/cn-snapshot';
import { readConstructionSettings } from '../../lib/construction/cn-settings';
import type { CnRecoveryInput } from '../../types/construction-r11';

// R11 (CN-B2 / B4): recoveries typed on this bill (lazy).
const BillRecoveries = lazy(() => import('../construction/BillRecoveries'));

type Cell = { cum: string; mb: string; extra: string; kind?: '' | 'extra' | 'substituted'; approval?: string; subs?: string };

export function MeasurementForm({ boq, notify, refresh, tick }: PanelProps & { boq: InvoiceRecord }) {
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => billedQty(boq, invoices, getTable<LinkLike>('doc_links')), [boq, invoices]);
  const raNo = nextRaNo(boq.id, invoices);
  const [date, setDate] = useState(today());
  const [final, setFinal] = useState(false);
  const [draft, setDraft] = useState(false);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [period, setPeriod] = useState({ from: '', to: '', measured: '' }); // R11 (CN-A3)
  const [recoveries, setRecoveries] = useState<CnRecoveryInput[]>([]);
  const devPct = useMemo(() => deviationPct(boq, undefined, readConstructionSettings(), date), [boq, date]);
  const set = (id: string, p: Partial<Cell>) => setCells((c) => ({ ...c, [id]: { ...{ cum: '', mb: '', extra: '' }, ...c[id], ...p } }));
  const lines = boqLines(boq);
  const save = () => {
    const input: MeasureInput[] = Object.entries(cells).filter(([, c]) => c.cum.trim() !== '').map(([line_id, c]) => ({ line_id, cumulative_qty: Number(c.cum), mb_ref: c.mb, extra_reason: c.extra, ...(c.kind ? { kind: c.kind, approval: c.approval, substitutes: c.subs } : {}) }));
    try {
      const { invoice } = saveRaBill(boq.id, { date, lines: input, final, draft, period_from: period.from || undefined, period_to: period.to || undefined, measured_on: period.measured || undefined, recoveries });
      notify(twT('raSaved', { ra: invoice.ra_no ?? '', no: invoice.invoice_number, net: fmtMoney(invoice.ra_net_payable ?? invoice.total) }));
      setCells({});
      setRecoveries([]);
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
          <thead><tr><th>{twT('itemNo')}</th><th>{twT('description')}</th><th className={surface.numeric}>{twT('boqQty')}</th><th className={surface.numeric}>{twT('prevQty')}</th><th>{twT('cumQty')}</th><th className={surface.numeric}>{twT('thisQty')}</th><th>{twT('mbRef')}</th><th>{twT('excessReason')}</th><th>{cnT('lineKind')}</th></tr></thead>
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
                  <td>
                    <select className={controls.select} value={c?.kind ?? ''} onChange={(e) => set(l.id, { kind: e.target.value as Cell['kind'] })} aria-label={cnT('lineKind')} data-ra-kind={l.boq_ref || l.name}>
                      <option value="">{cnT('kind.boq')}</option><option value="extra">{cnT('kind.extra')}</option><option value="substituted">{cnT('kind.substituted')}</option>
                    </select>
                    {c?.kind && <input className={controls.input} value={c.approval ?? ''} placeholder={cnT('approval')} onChange={(e) => set(l.id, { approval: e.target.value })} aria-label={cnT('approval')} />}
                    {c?.kind === 'substituted' && <input className={controls.input} value={c.subs ?? ''} placeholder={cnT('substitutes')} onChange={(e) => set(l.id, { subs: e.target.value })} aria-label={cnT('substitutes')} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {deviationWarnings(boq, Object.entries(cells).filter(([, c]) => c.cum.trim() !== '').map(([line_id, c]) => ({ line_id, cumulative_qty: Number(c.cum) })), devPct).map((w) => (
        <p key={w.line_id} className={styles.warn} role="status" data-ra-deviation>{cnT('deviationWarn', { name: w.name, cum: w.cumulative, limit: w.limit, pct: w.pct })}</p>
      ))}
      <div className={styles.toolbar}>
        <F l={cnT('periodFrom')}><input className={controls.input} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></F>
        <F l={cnT('periodTo')}><input className={controls.input} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></F>
        <F l={cnT('measuredOn')}><input className={controls.input} type="date" value={period.measured} onChange={(e) => setPeriod({ ...period, measured: e.target.value })} /></F>
      </div>
      <Suspense fallback={null}><BillRecoveries key={raNo} boqId={boq.id} onChange={setRecoveries} /></Suspense>
      <div className={styles.toolbar}>
        <F l={twT('date')}><input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></F>
        <label className={controls.check}><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} /> {twT('finalBill')}</label>
        <label className={controls.check}><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {twT('saveAsDraft')}</label>
        <button type="button" className={B.p} onClick={save} data-ra-save>{twT('saveRa')}</button>
      </div>
    </section>
  );
}
