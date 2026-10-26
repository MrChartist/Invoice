import { useMemo, useState } from 'react';
import { ArrowLeftRight, ShoppingCart } from 'lucide-react';
import { computeStock } from '../../lib/inventory';
import { computeTracking } from '../../lib/stock-tracking';
import { pendingPoQty, poLinesFromReorder, reorderStatus, replenishPlan, type ReorderRow } from '../../lib/reorder';
import { fillRates, loadRequestDocs, openQtyByStore, transferRequestsDb } from '../../lib/retail/transfer-requests';
import { poTotals, purchaseOrdersDb, validatePo } from '../../lib/purchase-orders';
import { businessContext } from '../../lib/purchases-context';
import { godownName, godownsDb } from '../../lib/godowns';
import { generateId, peekTable } from '../../lib/storage';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote, Vendor } from '../../types/purchases';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import type { MfgContext } from '../manufacturing/context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import css from './retail-r4.module.css';

/**
 * Store replenishment (R4-B5), under Reorder Status: each store godown with "Refill from" is filled from that godown's
 * free stock first (above its own reorder level, net of pending requests and goods in transit); the rest is a purchase
 * suggestion (MOQ, last supplier). One click raises the transfer requests, another the purchase order.
 */
export default function ReplenishTab({ ctx }: { ctx: MfgContext }) {
  useT();
  const today = todayInput();
  const godowns = useMemo(() => {
    const stored = godownsDb.stored();
    return ctx.godowns.map((g) => ({ ...stored.find((s) => s.id === g.id), ...g, replenish_from: g.replenish_from ?? stored.find((s) => s.id === g.id)?.replenish_from }));
  }, [ctx.godowns]);
  const plan = useMemo(() => {
    const positions = computeStock(ctx.inputs);
    const pending = pendingPoQty(peekTable<PurchaseOrder>('purchase_orders') as PurchaseOrder[], peekTable<PurchaseRecord>('purchases') as PurchaseRecord[], ctx.items, peekTable<ReceiptNote>('receipt_notes') as ReceiptNote[]);
    const tracking = computeTracking(ctx.inputs);
    const rows = reorderStatus(positions, pending, tracking);
    const docs = loadRequestDocs();
    const requests = transferRequestsDb.all();
    return { rows: replenishPlan(rows, godowns, tracking, openQtyByStore(requests, docs)), fill: fillRates(requests, docs, today) };
  }, [ctx.inputs, ctx.items, godowns, today]);
  const vendors = useMemo(() => [...peekTable<Vendor>('vendors')].sort((a, b) => a.name.localeCompare(b.name)), []);
  const [vendorId, setVendorId] = useState('');
  const name = (id: string) => godownName(godowns, id);
  const toTransfer = plan.rows.filter((r) => r.transfer > 0);
  const toBuy = plan.rows.filter((r) => r.purchase > 0);

  const raiseRequests = () => {
    try {
      const groups = new Map<string, typeof toTransfer>();
      for (const r of toTransfer) groups.set(`${r.source}|${r.store}`, [...(groups.get(`${r.source}|${r.store}`) ?? []), r]);
      const made: string[] = [];
      for (const rows of groups.values()) {
        const req = transferRequestsDb.save({ date: today, from_godown: rows[0].source, to_godown: rows[0].store, lines: rows.map((r) => ({ id: generateId(), item_id: r.item.id, qty: r.transfer })), notes: 'Raised from Replenish' });
        made.push(req.number);
      }
      ctx.changed(sT('rpRequests', { numbers: made.join(', ') }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  const raisePo = () => {
    const vendor = vendors.find((v) => v.id === vendorId) ?? vendors.find((v) => v.name === toBuy[0]?.vendor);
    const lines = poLinesFromReorder(toBuy.map((r) => ({ item: r.item, suggested: r.purchase, rate: r.rate } as ReorderRow)), generateId);
    const draft = { vendor_name: vendor?.name ?? '', date: today, lines };
    const err = validatePo(draft);
    if (err) return ctx.error(err);
    try {
      const business = businessContext();
      const pos = vendor?.state_code || vendor?.gstin?.slice(0, 2) || business.stateCode;
      const t = poTotals(lines, pos, business.stateCode);
      const po = purchaseOrdersDb.save({ ...draft, vendor_id: vendor?.id, vendor_gstin: vendor?.gstin, place_of_supply: pos, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, notes: 'Raised from Replenish (remainder after warehouse transfers)' });
      ctx.changed(sT('rpPo', { number: po.po_number }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  return (
    <section className={css.box} aria-label={sT('rpTitle')} data-replenish>
      <div className={css.boxHead}>
        <span><ArrowLeftRight size={14} aria-hidden="true" /> {sT('rpTitle')}</span>
        {ctx.canBooks && (
          <span className={css.actions}>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!toTransfer.length} onClick={raiseRequests}><ArrowLeftRight size={14} aria-hidden="true" /> {sT('rpRaise', { n: toTransfer.length })}</button>
            <select className={controls.select} aria-label={sT('vendor')} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">{sT('vendor')}: {toBuy[0]?.vendor ?? '—'}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!toBuy.length} onClick={raisePo}><ShoppingCart size={14} aria-hidden="true" /> {sT('rpPoBtn', { n: toBuy.length })}</button>
          </span>
        )}
      </div>
      <div className={css.wrap}>
        <table className={surface.table}>
          <thead><tr><th>{sT('item')}</th><th>{sT('store')}</th><th>{sT('rpSource')}</th><th className={css.num}>{sT('rpShortfall')}</th><th className={css.num}>{sT('rpPending')}</th><th className={css.num}>{sT('inTransit')}</th><th className={css.num}>{sT('rpTransfer')}</th><th className={css.num}>{sT('rpBuy')}</th><th className={css.num}>{sT('rate')}</th></tr></thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={`${r.store}|${r.item.id}`}>
                <td>{r.item.name}</td><td>{name(r.store)}</td><td>{name(r.source)}</td>
                <td className={css.num}>{r.shortfall}</td><td className={css.num}>{r.pendingRequests}</td><td className={css.num}>{r.inTransit}</td>
                <td className={css.num}><strong>{r.transfer}</strong></td><td className={css.num}><strong>{r.purchase}</strong></td><td className={css.num}>{formatCurrency(r.rate)}</td>
              </tr>
            ))}
            {!plan.rows.length && <tr><td colSpan={9} className={css.muted}>{sT('rpNone')}</td></tr>}
          </tbody>
        </table>
      </div>
      {plan.fill.length > 0 && <p className={css.note}>{sT('fillRate')}: {plan.fill.map((f) => `${name(f.godown)} ${f.rate}%`).join(' · ')}</p>}
      <p className={css.note}>{sT('rpHint')}</p>
    </section>
  );
}
