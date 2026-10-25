import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Plus, Save, ShoppingCart, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId, getTable } from '../../lib/storage';
import { computeStock } from '../../lib/inventory';
import { bomsDb } from '../../lib/manufacturing';
import { pendingPoQty } from '../../lib/reorder';
import { lastPurchaseRates, poLinesFromMrp, productionPlansDb, runMrp } from '../../lib/mrp';
import { poTotals, purchaseOrdersDb, validatePo } from '../../lib/purchase-orders';
import { businessContext } from '../../lib/purchases-context';
import type { ProductionPlan, ProductionPlanLine } from '../../types/manufacturing';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote, Vendor } from '../../types/purchases';
import { s7T } from '../../i18n/areas/inventory-7s';
import { money, qtyText, type MfgContext } from './context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

const blank = (): ProductionPlanLine => ({ id: generateId(), item_id: '', qty: 1 });

/** /manufacturing?tab=plan — production plan and material requirement (MRP) against BOMs (7S, 7.37). */
export function MrpTab({ ctx }: { ctx: MfgContext }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plans = useMemo(() => productionPlansDb.all(), [ctx.version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vendors = useMemo(() => getTable<Vendor>('vendors').sort((a, b) => a.name.localeCompare(b.name)), [ctx.version]);
  const boms = useMemo(() => bomsDb.all(), [ctx.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const withBom = useMemo(() => new Set(boms.map((b) => b.item_id)), [boms]);
  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [number, setNumber] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(todayInput());
  const [due, setDue] = useState('');
  const [lines, setLines] = useState<ProductionPlanLine[]>(() => [blank()]);
  const [narration, setNarration] = useState('');
  const [netFinished, setNetFinished] = useState(true);
  const [vendorId, setVendorId] = useState('');
  const [deleting, setDeleting] = useState<ProductionPlan | null>(null);

  const base = useMemo(() => {
    const positions = computeStock(ctx.inputs);
    return {
      stock: new Map(positions.map((p) => [p.item.id, p.qty])),
      rates: lastPurchaseRates(positions),
      onOrder: pendingPoQty(getTable<PurchaseOrder>('purchase_orders'), getTable<PurchaseRecord>('purchases'), ctx.items, getTable<ReceiptNote>('receipt_notes')),
    };
  }, [ctx.inputs, ctx.items]);
  const rows = useMemo(() => runMrp({ plan: lines, items: ctx.items, boms, ...base, netFinished }), [lines, ctx.items, boms, base, netFinished]);
  const buy = rows.filter((r) => r.action === 'buy');

  const load = (p: ProductionPlan | null) => {
    setPlanId(p?.id);
    setNumber(p?.number);
    setDate(p?.date ?? todayInput());
    setDue(p?.due_date ?? '');
    setLines(p ? p.lines.map((l) => ({ ...l })) : [blank()]);
    setNarration(p?.narration ?? '');
  };
  const patch = (id: string, change: Partial<ProductionPlanLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const save = () => {
    try {
      const saved = productionPlansDb.save({ id: planId, number, date, due_date: due || undefined, lines: lines.filter((l) => l.item_id), narration: narration.trim() || undefined }, ctx.items);
      setPlanId(saved.id);
      setNumber(saved.number);
      ctx.changed(s7T('planSaved', { number: saved.number }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  const createPo = () => {
    const vendor = vendors.find((v) => v.id === vendorId) ?? vendors.find((v) => v.name === buy[0]?.vendor);
    const poLines = poLinesFromMrp(buy);
    const draft = { vendor_name: vendor?.name ?? '', date: todayInput(), lines: poLines };
    const err = validatePo(draft);
    if (err) return ctx.error(err);
    try {
      const business = businessContext();
      const pos = vendor?.state_code || vendor?.gstin?.slice(0, 2) || business.stateCode;
      const t = poTotals(poLines, pos, business.stateCode);
      const po = purchaseOrdersDb.save({
        ...draft, vendor_id: vendor?.id, vendor_gstin: vendor?.gstin, place_of_supply: pos, ...(due ? { expected_date: due } : {}),
        taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, notes: `Raised from production plan${number ? ` ${number}` : ''}`,
      });
      ctx.changed(s7T('poCreated', { number: po.po_number }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  const actionText = (a: string) => (a === 'make' ? s7T('actMake') : a === 'buy' ? s7T('actBuy') : s7T('actNone'));

  return (
    <>
      <p className={styles.muted} style={{ margin: '0 0 0.75rem' }}>{s7T('mrpIntro')}</p>
      {!ctx.canBooks && <p className={styles.muted}>{s7T('readOnly')}</p>}
      <div className={styles.planGrid}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="pp-date">{s7T('planDate')}{number ? ` · ${number}` : ''}</label>
          <input id="pp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="pp-due">{s7T('dueDate')}</label>
          <input id="pp-due" type="date" className={controls.input} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="pp-narr">{s7T('narration')}</label>
          <input id="pp-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>
      <div className={styles.wrap} style={{ marginTop: '0.75rem' }}>
        <table className={styles.grid}>
          <thead><tr><th>{s7T('planItem')}</th><th className={styles.num}>{s7T('planQty')}</th><th><span className={surface.srOnly}>{s7T('delete')}</span></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td>
                  <select id={`pp-${l.id}`} className={controls.select} aria-label={`${s7T('planItem')} ${i + 1}`} value={l.item_id} onChange={(e) => patch(l.id, { item_id: e.target.value })}>
                    <option value="">{s7T('choose')}</option>
                    {tracked.map((it) => <option key={it.id} value={it.id}>{it.name}{withBom.has(it.id) ? ' ★' : ''}</option>)}
                  </select>
                </td>
                <td>
                  <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${s7T('planQty')} ${i + 1}`} value={String(l.qty ?? '')}
                    onChange={(e) => patch(l.id, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const next = blank();
                      setLines((ls) => [...ls, next]);
                      requestAnimationFrame(() => document.getElementById(`pp-${next.id}`)?.focus());
                    }} />
                </td>
                <td><button type="button" className={controls.btnIcon} aria-label={s7T('removePlanLine', { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={15} aria-hidden="true" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setLines((ls) => [...ls, blank()])}><Plus size={14} aria-hidden="true" /> {s7T('addPlanLine')}</button>
      </div>
      <div className={styles.bar} style={{ marginTop: '0.5rem' }}>
        <label className={controls.check}><input type="checkbox" checked={netFinished} onChange={(e) => setNetFinished(e.target.checked)} /> {s7T('netFinished')}</label>
        {ctx.canBooks && (
          <span style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => load(null)}>{s7T('newPlan')}</button>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={save} data-testid="mrp-save"><Save size={14} aria-hidden="true" /> {s7T('savePlan')}</button>
          </span>
        )}
      </div>

      <p className={styles.section} style={{ margin: '1rem 0 0.5rem' }}>{s7T('requirement')}</p>
      {rows.length === 0 ? <p className={styles.muted}>{s7T('mrpEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-testid="mrp-table">
            <thead>
              <tr>
                <th>{s7T('colItem')}</th><th className={styles.num}>{s7T('colLevel')}</th><th className={styles.num}>{s7T('colGross')}</th>
                <th className={styles.num}>{s7T('colStock')}</th><th className={styles.num}>{s7T('colOnOrder')}</th><th className={styles.num}>{s7T('colNet')}</th>
                <th>{s7T('colAction')}</th><th className={styles.num}>{s7T('colSuggested')}</th><th className={styles.num}>{s7T('colRate')}</th><th>{s7T('colFor')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item.id}>
                  <td style={{ paddingLeft: `${0.5 + r.level}rem` }}>{r.item.name}</td>
                  <td className={styles.num}>{r.level}</td>
                  <td className={styles.num}>{qtyText(r.gross)} {r.item.unit}</td>
                  <td className={styles.num}>{qtyText(r.stock)}</td>
                  <td className={styles.num}>{qtyText(r.onOrder)}</td>
                  <td className={styles.num}>{qtyText(r.net)}</td>
                  <td>
                    {r.action === 'make' && ctx.canBooks
                      ? <Link to={`/manufacturing?tab=mfg&make=${encodeURIComponent(r.item.id)}&qty=${r.suggested}`} className={cn(controls.btnOutline, controls.btnSm)}><Factory size={13} aria-hidden="true" /> {s7T('manufacture')}</Link>
                      : <span className={r.action === 'buy' ? styles.loss : styles.muted}>{actionText(r.action)}</span>}
                  </td>
                  <td className={styles.num}><strong>{r.suggested ? qtyText(r.suggested) : '—'}</strong></td>
                  <td className={styles.num}>{r.action === 'buy' ? money(r.rate) : ''}</td>
                  <td className={styles.muted}>{r.for.map((x) => (x === 'Plan' ? s7T('planWord') : x)).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ctx.canBooks && buy.some((r) => r.suggested > 0) && (
        <div className={styles.bar} style={{ marginTop: '0.5rem', justifyContent: 'flex-end' }}>
          <select className={controls.select} aria-label={s7T('vendor')} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">{s7T('vendor')}: {buy[0]?.vendor ?? s7T('choose')}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={createPo} data-testid="mrp-po">
            <ShoppingCart size={14} aria-hidden="true" /> {s7T('createPo', { n: buy.filter((r) => r.suggested > 0).length })}
          </button>
        </div>
      )}

      <p className={styles.section} style={{ margin: '1.25rem 0 0.5rem' }}>{s7T('plans')}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{s7T('planNumber')}</th><th>{s7T('planDate')}</th><th>{s7T('dueDate')}</th><th>{s7T('planItems')}</th><th><span className={surface.srOnly}>{s7T('open')}</span></th></tr></thead>
          <tbody>
            {[...plans].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true })).map((p) => (
              <tr key={p.id}>
                <td className={surface.mono}>{p.number}</td>
                <td>{formatDate(p.date)}</td>
                <td>{p.due_date ? formatDate(p.due_date) : '—'}</td>
                <td>{p.lines.map((l) => `${ctx.items.find((i) => i.id === l.item_id)?.name ?? '?'} × ${qtyText(num(l.qty))}`).join(', ')}</td>
                <td className={surface.rowActions}>
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => load(p)}>{s7T('open')}</button>
                  {ctx.canBooks && <button type="button" className={controls.btnDanger} aria-label={`${s7T('delete')} ${p.number}`} onClick={() => setDeleting(p)}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={5} className={styles.muted}>{s7T('noPlans')}</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!deleting} destructive title={s7T('delete')} message={s7T('confirmDeletePlan', { number: deleting?.number ?? '' })} confirmLabel={s7T('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            productionPlansDb.remove(deleting.id);
            if (deleting.id === planId) load(null);
            ctx.changed(s7T('planDeleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}
