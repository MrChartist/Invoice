/**
 * R19-A3 rates view: the charge heads grid (name, kind, role, unit, rate, currency, SAC, on) with "Default heads"; rate
 * sheets by client / lane with validity, a rate (and minimum) per head, and "Quote from sheet" (a draft quotation with
 * `lg.quote`); quotations made from a sheet with "Make job" (opens a new job in the jobs view).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import { localDb } from '../../lib/localDb';
import { generateId } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { LG_HEAD_KINDS, LG_ROLES, LG_UNITS, sacFor } from '../../lib/logistics/lg-heads';
import { LG_MODES } from '../../lib/logistics/lg-job';
import { addDefaultHeads, readLogisticsSettings, saveLogisticsSettings } from '../../lib/logistics/lg-settings';
import { deleteSheet, loadSheets, saveSheet } from '../../lib/logistics/lg-save';
import type { LgHead, LgRateSheet } from '../../types/logistics-r19';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Pick, numIn, row, type LgViewProps } from './lg-ui';

type Sheet = Omit<LgRateSheet, 'id' | 'updated_at'> & { id?: string };

export default function RatesView({ notify }: LgViewProps) {
  useT();
  const [, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [heads, setHeads] = useState<LgHead[]>(() => readLogisticsSettings().heads ?? []);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const data = useMemo(() => {
    void tick;
    const clients = localDb.clients.getAll();
    return { sheets: loadSheets(), clients, quotes: localDb.invoices.getAll().filter((i) => i.lg?.quote && i.status !== 'Cancelled') };
  }, [tick]);
  const act = (fn: () => string | void) => { try { notify(fn() || lgT('saved')); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const setH = (i: number, p: Partial<LgHead>) => setHeads(heads.map((h, k) => (k === i ? { ...h, ...p } : h)));
  const cell = (i: number, k: 'name' | 'currency' | 'sac', w = '7rem') => <input className={controls.input} style={{ width: w }} aria-label={lgT(k)} value={heads[i][k] ?? ''} onChange={(e) => setH(i, { [k]: e.target.value })} />;
  const sel = <K extends 'kind' | 'role' | 'unit'>(i: number, k: K, ids: readonly LgHead[K][], list: 'kinds' | 'roles' | 'units') => (
    <select className={controls.select} aria-label={lgT(k)} value={heads[i][k]} onChange={(e) => setH(i, { [k]: e.target.value })}>{ids.map((x) => <option key={x} value={x}>{lgList(list, ids, x)}</option>)}</select>
  );
  const cname = (id?: string) => data.clients.find((c) => c.id === id)?.name ?? '';
  const ids = data.clients.map((c) => c.id ?? '').filter(Boolean);
  const active = heads.filter((h) => h.active);
  return (
    <>
      <h3>{lgT('heads')}</h3>
      <div style={row}>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => setHeads(addDefaultHeads(todayInput()).heads ?? []))} data-lg-default-heads>{lgT('defaults')}</button>
        <button type="button" className={controls.btnGhost} onClick={() => setHeads([...heads, { id: generateId(), name: '', kind: 'other', role: 'own', unit: 'per_shipment', active: true }])}>{lgT('addHead')}</button>
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => setHeads(saveLogisticsSettings({ heads }).heads ?? []))} data-lg-save-heads>{lgT('save')}</button>
      </div>
      {heads.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-lg-heads>
            <thead><tr><th>{lgT('name')}</th><th>{lgT('kind')}</th><th>{lgT('role')}</th><th>{lgT('unit')}</th><th>{lgT('rate')}</th><th>{lgT('currency')}</th><th>{lgT('sac')}</th><th>{lgT('active')}</th></tr></thead>
            <tbody>
              {heads.map((h, i) => (
                <tr key={h.id} data-lg-head={h.kind}>
                  <td>{cell(i, 'name', '12rem')}</td>
                  <td>{sel(i, 'kind', LG_HEAD_KINDS, 'kinds')}</td>
                  <td>{sel(i, 'role', LG_ROLES, 'roles')}</td>
                  <td>{sel(i, 'unit', LG_UNITS, 'units')}</td>
                  <td><input type="number" min={0} step="any" className={controls.input} style={{ width: '6rem' }} aria-label={lgT('rate')} value={h.rate ?? ''} onChange={(e) => setH(i, { rate: numIn(e.target.value) })} /></td>
                  <td>{cell(i, 'currency', '4rem')}</td>
                  <td>{cell(i, 'sac', '5rem')}{!h.sac && sacFor(h.kind, todayInput()) && <span className={controls.hint}> {sacFor(h.kind, todayInput())}</span>}</td>
                  <td><input type="checkbox" aria-label={lgT('active')} checked={h.active} onChange={(e) => setH(i, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>{lgT('sheets')}</h3>
      {sheet ? (
        <section data-lg-sheet-form>
          <div style={row}>
            <Pick label={lgT('client')} value={sheet.client_id ?? ''} ids={ids} name={cname} blank={lgT('all')} onChange={(v) => setSheet({ ...sheet, client_id: v || undefined })} />
            <In label={lgT('origin')} value={sheet.lane.origin} onChange={(v) => setSheet({ ...sheet, lane: { ...sheet.lane, origin: v } })} />
            <In label={lgT('destination')} value={sheet.lane.destination} onChange={(v) => setSheet({ ...sheet, lane: { ...sheet.lane, destination: v } })} />
            <Pick label={lgT('mode')} value={sheet.lane.mode} ids={LG_MODES} name={(x) => lgList('modes', LG_MODES, x)} onChange={(v) => setSheet({ ...sheet, lane: { ...sheet.lane, mode: v as LgRateSheet['lane']['mode'] } })} />
            <In label={lgT('validFrom')} type="date" value={sheet.valid_from} onChange={(v) => setSheet({ ...sheet, valid_from: v })} />
            <In label={lgT('validTo')} type="date" value={sheet.valid_to} onChange={(v) => setSheet({ ...sheet, valid_to: v || undefined })} />
          </div>
          {active.map((h) => {
            const r = sheet.rows.find((x) => x.head_id === h.id);
            const put = (p: { rate?: number; min?: number; currency?: string }) => setSheet({ ...sheet, rows: [...sheet.rows.filter((x) => x.head_id !== h.id), ...(p.rate === undefined && !r ? [] : [{ head_id: h.id, rate: 0, currency: h.currency ?? 'INR', unit: h.unit, ...r, ...p }])] });
            return (
              <div key={h.id} style={row}>
                <strong style={{ minWidth: '12rem' }}>{h.name}</strong>
                <In label={lgT('rate')} type="number" value={r?.rate} onChange={(v) => put({ rate: numIn(v) ?? 0 })} />
                <In label={lgT('currency')} value={r?.currency ?? h.currency ?? 'INR'} onChange={(v) => put({ currency: v.toUpperCase() })} />
                <In label={lgT('minimum')} type="number" value={r?.min} onChange={(v) => put({ min: numIn(v) })} />
              </div>
            );
          })}
          <div style={row}>
            <button type="button" className={controls.btnPrimary} onClick={() => act(() => { saveSheet(sheet, heads); setSheet(null); })}>{lgT('save')}</button>
            <button type="button" className={controls.btnGhost} onClick={() => setSheet(null)}>{lgT('cancel')}</button>
          </div>
        </section>
      ) : (
        <>
          <button type="button" className={controls.btnOutline} onClick={() => setSheet({ lane: { origin: '', destination: '', mode: 'air' }, valid_from: todayInput(), rows: [] })}>{lgT('newSheet')}</button>
          {data.sheets.length ? (
            <div className={surface.tableWrap}>
              <table className={surface.table} data-lg-sheets>
                <tbody>
                  {data.sheets.map((s) => (
                    <tr key={s.id}>
                      <td>{cname(s.client_id) || lgT('all')}</td>
                      <td>{s.lane.origin} → {s.lane.destination} · {lgList('modes', LG_MODES, s.lane.mode)}</td>
                      <td>{s.valid_from}{s.valid_to ? ` – ${s.valid_to}` : ''}</td>
                      <td>
                        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setSheet(s)}>{lgT('open')}</button>
                        {s.client_id && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => void import('../../lib/logistics/lg-issue-io').then((m) => act(() => lgT('quoted', { n: m.saveQuote(s, heads, s.client_id!, todayInput()).invoice_number })))}>{lgT('quote')}</button>}
                        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => deleteSheet(s.id))}>{lgT('del')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={controls.hint}>{lgT('noSheets')}</p>}
        </>
      )}
      {data.quotes.length > 0 && (
        <>
          <h3>{lgT('quotes')}</h3>
          <ul data-lg-quotes>
            {data.quotes.map((q) => <li key={q.id}>{q.invoice_number || q.id} · {q.client?.name} · {q.lg?.lane?.origin} → {q.lg?.lane?.destination} <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setParams({ tab: 'shipments', view: 'jobs', quote: q.id })}>{lgT('makeJob')}</button></li>)}
          </ul>
        </>
      )}
    </>
  );
}
