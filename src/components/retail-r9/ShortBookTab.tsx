/**
 * RT-A4 Inventory → Short book: open rows by item (what customers asked for), add a row, close rows whose stock came in
 * (or by hand), make draft purchase orders grouped by each item's last supplier, and "Tell the customer" (`wa.me`).
 */
import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';
import { getTable } from '../../lib/storage';
import { loadPositions } from '../../lib/inventory';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';
import { addShortBook, arrivedRows, backInStockLink, closeShortBook, lastSuppliers, loadShortBook, makePurchaseOrders, supplierOf } from '../../lib/retail/rt-short-book';
import type { ShortBookEntry } from '../../types/retail-r9';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export default function ShortBookTab({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const day = todayInput();
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ name: '', qty: 1, customer: '', phone: '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => loadShortBook(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stock = useMemo(() => loadPositions(), [tick]);
  const suppliers = useMemo(() => lastSuppliers(getTable('purchases')), []);
  const stockOf = (r: ShortBookEntry) => {
    const p = stock.find((x) => (r.item_id ? x.item.id === r.item_id : norm(x.item.name) === norm(r.name)));
    return p ? p.qty : 0;
  };
  const arrived = arrivedRows(rows, stockOf);
  const open = rows.filter((r) => r.status !== 'closed');
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const run = (fn: () => string | Promise<string>) => {
    Promise.resolve()
      .then(fn)
      .then((m) => { setTick((t) => t + 1); onDone(m); })
      .catch((err: Error) => onDone(err.message, true));
  };
  const add = () => run(() => {
    const it = stock.find((p) => norm(p.item.name) === norm(form.name))?.item;
    const row = addShortBook({ date: day, name: form.name, qty: form.qty, ...(it ? { item_id: it.id, unit: it.unit } : {}), customer: form.customer, phone: form.phone });
    setForm({ name: '', qty: 1, customer: '', phone: '' });
    return rtaT('sbAdded', { name: row.name });
  });
  return (
    <section className={surface.card} data-short-book>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><ClipboardList size={16} aria-hidden="true" /> {rtaT('sbTitle')}</span></div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>{rtaT('sbSub')}</p>
        <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
          <label className={controls.field}><span className={controls.label}>{rtaT('sbItem')}</span>
            <input className={controls.input} value={form.name} list="sb-items" onChange={(e) => setForm({ ...form, name: e.target.value })} data-sb-name />
            <datalist id="sb-items">{stock.map((p) => <option key={p.item.id} value={p.item.name} />)}</datalist>
          </label>
          <label className={controls.field} style={{ maxWidth: 90 }}><span className={controls.label}>{rtaT('sbQty')}</span>
            <NumberInput className={controls.input} value={form.qty} onChange={(qty) => setForm({ ...form, qty })} />
          </label>
          <label className={controls.field}><span className={controls.label}>{rtaT('sbCustomer')}</span>
            <input className={controls.input} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
          </label>
          <label className={controls.field}><span className={controls.label}>{rtaT('sbPhone')}</span>
            <input className={controls.input} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <button type="button" className={controls.btnPrimary} disabled={!form.name.trim()} onClick={add} data-sb-add>{rtaT('sbSave')}</button>
        </div>
        {arrived.length > 0 && (
          <p className={controls.hint}>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => `${closeShortBook(arrived.map((r) => r.id), 'arrived', day)} ✓`)} data-sb-arrived>{rtaT('sbArrived')}: {arrived.length}</button>
          </p>
        )}
        {open.length === 0 ? <p className={controls.hint}>{rtaT('sbEmpty')}</p> : (
          <>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!open.some((r) => r.status === 'open')} onClick={() => run(async () => rtaT('sbPoMade', { n: await makePurchaseOrders(day) }))} data-sb-po>{rtaT('sbMakePo')}</button>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead><tr><th>{rtaT('sbItem')}</th><th className={surface.numeric}>{rtaT('sbQty')}</th><th>{rtaT('sbCustomer')}</th><th>{rtaT('sbSupplier')}</th><th /></tr></thead>
                <tbody>
                  {open.map((r) => {
                    const wa = stockOf(r) > 0 ? backInStockLink(r, rtaT('sbCallMsg', { item: r.name, shop })) : undefined;
                    return (
                      <tr key={r.id} data-sb-row={r.name}>
                        <td>{r.name} <small>{r.date}{r.status === 'ordered' ? ` · ${rtaT('sbOrdered')}` : ''}</small></td>
                        <td className={surface.numeric}>{r.qty} {r.unit ?? ''}</td>
                        <td>{[r.customer, r.phone].filter(Boolean).join(' · ') || rtaT('sbNone')}</td>
                        <td>{supplierOf(suppliers, r)?.vendorName ?? rtaT('sbNone')}</td>
                        <td style={{ textAlign: 'right' }}>
                          {wa && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={wa} target="_blank" rel="noopener noreferrer">{rtaT('sbCall')}</a>}
                          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => `${closeShortBook([r.id], 'manual', day)} ✓`)}>{rtaT('sbClose')}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
