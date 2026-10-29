/**
 * RT-A2 on Inventory: "Labels to reprint" (Summary — items whose price or effective MRP changed after their last label
 * print; one click opens the existing label sheet with them) and the GST-cut tool (mark an item's MRP as printed for
 * an older GST rate; the default comes from the HSN master's dated rates).
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';
import { can } from '../../lib/access';
import { getTable } from '../../lib/storage';
import { TABLES, type StockItem } from '../../lib/inventory';
import { todayInput } from '../../lib/utils';
import { relabelQueue, setMrpBasis, suggestedBasis } from '../../lib/retail/rt-mrp-store';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const LabelSheetModal = lazy(() => import('../settings/LabelSheetModal').then((m) => ({ default: m.LabelSheetModal })));

export default function RelabelQueue({ version }: { version: number }) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => relabelQueue(), [version, tick]);
  if (!rows.length) return null;
  return (
    <div className={surface.cardBody} data-relabel-queue={rows.length}>
      <strong><Tags size={14} aria-hidden="true" /> {rtaT('relabelTitle', { n: rows.length })}</strong>{' '}
      <span className={controls.hint}>{rtaT('relabelHint')} {rows.slice(0, 5).map((r) => r.name).join(', ')}{rows.length > 5 ? ' …' : ''}</span>{' '}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(true)} data-relabel-open>{rtaT('relabelOpen')}</button>
      {open && (
        <Suspense fallback={null}>
          <LabelSheetModal open={open} onClose={() => { setOpen(false); setTick((t) => t + 1); }} onChanged={() => setTick((t) => t + 1)} preselected={new Set(rows.map((r) => r.key))} />
        </Suspense>
      )}
    </div>
  );
}

/** Mark an item's MRP as printed for an older GST rate (RT-A2 bulk action; it never raises an MRP). */
export function MrpBasisTool({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const items = useMemo(() => getTable<StockItem>(TABLES.items).filter((i) => i.track_stock), []);
  const [name, setName] = useState('');
  const [rate, setRate] = useState(0);
  const [until, setUntil] = useState('');
  if (!can('master.edit') || !items.length) return null;
  const pick = (n: string) => {
    setName(n);
    const it = items.find((i) => i.name === n);
    const b = it?.mrp_tax_basis ?? suggestedBasis(it?.hsn, todayInput());
    setRate(b?.rate ?? 0);
    setUntil(b?.until ?? '');
  };
  const apply = (clear = false) => {
    try {
      setMrpBasis(name, clear ? undefined : { rate, ...(until ? { until } : {}) });
      onDone(clear ? rtaT('saved') : rtaT('basisDone', { name }));
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return (
    <details className={surface.cardBody} data-mrp-basis>
      <summary>{rtaT('basisTitle')}</summary>
      <p className={controls.hint}>{rtaT('basisHint')}</p>
      <div className={controls.row} style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.5rem' }}>
        <label className={controls.field}>
          <span className={controls.label}>{rtaT('basisItem')}</span>
          <select className={controls.select} value={name} onChange={(e) => pick(e.target.value)} data-mrp-basis-item>
            <option value="">-</option>
            {items.map((i) => <option key={i.id} value={i.name}>{i.name}{i.mrp_tax_basis ? ` (${i.mrp_tax_basis.rate}%)` : ''}</option>)}
          </select>
        </label>
        <label className={controls.field} style={{ maxWidth: 120 }}>
          <span className={controls.label}>{rtaT('basisOld')}</span>
          <NumberInput className={controls.input} value={rate} onChange={setRate} data-mrp-basis-rate />
        </label>
        <label className={controls.field} style={{ maxWidth: 180 }}>
          <span className={controls.label}>{rtaT('basisUntil')}</span>
          <input type="date" className={controls.input} value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!name || !(rate > 0)} onClick={() => apply()} data-mrp-basis-apply>{rtaT('basisApply')}</button>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} disabled={!name} onClick={() => apply(true)}>{rtaT('basisClear')}</button>
      </div>
    </details>
  );
}
