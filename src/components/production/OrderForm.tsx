import { useMemo, useState } from 'react';
import { Factory } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { bomsForItem } from '../../lib/manufacturing';
import { loadCostCentres, sortCostCentres } from '../../lib/cost-centres';
import { productionOrdersDb, validateOrder } from '../../lib/production/orders';
import type { Bom } from '../../types/manufacturing';
import type { InvoiceRecord } from '../../types/invoice';
import type { ProductionOrder } from '../../types/production-r4';
import { pT } from '../../i18n/areas/production-r4';
import type { MfgContext } from '../manufacturing/context';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

/** New / edit production order (R4-A1). */
export function OrderForm({ ctx, order, boms, salesOrders, onClose, onSaved }: {
  ctx: MfgContext;
  order: ProductionOrder | null;
  boms: Bom[];
  salesOrders: InvoiceRecord[];
  onClose: () => void;
  onSaved: (o: ProductionOrder) => void;
}) {
  const makeable = useMemo(() => ctx.items.filter((i) => i.track_stock && boms.some((b) => b.item_id === i.id)).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items, boms]);
  const centres = useMemo(() => sortCostCentres(loadCostCentres()).filter((c) => c.active !== false), []);
  const [date, setDate] = useState(order?.date ?? todayInput());
  const [itemId, setItemId] = useState(order?.item_id ?? '');
  const [bomId, setBomId] = useState(order?.bom_id ?? '');
  const [qty, setQty] = useState(String(order?.planned_qty ?? ''));
  const [due, setDue] = useState(order?.due_date ?? '');
  const [soId, setSoId] = useState(order?.so_id ?? '');
  const [soLine, setSoLine] = useState(order?.so_line_id ?? '');
  const [centre, setCentre] = useState(order?.cost_centre_id ?? '');
  const [store, setStore] = useState(order?.store_godown_id ?? '');
  const [outGodown, setOutGodown] = useState(order?.output_godown_id ?? '');
  const [toQc, setToQc] = useState(!!order?.output_to_qc);
  const [conv, setConv] = useState(order?.standard_conversion ? String(order.standard_conversion) : '');
  const [narration, setNarration] = useState(order?.narration ?? '');
  const [error, setError] = useState('');
  const so = salesOrders.find((d) => d.id === soId);
  const stores = ctx.godowns.filter((g) => g.kind !== 'wip' && g.kind !== 'qc' && g.kind !== 'transit');

  const submit = () => {
    const input = {
      id: order?.id, date, item_id: itemId, bom_id: bomId || undefined, planned_qty: num(qty), due_date: due || undefined,
      so_id: soId || undefined, so_line_id: soId ? soLine || undefined : undefined, cost_centre_id: centre || undefined,
      store_godown_id: store || undefined, output_godown_id: outGodown || undefined, output_to_qc: toQc || undefined,
      standard_conversion: num(conv) > 0 ? num(conv) : undefined, narration: narration.trim() || undefined,
    };
    const err = validateOrder(input, ctx.items, boms);
    if (err) return setError(err);
    try {
      const saved = productionOrdersDb.save(input, ctx.items, boms);
      ctx.changed(pT('orderSaved', { number: saved.number }));
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={order ? `${pT('order')} ${order.number}` : pT('newOrder')}
      subtitle={order ? undefined : pT('nextNumber', { number: productionOrdersDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{pT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit} data-testid="wo-save"><Factory size={16} aria-hidden="true" /> {pT('save')}</button></>}>
      <form className={mfg.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-date">{pT('date')}</label>
            <DateField id="wo-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-item">{pT('item')}</label>
            <SelectField id="wo-item" className={controls.select} value={itemId} autoFocus onChange={(e) => { setItemId(e.target.value); setBomId(bomsForItem(boms, e.target.value)[0]?.id ?? ''); }}>
              <option value="">{pT('choose')}</option>
              {makeable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </SelectField>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-bom">{pT('bom')}</label>
            <SelectField id="wo-bom" className={controls.select} value={bomId} onChange={(e) => setBomId(e.target.value)}>
              {bomsForItem(boms, itemId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ` (${pT('default')})` : ''}</option>)}
            </SelectField>
          </div>
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-qty">{pT('plannedQty')}{itemId ? ` (${ctx.items.find((i) => i.id === itemId)?.unit ?? ''})` : ''}</label>
            <input id="wo-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-due">{pT('due')}</label>
            <DateField id="wo-due" className={controls.input} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-conv">{pT('stdConversion')}</label>
            <input id="wo-conv" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={conv} onChange={(e) => setConv(e.target.value)} />
          </div>
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-so">{pT('salesOrder')}</label>
            <SelectField id="wo-so" className={controls.select} value={soId} onChange={(e) => { setSoId(e.target.value); setSoLine(''); }}>
              <option value="">-</option>
              {salesOrders.map((d) => <option key={d.id} value={d.id}>{d.invoice_number} · {d.client?.name ?? ''}</option>)}
            </SelectField>
          </div>
          {so && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="wo-soline">{pT('soLine')}</label>
              <SelectField id="wo-soline" className={controls.select} value={soLine} onChange={(e) => setSoLine(e.target.value)}>
                <option value="">-</option>
                {(so.items ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} × {l.quantity}</option>)}
              </SelectField>
            </div>
          )}
          {centres.length > 0 && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="wo-cc">{pT('costCentre')}</label>
              <SelectField id="wo-cc" className={controls.select} value={centre} onChange={(e) => setCentre(e.target.value)}>
                <option value="">-</option>
                {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </div>
          )}
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-store">{pT('storeGodown')}</label>
            <SelectField id="wo-store" className={controls.select} value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">-</option>
              {stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-outg">{pT('outputGodown')}</label>
            <SelectField id="wo-outg" className={controls.select} value={outGodown} disabled={toQc} onChange={(e) => setOutGodown(e.target.value)}>
              <option value="">-</option>
              {stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField>
          </div>
          <label className={controls.check} style={{ alignSelf: 'end' }}><input type="checkbox" checked={toQc} onChange={(e) => setToQc(e.target.checked)} /> {pT('outputToQc')}</label>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="wo-narr">{pT('narration')}</label>
          <input id="wo-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
