/**
 * TR-B1 weight / bag sub-row (commodity or agency pack; lazy). Shown on lines of a stock item marked
 * `sold_by_weight_bags`, or on any line that already carries a weighing. The net weight becomes the line quantity in
 * its billing unit (`tr-weight.ts`); typing a quantity over it drops the weighing (manual line).
 * `WeightFields` is shared with the bill modal (`BillTradePanel`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { tbT } from '../../i18n/areas/trade-r8b';
import { weighItem } from './tr-b-editor';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { PACKAGE_KINDS, WEIGHT_UNITS, blankWeight, weighNet, wtHolds, wtQuantity } from '../../lib/trade/tr-weight';
import type { InvoiceItem } from '../../types/invoice';
import type { LineWeight, WeightUnit } from '../../types/trade-r8';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export function WeightFields({ wt, unit, onChange, onClear }: { wt: LineWeight; unit?: string; onChange: (wt: LineWeight) => void; onClear: () => void }) {
  const set = (p: Partial<LineWeight>) => onChange({ ...wt, ...p });
  const q = wtQuantity(wt, unit);
  const num = (label: string, v: number, k: keyof LineWeight, w = 'wt') => (
    <label className={controls.field}><span className={controls.label}>{label}</span><NumberInput className={controls.input} value={v} onChange={(x) => set({ [k]: x })} data-wt={w} /></label>
  );
  return (
    <div className={own.stack} data-line-weight>
      <div className={own.row}>
        {num(tbT('packages'), wt.packages, 'packages', 'packages')}
        <label className={controls.field}><span className={controls.label}>{tbT('kind')}</span>
          <input className={controls.input} list="r8b-kinds" value={wt.kind} onChange={(e) => set({ kind: e.target.value.toUpperCase() })} /></label>
        {num(tbT('gross'), wt.gross, 'gross', 'gross')}
        <label className={controls.field}><span className={controls.label}>{tbT('unit')}</span>
          <select className={controls.select} value={wt.gross_unit} onChange={(e) => set({ gross_unit: e.target.value as WeightUnit })}>{WEIGHT_UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        {num(tbT('tare'), wt.tare_per_package, 'tare_per_package', 'tare')}
        <label className={controls.field}><span className={controls.label}>{tbT('ded')}</span>
          <span className={own.row}>
            <NumberInput className={controls.input} value={wt.deduction.value} onChange={(x) => set({ deduction: { ...wt.deduction, value: x } })} data-wt="ded" />
            <select className={controls.select} value={wt.deduction.basis} onChange={(e) => set({ deduction: { ...wt.deduction, basis: e.target.value as LineWeight['deduction']['basis'] } })}>
              {(['per_qtl', 'per_package', 'percent'] as const).map((b) => <option key={b} value={b}>{tbT(`ded.${b}`)}</option>)}
            </select>
          </span></label>
      </div>
      <datalist id="r8b-kinds">{PACKAGE_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
      <span className={controls.hint} data-wt-net>
        {q === null ? tbT('notWeight') : tbT('net', { net: weighNet(wt).net.toLocaleString('en-IN'), qty: q.toFixed(3), unit: unit ?? '' })}{' '}
        <button type="button" className={controls.btnGhost} onClick={onClear}>{tbT('clear')}</button>
      </span>
    </div>
  );
}

/** Editor line (invoice / quotation / challan …): writes `wt` and the net quantity through the store. */
export default function LineWeightRow({ item }: { item: InvoiceItem; index: number }) {
  useT();
  const marked = useMemo(() => weighItem(item.name), [item.name]);
  const [open, setOpen] = useState(false);
  const patch = useInvoiceStore.getState().patchItem;
  const unitRef = useRef(item.unit);
  useEffect(() => {
    if (!item.wt) return;
    const unitChanged = unitRef.current !== item.unit;
    unitRef.current = item.unit;
    const q = wtQuantity(item.wt, item.unit);
    if (unitChanged && q !== null) patch(item.id, { quantity: q }); // a new billing unit: same weighing, converted
    else if (!wtHolds(item)) patch(item.id, { wt: undefined }); // a typed quantity makes the line manual
  }, [item.quantity, item.unit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item.wt && !(marked && open)) {
    return marked ? <button type="button" className={controls.btnGhost} onClick={() => setOpen(true)} data-weigh>{tbT('weigh')}</button> : null;
  }
  const wt = item.wt ?? blankWeight();
  return (
    <WeightFields
      wt={wt}
      unit={item.unit}
      onChange={(next) => {
        const q = wtQuantity(next, item.unit);
        patch(item.id, q === null ? { wt: next } : { wt: next, quantity: q });
      }}
      onClear={() => {
        setOpen(false);
        patch(item.id, { wt: undefined });
      }}
    />
  );
}
