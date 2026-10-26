/**
 * TR-B in the purchase bill / GRN modal (lazy; commodity / agency pack): the bags / weight rows of weighed lines,
 * the purchase-side bill charges (market fee paid on a farmer's purchase …) and the broker.
 */
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { tbT } from '../../i18n/areas/trade-r8b';
import { generateId } from '../../lib/storage';
import { vendorsDb } from '../../lib/vendors';
import { blankWeight, wtHolds, wtQuantity } from '../../lib/trade/tr-weight';
import type { PurchaseLine, Vendor } from '../../types/purchases';
import { ChargeChips } from './ChargesStrip';
import { WeightFields } from './LineWeightRow';
import { useChargeLines, weighItem } from './tr-b-editor';
import BrokerPicker from './BrokerPicker';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export default function BillTradePanel({ lines, onLines, vendor, broker, onBroker, isNew }: {
  lines: PurchaseLine[];
  onLines: (next: PurchaseLine[]) => void;
  vendor?: Vendor;
  broker?: string;
  onBroker: (id: string | undefined) => void;
  isNew: boolean;
}) {
  useT();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const ch = useChargeLines<PurchaseLine>(lines, 'purchase', onLines, ({ description: _d, ...c }, prev) => ({ ...(prev ?? { id: generateId() }), ...c }), isNew);
  const set = (id: string, p: Partial<PurchaseLine>) => onLines(lines.map((l) => (l.id === id ? { ...l, ...p } : l)));
  // A quantity typed over a weighing makes the line manual.
  const stale = lines.filter((l) => l.wt && !wtHolds(l)).map((l) => l.id).join();
  useEffect(() => {
    if (stale) onLines(lines.map((l) => (l.wt && !wtHolds(l) ? { ...l, wt: undefined } : l)));
  }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps
  // The supplier's default broker fills an empty broker.
  useEffect(() => {
    if (!broker && vendor?.broker_id) onBroker(vendor.broker_id);
  }, [vendor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={own.stack} data-r8b-bill>
      {lines.filter((l) => !l.charge_head_id && (l.wt || weighItem(l.name))).map((l) =>
        l.wt || open.has(l.id) ? (
          <div key={l.id}>
            <span className={controls.label}>{l.name}</span>
            <WeightFields
              wt={l.wt ?? blankWeight()}
              unit={l.unit}
              onChange={(wt) => { const q = wtQuantity(wt, l.unit); set(l.id, q === null ? { wt } : { wt, quantity: q }); }}
              onClear={() => { setOpen((s) => { const n = new Set(s); n.delete(l.id); return n; }); set(l.id, { wt: undefined }); }}
            />
          </div>
        ) : (
          <button key={l.id} type="button" className={controls.btnGhost} onClick={() => setOpen((s) => new Set(s).add(l.id))} data-weigh>{tbT('weigh')} · {l.name}</button>
        ),
      )}
      <ChargeChips {...ch} />
      <BrokerPicker value={broker} onChange={onBroker} onRemember={vendor ? (b) => vendorsDb.save({ ...vendor, broker_id: b }) : undefined} />
    </div>
  );
}
