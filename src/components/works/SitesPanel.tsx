/** R5-B6: sites of a BOQ — site godowns, book consumption, coefficients, and the issued / consumed / theoretical statement. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { siteViewLabel } from './site-views';
import { Building2, Download } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord } from '../../types/invoice';
import type { StockJournal } from '../../types/manufacturing';
import type { StockTransfer } from '../../types/stock';
import { addSite, bookConsumption, loadCoefficients, saveCoefficients, siteCsvRows, siteGodowns, siteStatement } from '../../lib/works/sites';
import { loadMeasurements } from '../../lib/works/measurements';
import { boqLines } from '../../lib/works/boq';
import { godownsDb } from '../../lib/godowns';
import { stockDb } from '../../lib/inventory';
import { getTable } from '../../lib/storage';
import { B, csvDownload, errText, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const monthStart = () => `${today().slice(0, 7)}-01`;

export function SitesPanel({ boq, notify, refresh, tick }: PanelProps & { boq: InvoiceRecord }) {
  const sites = useMemo(() => siteGodowns(godownsDb.stored(), boq.id), [boq.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => stockDb.items(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const coeffs = useMemo(() => loadCoefficients(boq.id), [boq.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [siteId, setSiteId] = useState('');
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const [f, setF] = useState({ name: '', day: today(), item: '', qty: '', from: monthStart(), to: today() });
  const [co, setCo] = useState<Record<string, { item: string; qty: string }>>(() => Object.fromEntries(coeffs.map((c) => [c.line_id, { item: c.item_id, qty: String(c.qty_per_unit) }])));
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const run = (fn: () => unknown, msg: string) => {
    try {
      fn();
      notify(msg);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const rows = useMemo(() => (site ? siteStatement({
    site, period: { start: f.from, end: f.to }, transfers: getTable<StockTransfer>('stock_transfers'), journals: getTable<StockJournal>('stock_journals'), measurements: loadMeasurements(boq.id), coefficients: coeffs,
  }) : []), [site, f.from, f.to, boq.id, coeffs, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const itemSelect = (value: string, on: (v: string) => void, label: string) => (
    <F l={label}>
      <select className={controls.select} value={value} onChange={(e) => on(e.target.value)}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></F>
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <F l={twT('site')}>
          <select className={controls.select} value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>{sites.length === 0 && <option value="">—</option>}{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
        <F l={twT('siteName')}><input className={controls.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></F>
        <button type="button" className={B.o} onClick={() => run(() => addSite(boq.id, f.name || `${boq.client?.name ?? ''} site`, boq.boq_terms?.cost_centre_id), twT('siteAdded'))}><Building2 size={16} aria-hidden="true" /> {twT('addSite')}</button>
      </div>
      <p className={styles.note}>{twT('siteHint')} <Link to="/time?tab=works&view=reco" data-reco-link>{siteViewLabel('reco')} →</Link></p>
      {site && (
        <section className={styles.box}>
          <h4>{twT('bookConsumption')}</h4>
          <div className={styles.lineRow}>
            <F l={twT('date')}><input className={controls.input} type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></F>
            {itemSelect(f.item, (v) => setF({ ...f, item: v }), twT('item'))}
            <F l={twT('qty')}><input className={controls.input} type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></F>
            <button type="button" className={B.p} onClick={() => run(() => bookConsumption(site, { date: f.day, lines: [{ item_id: f.item, qty: Number(f.qty) }] }, items), twT('consumptionBooked'))}>{twT('save')}</button>
          </div>
        </section>
      )}
      <section className={styles.box}>
        <h4>{twT('coefficients')}</h4>
        {boqLines(boq).map((l) => (
          <div key={l.id} className={styles.lineRow}>
            <span>{l.boq_ref ? `${l.boq_ref} · ` : ''}{l.name} ({l.unit})</span>
            {itemSelect(co[l.id]?.item ?? '', (v) => setCo((c) => ({ ...c, [l.id]: { qty: c[l.id]?.qty ?? '', item: v } })), twT('item'))}
            <F l={twT('qtyPerUnit')}><input className={controls.input} type="number" value={co[l.id]?.qty ?? ''} onChange={(e) => setCo((c) => ({ ...c, [l.id]: { item: c[l.id]?.item ?? '', qty: e.target.value } }))} /></F>
          </div>
        ))}
        <div className={styles.toolbar}><button type="button" className={B.o} onClick={() => run(() => saveCoefficients(boq.id, Object.entries(co).map(([line_id, c]) => ({ line_id, item_id: c.item, qty_per_unit: Number(c.qty) }))), twT('saved'))}>{twT('save')}</button></div>
      </section>
      {site && (
        <section className={styles.stack}>
          <div className={styles.toolbar}>
            <F l={twT('from')}><input className={controls.input} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></F>
            <F l={twT('to')}><input className={controls.input} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></F>
            <button type="button" className={B.o} onClick={() => csvDownload(`site_${site.name}_${f.to}.csv`, siteCsvRows(rows, itemName))}><Download size={14} aria-hidden="true" /> CSV</button>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{twT('item')}</th><th className={surface.numeric}>{twT('issued')}</th><th className={surface.numeric}>{twT('consumed')}</th><th className={surface.numeric}>{twT('theoretical')}</th><th className={surface.numeric}>{twT('variance')}</th><th className={surface.numeric}>{twT('closingAtSite')}</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.itemId}><td>{itemName(r.itemId)}</td><td className={surface.numeric}>{r.issued}</td><td className={surface.numeric}>{r.consumed}</td><td className={surface.numeric}>{r.theoretical}</td><td className={`${surface.numeric} ${r.variancePct !== null && r.variancePct > 0 ? styles.bad : ''}`}>{r.variancePct === null ? '—' : `${r.variancePct}%`}</td><td className={surface.numeric}>{r.closing}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
