import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { importOrders, importsDb, newOrders, verifyOrderFile, type PadPayload } from '../../lib/order-pad';
import { buildSalesOrder } from '../../lib/order-pad-build';
import { localDb } from '../../lib/localDb';
import { useT } from '../../i18n';
import { distT } from '../../i18n/areas/distribution';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

/** 8.81 office side of the order pad: verify a signed order file and import it as sales orders. */
export default function DistOrders({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [text, setText] = useState('');
  const [pass, setPass] = useState('');
  const [payload, setPayload] = useState<PadPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const imported = useMemo(() => importsDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const split = payload ? newOrders(payload.orders, imported) : null;

  const verify = async () => {
    setBusy(true);
    try {
      setPayload(await verifyOrderFile(text, pass));
    } catch (err) {
      setPayload(null);
      onDone((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    if (!payload) return;
    try {
      const r = importOrders(payload, { buildOrder: buildSalesOrder, save: (rec) => localDb.invoices.save(rec), defaultTax: localDb.settings.get().defaultTaxRate });
      onDone(distT('importedN', { n: r.created.length, dup: r.duplicates.length }));
      setPayload(null);
      setText('');
      setTick((t) => t + 1);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };

  return (
    <div className={own.stack} data-dist-orders>
      <p className={own.muted}>{distT('ordersIntro')} <Link to="/order-pad">{distT('orderPad')}</Link></p>
      <label className={controls.field}><span className={controls.label}>{distT('orderFile')}</span>
        <input type="file" accept=".mcorder,application/json,text/plain" className={controls.input} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); setPayload(null); }} data-order-file /></label>
      <label className={controls.field}><span className={controls.label}>{distT('orPaste')}</span>
        <textarea className={`${controls.input} ${own.textarea}`} value={text} onChange={(e) => { setText(e.target.value); setPayload(null); }} data-order-text /></label>
      <label className={controls.field}><span className={controls.label}>{distT('passphrase')}</span>
        <input type="password" autoComplete="off" className={controls.input} value={pass} onChange={(e) => setPass(e.target.value)} data-order-pass /></label>
      <div><button type="button" className={controls.btnOutline} disabled={!text.trim() || !pass || busy} onClick={() => void verify()} data-order-verify>{distT('verify')}</button></div>
      {payload && split && (
        <div className={own.notice} data-order-preview>
          <p className={own.muted}>{distT('verified', { salesman: payload.salesman.name || '—', n: split.fresh.length, dup: split.duplicates.length })}</p>
          <ul>{split.fresh.map((o) => <li key={o.id}>{o.date} · {o.client_name} · {o.lines.length} {distT('linesWord')}</li>)}</ul>
          <button type="button" className={controls.btnPrimary} disabled={!split.fresh.length} onClick={doImport} data-order-import>{distT('importN', { n: split.fresh.length })}</button>
        </div>
      )}
      {imported.length > 0 && (
        <table className={own.table}>
          <thead><tr><th>{distT('number')}</th><th>{distT('day')}</th><th>{distT('salesman')}</th><th>{distT('importedAt')}</th></tr></thead>
          <tbody>{imported.slice(-30).reverse().map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.order_date}</td><td>{r.salesman}</td><td>{r.imported_at.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
