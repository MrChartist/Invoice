import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import {
  applyTransporterUpdate,
  applyVehicleUpdate,
  buildEwayRows,
  filterRows,
  loadMeta,
  recordBulkUpdate,
  transporterUpdateCsv,
  transporterUpdateJson,
  TRANSPORTER_ID,
  vehicleIssues,
  vehicleUpdateCsv,
  vehicleUpdateJson,
  type EwayFilter,
  type EwayRow,
  type VehicleReason,
  type VehicleUpdateInput,
} from '../../lib/eway-desk';
import { extensionHours, localDay } from '../../lib/eway-validity';
import { downloadText } from '../../lib/download';
import { formatDate } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { useT } from '../../i18n';
import { dkT } from '../../i18n/areas/desks-r3';
import controls from '../../styles/controls.module.css';
import styles from './desks-r3.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;

const FILTERS: EwayFilter[] = ['all', 'expiring24', 'expired', 'noPartB'];
const REASONS: VehicleReason[] = ['breakdown', 'transhipment', 'others'];
const STATUS_CLASS: Record<EwayRow['status'], string | undefined> = { active: styles.ok, expiring: styles.error, expired: styles.error, unknown: styles.muted };

const when = (d: Date | null) => (d ? `${formatDate(localDay(d))} ${d.toTimeString().slice(0, 5)}` : '—');

/**
 * R3-C5 GST → Tools → e-Way desk: active e-Way Bills with validity (typed / imported valid-upto wins over
 * the computed Rule 138(10) value; both shown when they differ), hours left, filters, the extension
 * reminder and the bulk vehicle / transporter update files. Working paper — verify with your CA.
 */
