/**
 * Offers & schemes (7U) — Dashboard → Business tiles: bill-value discount slabs and buy-A-get-B free.
 * Same-item "buy X get Y" schemes stay in Settings → Items → Price levels & schemes.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import { schemeLabel, schemesDb, type BillSlab, type Scheme } from '../../lib/pricing';
import { localDb } from '../../lib/localDb';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { x7T } from '../../i18n/areas/extras-7u';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from './x7u.module.css';

type Notify = (m: string, tone?: 'success' | 'error' | 'info') => void;
type Kind = 'bill_value' | 'buy_get';
const blank = (kind: Kind): Scheme => ({ id: '', kind, item_id: '', item_name: '', buy_qty: kind === 'buy_get' ? 1 : 0, free_qty: kind === 'buy_get' ? 1 : 0, ...(kind === 'bill_value' ? { slabs: [{ min_value: 0, percent: 0 }] } : { free_item_id: '', free_item_name: '' }) });
const n = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0;

export function OffersPanel({ notify, icon }: { notify: Notify; icon?: ReactNode }) {
  useT();
  const { can } = useCan();
  const [tick, setTick] = useState(0);
  const offers = useMemo(() => schemesDb.all().filter((s) => s.kind === 'bill_value' || s.kind === 'buy_get'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useMemo(() => localDb.items.getAll(), []);
  const [form, setForm] = useState<Scheme | null>(null);
  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify(ok);
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const setSlab = (i: number, patch: Partial<BillSlab>) => form && setForm({ ...form, slabs: (form.slabs ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const pickItem = (id: string, which: 'paid' | 'free') => {
    const c = catalog.find((x) => x.id === id);
    if (!form) return;
    setForm(which === 'paid' ? { ...form, item_id: id, item_name: c?.name ?? '' } : { ...form, free_item_id: id, free_item_name: c?.name ?? '' });
  };
  const edit = can('master.edit');

  return (
    <section className={surface.card} aria-label={x7T('offersTitle')} data-x7u="offers">
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{icon} {x7T('offersTitle')}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        {offers.length === 0 ? <p className={own.muted}>{x7T('noOffers')}</p> : (
          <ul className={own.list}>
            {offers.map((s) => (
              <li key={s.id} className={own.item}>
                <span>{schemeLabel(s)}{s.valid_to ? ` · ${x7T('until', { date: s.valid_to })}` : ''}</span>
                {edit && (
                  <span className={own.tools}>
                    <label className={controls.check}><input type="checkbox" checked={s.active !== false} onChange={(e) => run(() => schemesDb.save({ ...s, active: e.target.checked }), x7T('offerSaved'))} /> {x7T('active')}</label>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setForm({ ...s })}>{x7T('edit')}</button>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={x7T('remove')} onClick={() => run(() => schemesDb.remove(s.id), x7T('offerDeleted'))}><Trash2 size={14} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {edit && !form && (
          <div className={own.tools}>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setForm(blank('bill_value'))}><Plus size={14} /> {x7T('newBillOffer')}</button>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setForm(blank('buy_get'))}><Plus size={14} /> {x7T('newBuyGet')}</button>
          </div>
        )}
        {edit && form && (
          <div className={own.box}>
            {form.kind === 'bill_value' ? (
              <>
                <label className={controls.field}><span className={controls.label}>{x7T('offerName')}</span>
                  <input className={controls.input} value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Diwali offer" /></label>
                {(form.slabs ?? []).map((x, i) => (
                  <div key={i} className={own.row}>
                    <label className={controls.field}><span className={controls.label}>{x7T('fromBill')}</span>
                      <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={String(x.min_value)} onChange={(e) => setSlab(i, { min_value: n(e.target.value) })} /></label>
                    <label className={controls.field}><span className={controls.label}>{x7T('pctOff')}</span>
                      <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={String(x.percent ?? '')} onChange={(e) => setSlab(i, { percent: n(e.target.value), amount: undefined })} /></label>
                    <label className={controls.field}><span className={controls.label}>{x7T('amtOff')}</span>
                      <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={String(x.amount ?? '')} onChange={(e) => setSlab(i, { amount: n(e.target.value), percent: undefined })} /></label>
                    <button type="button" className={controls.btnGhost} onClick={() => setForm({ ...form, slabs: (form.slabs ?? []).filter((_, k) => k !== i) })}>{x7T('remove')}</button>
                  </div>
                ))}
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setForm({ ...form, slabs: [...(form.slabs ?? []), { min_value: 0, percent: 0 }] })}><Plus size={14} /> {x7T('addSlab')}</button>
              </>
            ) : (
              <div className={own.row}>
                <label className={controls.field}><span className={controls.label}>{x7T('buyItem')}</span>
                  <select className={controls.select} value={form.item_id} onChange={(e) => pickItem(e.target.value, 'paid')}>
                    <option value="">—</option>
                    {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <label className={controls.field}><span className={controls.label}>{x7T('buyQty')}</span>
                  <input className={cn(controls.input, controls.inputNumeric)} inputMode="numeric" value={String(form.buy_qty)} onChange={(e) => setForm({ ...form, buy_qty: n(e.target.value) })} /></label>
                <label className={controls.field}><span className={controls.label}>{x7T('freeItem')}</span>
                  <select className={controls.select} value={form.free_item_id ?? ''} onChange={(e) => pickItem(e.target.value, 'free')}>
                    <option value="">—</option>
                    {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <label className={controls.field}><span className={controls.label}>{x7T('freeQty')}</span>
                  <input className={cn(controls.input, controls.inputNumeric)} inputMode="numeric" value={String(form.free_qty)} onChange={(e) => setForm({ ...form, free_qty: n(e.target.value) })} /></label>
              </div>
            )}
            <div className={own.row}>
              <label className={controls.field}><span className={controls.label}>{x7T('validFrom')}</span>
                <input className={controls.input} type="date" value={form.valid_from ?? ''} onChange={(e) => setForm({ ...form, valid_from: e.target.value || undefined })} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('validTo')}</span>
                <input className={controls.input} type="date" value={form.valid_to ?? ''} onChange={(e) => setForm({ ...form, valid_to: e.target.value || undefined })} /></label>
            </div>
            <div className={own.tools}>
              <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => { schemesDb.save(form); setForm(null); }, x7T('offerSaved'))}><Save size={14} /> {x7T('save')}</button>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setForm(null)}>{x7T('cancel')}</button>
            </div>
          </div>
        )}
        <p className={own.muted}>{x7T('offersGst')}</p>
      </div>
    </section>
  );
}
