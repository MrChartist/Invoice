import { useMemo, useState } from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { godownsDb } from '../../lib/godowns';
import { vanDay, vanSettlementsDb, settlementDifference } from '../../lib/van';
import { loadTracking } from '../../lib/stock-tracking';
import { stockDb } from '../../lib/inventory';
import { pickListHtml, pickRows } from '../../lib/pick-list';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { StockTransferLine } from '../../types/stock';
import { formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { distT } from '../../i18n/areas/distribution';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';
import { printWhenReady } from '../../lib/print-fonts';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const blank = (): StockTransferLine => ({ id: generateId(), item_id: '', qty: 0 });

/** 8.82 van sales: load (transfer to the van), day settlement (returns + cash vs bills), and pick lists. */
export default function DistVan({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [tick, setTick] = useState(0);
  const godowns = useMemo(() => godownsDb.list(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const vans = godowns.filter((g) => g.kind === 'van');
  const stores = godowns.filter((g) => g.kind !== 'van' && g.kind !== 'expiry');
  const items = useMemo(() => stockDb.items().filter((i) => i.track_stock), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [vanId, setVanId] = useState('');
  const van = vans.find((v) => v.id === vanId) ?? vans[0];
  const [date, setDate] = useState(todayInput());
  const [from, setFrom] = useState('');
  const [load, setLoad] = useState<StockTransferLine[]>([blank()]);
  const [returns, setReturns] = useState<Record<string, number> | null>(null);
  const [counted, setCounted] = useState(0);
  const [collections, setCollections] = useState(0);
  const [pick, setPick] = useState<Set<string>>(new Set());

  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((t) => t + 1);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  const day = useMemo(() => (van ? vanDay(van.id, date, getTable<InvoiceRecord>('invoices'), getTable<Payment>('transactions'), getTable('stock_transfers')) : null), [van, date, tick]);
  const onVan = useMemo(() => {
    if (!van) return [] as { id: string; name: string; qty: number }[];
    const t = loadTracking();
    return items.map((i) => ({ id: i.id, name: i.name, qty: t.get(i.id)?.byGodown[van.id] ?? 0 })).filter((r) => r.qty > 0);
  }, [van, items, tick]);
  const openDocs = useMemo(() => getTable<InvoiceRecord>('invoices').filter((d) => (d.doc_type === 'SALES_ORDER' || d.doc_type === 'DELIVERY_CHALLAN') && d.status !== 'Cancelled' && d.status !== 'Draft').slice(-60).reverse(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const back = returns ?? Object.fromEntries(onVan.map((r) => [r.id, r.qty]));

  const printPick = () => {
    const docs = openDocs.filter((d) => pick.has(d.id));
    const html = pickListHtml(pickRows(docs, stockDb.items()), { title: distT('pickList'), business: localDb.settings.activeProfile()?.companyName, date: todayInput() });
    const w = window.open('', '_blank');
    if (!w) return onDone(distT('popupBlocked'), true);
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    printWhenReady(w);
  };

  return (
    <div className={own.stack} data-dist-van>
      <p className={own.muted}>{distT('vanIntro')}</p>
      {vans.length === 0 ? (
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => { godownsDb.save({ name: distT('vanDefaultName'), kind: 'van' }); return distT('vanMade'); })} data-make-van>
          <Plus size={14} aria-hidden="true" /> {distT('makeVan')}
        </button>
      ) : (
        <>
          <div className={own.row}>
            <label className={controls.field}><span className={controls.label}>{distT('van')}</span>
              <SelectField className={controls.select} value={van?.id ?? ''} onChange={(e) => { setVanId(e.target.value); setReturns(null); }}>
                {vans.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </SelectField></label>
            <label className={controls.field}><span className={controls.label}>{distT('day')}</span>
              <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>

          <h4>{distT('vanLoad')}</h4>
          <label className={controls.field}><span className={controls.label}>{distT('fromGodown')}</span>
            <SelectField className={controls.select} value={from || stores[0]?.id || ''} onChange={(e) => setFrom(e.target.value)}>
              {stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField></label>
          {load.map((l, i) => (
            <div key={l.id} className={own.row}>
              <SelectField className={controls.select} aria-label={distT('item')} value={l.item_id} onChange={(e) => setLoad(load.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))} data-load-item>
                <option value="">{distT('item')}</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </SelectField>
              <input className={controls.input} aria-label={distT('batch')} placeholder={distT('batch')} value={l.batch_no ?? ''} onChange={(e) => setLoad(load.map((x, j) => (j === i ? { ...x, batch_no: e.target.value || undefined } : x)))} />
              <input type="number" min={0} className={controls.input} aria-label={distT('qty')} placeholder={distT('qty')} value={l.qty || ''} onChange={(e) => setLoad(load.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} data-load-qty />
              <button type="button" className={controls.btnIcon} aria-label={distT('removeLine')} onClick={() => setLoad(load.length > 1 ? load.filter((_, j) => j !== i) : [blank()])}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className={own.row}>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setLoad([...load, blank()])}><Plus size={14} aria-hidden="true" /> {distT('addLine')}</button>
            <button type="button" className={controls.btnPrimary} data-van-load onClick={() => run(() => {
              const t = vanSettlementsDb.load({ date, van_id: van!.id, from: from || stores[0]?.id || 'main', lines: load });
              setLoad([blank()]);
              setReturns(null);
              return distT('loaded', { number: t.transfer_number });
            })}>{distT('loadVan')}</button>
          </div>

          <h4>{distT('vanSettlement')}</h4>
          {day && (
            <p className={own.muted} data-van-day>{distT('vanDayLine', { bills: day.bills.length, total: formatCurrency(day.billsTotal), cash: formatCurrency(day.cashOnBills) })}</p>
          )}
          <div className={own.tableWrap}>
            <table className={own.table}>
              <thead><tr><th>{distT('item')}</th><th className={own.num}>{distT('onVan')}</th><th className={own.num}>{distT('returnQty')}</th></tr></thead>
              <tbody>
                {onVan.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td className={own.num}>{r.qty}</td>
                    <td className={own.num}><input type="number" min={0} max={r.qty} className={controls.input} aria-label={distT('returnQty')} value={back[r.id] ?? 0} onChange={(e) => setReturns({ ...back, [r.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), r.qty) })} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={own.row}>
            <label className={controls.field}><span className={controls.label}>{distT('collections')}</span>
              <input type="number" min={0} className={controls.input} value={collections || ''} onChange={(e) => setCollections(Number(e.target.value) || 0)} /></label>
            <label className={controls.field}><span className={controls.label}>{distT('cashCounted')}</span>
              <input type="number" min={0} className={controls.input} value={counted || ''} onChange={(e) => setCounted(Number(e.target.value) || 0)} data-cash-counted /></label>
            {day && <p className={own.muted}>{distT('difference', { amount: formatCurrency(settlementDifference(counted, day.cashOnBills, collections)) })}</p>}
          </div>
          <div>
            <button type="button" className={controls.btnPrimary} data-van-settle onClick={() => run(() => {
              const s = vanSettlementsDb.settle({
                date, van_id: van!.id, return_to: from || stores[0]?.id || 'main', collections, cash_counted: counted,
                returns: onVan.map((r) => ({ id: generateId(), item_id: r.id, qty: back[r.id] ?? 0 })),
              });
              setReturns(null);
              return distT('settled', { number: s.number });
            })}>{distT('settle')}</button>
          </div>
          {vanSettlementsDb.all().length > 0 && (
            <table className={own.table}>
              <thead><tr><th>{distT('number')}</th><th>{distT('day')}</th><th>{distT('van')}</th><th className={own.num}>{distT('billsTotal')}</th><th className={own.num}>{distT('cashCounted')}</th><th className={own.num}>{distT('differenceCol')}</th></tr></thead>
              <tbody>{vanSettlementsDb.all().slice(-20).reverse().map((s) => (
                <tr key={s.id}><td>{s.number}</td><td>{s.date}</td><td>{godowns.find((g) => g.id === s.van_id)?.name ?? s.van_id}</td><td className={own.num}>{formatCurrency(s.bills_total)}</td><td className={own.num}>{formatCurrency(s.cash_counted)}</td><td className={own.num}>{formatCurrency(s.difference)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}

      <h4>{distT('pickList')}</h4>
      <p className={own.muted}>{distT('pickIntro')}</p>
      <div className={own.tableWrap}>
        <table className={own.table}>
          <tbody>{openDocs.map((d) => (
            <tr key={d.id}>
              <td><input type="checkbox" aria-label={d.invoice_number} checked={pick.has(d.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(d.id); else n.delete(d.id); setPick(n); }} /></td>
              <td>{d.invoice_number}</td><td>{d.client?.name}</td><td>{d.issue_date}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div><button type="button" className={controls.btnOutline} disabled={!pick.size} onClick={printPick} data-pick-print><Printer size={14} aria-hidden="true" /> {distT('printPick')}</button></div>
    </div>
  );
}
