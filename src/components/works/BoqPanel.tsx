/** R5-B4: the BOQ (a sales order) — item numbers, terms and deductions; import a BOQ from CSV / XLSX. */
import { useMemo, useState } from 'react';
import { FileSpreadsheet, Ruler } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord } from '../../types/invoice';
import { boqLines, contractValue, createBoqFromImport, mapBoqColumns, planBoqImport, type BoqImportRow } from '../../lib/works/boq';
import { localDb } from '../../lib/localDb';
import { DeductionSetEditor } from './DeductionSetEditor';
import { B, errText, fmtMoney, readFirstTable, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

export function BoqPanel({ boq, notify, refresh, tick, onCreated }: PanelProps & { boq?: InvoiceRecord; onCreated: (id: string) => void }) {
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [imp, setImp] = useState<{ lines: BoqImportRow[]; skipped: number[] } | null>(null);
  const [f, setF] = useState({ client: '', date: today(), wo: '', govt: false });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const t = await readFirstTable(file);
      setImp(planBoqImport(t, mapBoqColumns(t.headers)));
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const create = () => {
    const client = clients.find((c) => c.id === f.client);
    if (!imp || !client) return notify(twT('pickClient'), 'error');
    try {
      const so = createBoqFromImport(imp.lines, { client, date: f.date, workOrder: f.wo, government: f.govt });
      notify(twT('boqCreated', { no: so.invoice_number }));
      setImp(null);
      refresh();
      onCreated(so.id);
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const saveRefs = () => {
    if (!boq) return;
    try {
      localDb.invoices.save({ ...boq, items: boq.items.map((i) => (refs[i.id] !== undefined ? { ...i, boq_ref: refs[i.id].trim() || undefined } : i)) });
      setRefs({});
      notify(twT('saved'));
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <div className={styles.stack}>
      {boq ? (
        <>
          <h3 className={styles.toolbar}><Ruler size={16} aria-hidden="true" /> {boq.invoice_number} · {boq.client?.name} · {twT('contractValue')} {fmtMoney(contractValue(boq))}</h3>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{twT('itemNo')}</th><th>{twT('description')}</th><th>{twT('unit')}</th><th className={surface.numeric}>{twT('boqQty')}</th><th className={surface.numeric}>{twT('rate')}</th><th>HSN / SAC</th></tr></thead>
              <tbody>
                {boqLines(boq).map((l) => (
                  <tr key={l.id}>
                    <td><input className={controls.input} value={refs[l.id] ?? l.boq_ref ?? ''} onChange={(e) => setRefs((r) => ({ ...r, [l.id]: e.target.value }))} aria-label={twT('itemNo')} /></td>
                    <td>{l.name}</td><td>{l.unit}</td><td className={surface.numeric}>{l.quantity}</td><td className={surface.numeric}>{fmtMoney(l.rate)}</td><td>{l.hsn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(refs).length > 0 && <div className={styles.toolbar}><button type="button" className={B.o} onClick={saveRefs}>{twT('saveItemNos')}</button></div>}
          <DeductionSetEditor key={boq.id} boq={boq} notify={notify} refresh={refresh} tick={tick} />
        </>
      ) : <p className={styles.note}>{twT('noBoqHint')}</p>}
      <section className={styles.box}>
        <h4 className={styles.toolbar}><FileSpreadsheet size={16} aria-hidden="true" /> {twT('importBoq')}</h4>
        <input type="file" accept=".csv,.xlsx,.xlsm,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} data-boq-file />
        {imp && (
          <>
            <p className={styles.note}>{twT('boqPreview', { n: imp.lines.length, skipped: imp.skipped.length })}</p>
            <div className={styles.grid}>
              <F l={twT('client')}>
                <select className={controls.select} value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
              <F l={twT('date')}><input className={controls.input} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></F>
              <F l={twT('workOrder')}><input className={controls.input} value={f.wo} onChange={(e) => setF({ ...f, wo: e.target.value })} /></F>
              <label className={controls.check}><input type="checkbox" checked={f.govt} onChange={(e) => setF({ ...f, govt: e.target.checked })} /> {twT('govtWorks')}</label>
            </div>
            <div className={styles.toolbar}><button type="button" className={B.p} onClick={create}>{twT('createBoq')}</button></div>
          </>
        )}
      </section>
    </div>
  );
}
