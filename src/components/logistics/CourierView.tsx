/**
 * R19-D2 courier view (`&view=courier`, pack `courier`): the zone rate card (first 500 g, each further 500 g, minimum,
 * RTO %), "Import dockets" for one account customer (the network's CSV pasted or picked: docket, date, zone, kg, l / w
 * / h, pcs, service, pin, value, status, intl, fsc, charge — 5,000 rows a file, all or nothing; the e-Way hint on a
 * declared value above ₹50,000), the month's manifests (dockets, kg, charge, bill) with the docket annexure as CSV,
 * "Bill month" (one `saveMany`) and "Undo month" (bills cancelled). COD remittance was cut (PRD §3 cut 2).
 */
import { useMemo, useState } from 'react';
import { t, useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgdT } from '../../i18n/areas/logistics-r19d';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';
import { billedManifests, docketRows, docketsFromRows, manifestTotals } from '../../lib/logistics/lg-courier';
import { billCourierMonth, deleteManifest, importDockets, loadManifests, undoCourierMonth } from '../../lib/logistics/lg-d-save';
import { lgDefaultsFor, saveLogisticsSettings } from '../../lib/logistics/lg-settings';
import type { LgZone } from '../../types/logistics-r19';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Pick, type LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';
import { downloadCsv, draftBase } from './lg-d-seam';
import { parseCsv } from '../../lib/csv';

const ZONE_K = ['first_500g', 'addl_500g', 'min', 'rto_pct'] as const;

export default function CourierView({ notify }: LgViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [period, setPeriod] = useState(() => todayInput().slice(0, 7));
  const [zones, setZones] = useState<LgZone[]>(() => lgDefaultsFor().zones ?? []);
  const [client, setClient] = useState('');
  const [csv, setCsv] = useState('');
  const [date, setDate] = useState(todayInput());
  const d = useMemo(() => { void tick; const inv = localDb.invoices.getAll(); return { clients: localDb.clients.getAll(), all: loadManifests(), inv, billed: billedManifests(inv) }; }, [tick]);
  const act = (fn: () => string | void) => { try { const m = fn(); setTick((x) => x + 1); notify(m || lgT('saved')); } catch (e) { notify((e as Error).message, 'error'); } };
  const name = (id: string) => d.clients.find((c) => c.id === id)?.name ?? id;
  const rows = d.all.filter((m) => m.period === period);
  const run = () => {
    act(() => {
      const r = docketsFromRows(parseCsv(csv), { ...lgDefaultsFor(), zones });
      if (r.errors.length) throw new Error(r.errors[0] === 'cols' ? lgdT('eCols') : r.errors[0] === 'many' ? lgdT('eMany') : lgdT('eRows', { r: r.errors.slice(0, 5).join('; ') }));
      importDockets(client, r.dockets);
      setCsv('');
      return lgdT('imported', { n: r.dockets.length }) + (r.hints.length ? ` ${lgdT('hEway', { d: r.hints.slice(0, 5).join(', ') })}` : '');
    });
  };
  const bill = (no?: string) => d.inv.find((i) => i.lg?.manifest_id === no && i.status !== 'Cancelled')?.invoice_number ?? '';
  return (
    <>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{lgdT('zone')}</th>{ZONE_K.map((k) => <th key={k}>{lgdT(k)}</th>)}</tr></thead>
          <tbody>{zones.map((z, i) => (
            <tr key={i}>
              <td><input className={controls.input} style={{ width: '6rem' }} aria-label={lgdT('zone')} value={z.zone} onChange={(e) => setZones(zones.map((x, k) => (k === i ? { ...x, zone: e.target.value } : x)))} /></td>
              {ZONE_K.map((k) => <td key={k}><input type="number" min={0} step="any" className={controls.input} style={{ width: '6rem' }} aria-label={lgdT(k)} value={z[k] ?? ''} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, [k]: numIn(e.target.value) ?? (k === 'first_500g' || k === 'addl_500g' ? 0 : undefined) } : x)))} /></td>)}
            </tr>))}</tbody>
        </table>
      </div>
      <div style={row}>
        <button type="button" className={controls.btnGhost} onClick={() => setZones([...zones, { zone: '', first_500g: 0, addl_500g: 0 }])}>{lgT('addRow')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => { saveLogisticsSettings({ zones: zones.filter((z) => z.zone.trim()) }); })} data-lg-save-zones>{t('common.save')}</button>
      </div>
      <div style={row}>
        <Pick label={lgT('client')} value={client} ids={d.clients.map((c) => c.id ?? '').filter(Boolean)} name={name} blank="-" onChange={setClient} attr="courier-client" />
        <input type="file" accept=".csv,text/csv" aria-label={lgdT('import')} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <button type="button" className={controls.btnOutline} onClick={run} data-lg-import-dockets>{lgdT('import')}</button>
      </div>
      <textarea className={controls.textarea} rows={4} aria-label={lgdT('import')} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="docket,date,zone,kg,l,w,h,pcs" data-lg-dockets-csv />
      <div style={row}>
        <In label={lgdT('period')} value={period} onChange={setPeriod} attr="courier-period" />
        <In label={lgdT('billDate')} type="date" value={date} onChange={setDate} />
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => lgdT('billed', { n: billCourierMonth(period, date, draftBase()).length }))} data-lg-bill-courier>{lgdT('billMonth')}</button>
        <button type="button" className={controls.btnGhost} onClick={() => act(() => lgdT('undone', { n: undoCourierMonth(period) }))}>{lgdT('undo')}</button>
      </div>
      {rows.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{lgT('client')}</th><th>{lgdT('dockets')}</th><th>{lgT('chargeable')}</th><th>{lgdT('amount')}</th><th>{lgdT('doc')}</th><th /></tr></thead>
            <tbody>{rows.map((m) => { const s = manifestTotals(m); return (
              <tr key={m.id} data-lg-manifest={name(m.client_id)}><td>{name(m.client_id)}</td><td>{s.count}</td><td>{s.kg} kg</td><td>{s.charge.toFixed(2)}</td><td>{bill(m.id)}</td>
                <td><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadCsv(`dockets-${m.period}.csv`, docketRows(m))}>CSV</button>
                  {!d.billed.has(m.id) && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => deleteManifest(m.id))}>{lgdT('remove')}</button>}</td></tr>); })}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