export default function EwayDesk({ notify }: { notify: Notify }) {
  useT();
  const [tick, setTick] = useState(0);
  const [now] = useState(() => new Date());
  const rows = useMemo(
    () => buildEwayRows(loadMeta(), getTable<InvoiceRecord>('invoices'), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, tick],
  );
  const [filter, setFilter] = useState<EwayFilter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'vehicle' | 'transporter'>('vehicle');
  const [input, setInput] = useState<VehicleUpdateInput>({ vehicle: '', place: '', stateCode: '', reason: 'transhipment', remark: '', docNo: '', docDate: '' });
  const [transporter, setTransporter] = useState({ id: '', name: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const shown = filterRows(rows, filter);
  const chosen = rows.filter((r) => picked.has(r.invoiceId));
  const ewbNos = chosen.map((r) => r.ewayNo);
  const stem = `ewb_${mode}_update_${localDay(now)}`;

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const prepare = () => {
    const ids = new Set(chosen.map((r) => r.invoiceId));
    try {
      if (mode === 'vehicle') {
        const issues = vehicleIssues(input, ids.size);
        if (issues.length) return setErrors(issues.map((i) => dkT(`ew.err.${i}` as const)));
        downloadText(`${stem}.json`, JSON.stringify(vehicleUpdateJson(ewbNos, input), null, 2), 'application/json');
        downloadText(`${stem}.csv`, vehicleUpdateCsv(ewbNos, input), 'text/csv');
        recordBulkUpdate('vehicle', applyVehicleUpdate(loadMeta(), ids, input, new Date()), ids.size, input.vehicle);
      } else {
        const id = transporter.id.trim().toUpperCase();
        if (!ids.size) return setErrors([dkT('ew.err.none')]);
        if (!TRANSPORTER_ID.test(id)) return setErrors([dkT('ew.err.transporter')]);
        downloadText(`${stem}.json`, JSON.stringify(transporterUpdateJson(ewbNos, id), null, 2), 'application/json');
        downloadText(`${stem}.csv`, transporterUpdateCsv(ewbNos, id), 'text/csv');
        recordBulkUpdate('transporter', applyTransporterUpdate(loadMeta(), ids, id, new Date(), transporter.name), ids.size, id);
      }
      setErrors([]);
      setPicked(new Set());
      setTick((t) => t + 1);
      notify(dkT('ew.prepared', { n: ids.size }), 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={styles.stack} data-eway-desk>
      <section className={styles.section}>
        <h3 className={styles.head}><Truck size={16} aria-hidden /> {dkT('ew.title')} <span className={styles.badge}>{dkT('workingPaper')}</span></h3>
        <p className={styles.note}>{dkT('ew.assumption', { h: extensionHours(localDay(now)) })}</p>
        <div className={styles.filters} role="group" aria-label={dkT('ew.filter')}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {dkT(`ew.f.${f}` as const)} ({filterRows(rows, f).length})
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className={styles.note}>{rows.length ? dkT('ew.noneFilter') : dkT('ew.empty')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-eway-rows>
              <thead>
                <tr>
                  <th scope="col"><span className={styles.muted}>✓</span></th>
                  <th scope="col">{dkT('ew.colEwb')}</th>
                  <th scope="col">{dkT('ew.colDoc')}</th>
                  <th scope="col">{dkT('ew.colVehicle')}</th>
                  <th scope="col" className={styles.num}>{dkT('ew.colKm')}</th>
                  <th scope="col">{dkT('ew.colValid')}</th>
                  <th scope="col" className={styles.num}>{dkT('ew.colHours')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.invoiceId}>
                    <td><input type="checkbox" checked={picked.has(r.invoiceId)} onChange={() => toggle(r.invoiceId)} aria-label={dkT('ew.pick', { no: r.ewayNo })} /></td>
                    <td className={styles.mono}>{r.ewayNo}</td>
                    <td><Link to={`/invoice/${r.invoiceId}`}>{r.number || '—'}</Link><div className={styles.note}>{r.party}</div></td>
                    <td className={styles.mono}>{r.vehicle || <span className={styles.error}>{dkT('ew.noPartB')}</span>}</td>
                    <td className={styles.num}>{r.distance || '—'}</td>
                    <td>
                      <span className={STATUS_CLASS[r.status]}>{when(r.expiresAt)}</span>
                      <div className={styles.note}>
                        {r.source === 'typed' ? dkT('ew.srcTyped') : r.source === 'computed' ? dkT('ew.srcComputed') : dkT('ew.srcNone')}
                        {r.differs && ` · ${dkT('ew.differs', { typed: formatDate(r.typedDay ?? ''), computed: formatDate(r.computedDay ?? '') })}`}
                      </div>
                      {r.extension && <div className={styles.error}>{dkT('ew.extendNow', { km: r.distance || '—' })}</div>}
                    </td>
                    <td className={styles.num}>{r.hoursLeft ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} data-eway-bulk>
        <h3 className={styles.head}>{dkT('ew.bulkTitle', { n: chosen.length })} <span className={styles.badge}>{dkT('unverified')}</span></h3>
        <div className={controls.segment} role="radiogroup" aria-label={dkT('ew.bulkKind')}>
          {(['vehicle', 'transporter'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMode(m)}>
              {dkT(`ew.kind.${m}` as const)}
            </button>
          ))}
        </div>
        {mode === 'vehicle' ? (
          <div className={styles.grid2}>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.vehicle')}</span>
              <input className={controls.input} value={input.vehicle} onChange={(e) => setInput({ ...input, vehicle: e.target.value })} placeholder="MH12AB1234" data-eway-vehicle /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.place')}</span>
              <input className={controls.input} value={input.place} onChange={(e) => setInput({ ...input, place: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.state')}</span>
              <input className={controls.input} value={input.stateCode} inputMode="numeric" maxLength={2} onChange={(e) => setInput({ ...input, stateCode: e.target.value })} placeholder="27" /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.reason')}</span>
              <select className={controls.select} value={input.reason} onChange={(e) => setInput({ ...input, reason: e.target.value as VehicleReason })}>
                {REASONS.map((r) => <option key={r} value={r}>{dkT(`ew.r.${r}` as const)}</option>)}
              </select></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.remark')}</span>
              <input className={controls.input} value={input.remark} maxLength={50} onChange={(e) => setInput({ ...input, remark: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.docNo')}</span>
              <input className={controls.input} value={input.docNo} maxLength={15} onChange={(e) => setInput({ ...input, docNo: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.docDate')}</span>
              <input className={controls.input} type="date" value={input.docDate} onChange={(e) => setInput({ ...input, docDate: e.target.value })} /></label>
          </div>
        ) : (
          <div className={styles.grid2}>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.transporterId')}</span>
              <input className={controls.input} value={transporter.id} maxLength={15} onChange={(e) => setTransporter({ ...transporter, id: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{dkT('ew.transporterName')}</span>
              <input className={controls.input} value={transporter.name} onChange={(e) => setTransporter({ ...transporter, name: e.target.value })} /></label>
          </div>
        )}
        {errors.length > 0 && <ul className={styles.error} role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className={styles.row}>
          <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={prepare} data-eway-prepare>{dkT('ew.prepare')}</button>
          <span className={styles.note}>{dkT('ew.bulkNote')}</span>
        </div>
      </section>
    </div>
  );
}
