import { useMemo, useState } from 'react';
import { Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import {
  allocateFefo, bomsDb, bomsForItem, consumptionShortfalls, costSnapshot, explodeBom, manufacturingDb, mfgInput,
  previewVoucherCost, validateManufacturing,
} from '../../lib/manufacturing';
import { computeTracking } from '../../lib/stock-tracking';
import type { AdditionalCost, ManufacturingVoucher } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import { LinesGrid } from './LinesGrid';
import type { GridLine } from './context';
import { CostsGrid } from './CostsGrid';
import { CostSummary, VoucherList } from './shared';
import { qtyText, type MfgContext } from './context';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

/** Manufacturing Journal (Tally Alt+F7): finished item + BOM + quantity → components, costs, value. */
export function MfgJournalTab({ ctx }: { ctx: MfgContext }) {
  const [editing, setEditing] = useState<ManufacturingVoucher | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ManufacturingVoucher | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => manufacturingDb.all(), [ctx.version]);
  const byId = useMemo(() => new Map(ctx.items.map((i) => [i.id, i])), [ctx.items]);

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{mfgT('ledgerNote')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {mfgT('newMfg')}
          </button>
        )}
      </div>
      <VoucherList
        rows={rows}
        describe={(v) => `${qtyText(v.qty)} ${byId.get(v.item_id)?.unit ?? ''} ${byId.get(v.item_id)?.name ?? '?'} ← ${v.components.map((c) => `${byId.get(c.item_id)?.name ?? '?'} × ${qtyText(c.qty)}`).join(', ')}`}
        value={(v) => v.cost_snapshot?.finished}
        actions={ctx.canBooks ? (v) => (
          <>
            <button type="button" className={controls.btnIcon} aria-label={`${mfgT('edit')} ${v.number}`} onClick={() => setEditing(v)}><Pencil size={15} /></button>
            <button type="button" className={controls.btnDanger} aria-label={`${mfgT('delete')} ${v.number}`} onClick={() => setDeleting(v)}><Trash2 size={15} /></button>
          </>
        ) : undefined}
      />
      {editing && <MfgModal ctx={ctx} voucher={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={mfgT('delete')} message={mfgT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={mfgT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            manufacturingDb.remove(deleting.id);
            ctx.changed(mfgT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function MfgModal({ ctx, voucher, onClose }: { ctx: MfgContext; voucher: ManufacturingVoucher | null; onClose: () => void }) {
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.track_serials).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const boms = useMemo(() => bomsDb.all(), []);
  const [date, setDate] = useState(voucher?.date ?? todayInput());
  const [itemId, setItemId] = useState(voucher?.item_id ?? '');
  const [bomId, setBomId] = useState(voucher?.bom_id ?? '');
  const [qty, setQty] = useState(String(voucher?.qty ?? 1));
  const [godown, setGodown] = useState(voucher?.godown_id ?? '');
  const [batch, setBatch] = useState(voucher?.batch_no ?? '');
  const [expiry, setExpiry] = useState(voucher?.expiry_date ?? '');
  const [components, setComponents] = useState<GridLine[]>(() => voucher?.components.map((c) => ({ ...c })) ?? []);
  const [outputs, setOutputs] = useState<GridLine[]>(() => (voucher?.outputs ?? []).map((o) => ({ ...o })));
  const [costs, setCosts] = useState<AdditionalCost[]>(() => voucher?.costs ?? []);
  const [narration, setNarration] = useState(voucher?.narration ?? '');
  const [error, setError] = useState('');
  const item = ctx.items.find((i) => i.id === itemId);
  const itemBoms = bomsForItem(boms, itemId);
  const anyBatch = tracked.some((i) => i.track_batches);
  const multi = ctx.godowns.length > 1;

  const fill = (nextItem: string, nextBom: string, nextQty: string, nextDate = date) => {
    const bom = boms.find((b) => b.id === nextBom && b.item_id === nextItem);
    if (!bom || !(num(nextQty) > 0)) return;
    const exp = explodeBom(bom, num(nextQty));
    const tracking = computeTracking({ ...ctx.inputs, asOf: nextDate || undefined, vouchers: (ctx.inputs.vouchers ?? []).filter((v) => v.id !== voucher?.id) });
    setComponents(allocateFefo(exp.components.map(({ base: _b, scrap: _s, ...l }) => { void _b; void _s; return l; }), ctx.items, tracking, nextDate));
    setOutputs(exp.outputs);
  };
  const pickItem = (id: string) => {
    setItemId(id);
    const def = bomsForItem(boms, id)[0];
    setBomId(def?.id ?? '');
    if (def) fill(id, def.id, qty);
    else {
      setComponents([]);
      setOutputs([]);
    }
  };

  const draft = useMemo((): ManufacturingVoucher => ({
    id: voucher?.id ?? '__draft__', number: voucher?.number ?? '', date, item_id: itemId, bom_id: bomId || undefined, qty: num(qty),
    godown_id: godown || undefined, batch_no: batch.trim() || undefined, expiry_date: expiry || undefined,
    mfg_date: batch.trim() ? date : undefined,
    components: components.filter((c) => c.item_id).map((c) => ({ id: c.id, item_id: c.item_id, qty: num(c.qty), godown_id: c.godown_id, batch_no: c.batch_no })),
    outputs: outputs.filter((o) => o.item_id).map((o) => ({ ...o, qty: num(o.qty), kind: o.kind ?? 'by_product' })),
    costs: costs.filter((c) => num(c.value) > 0), narration: narration.trim() || undefined,
  }), [voucher, date, itemId, bomId, qty, godown, batch, expiry, components, outputs, costs, narration]);

  const preview = useMemo(() => {
    if (!itemId || !(draft.qty > 0) || draft.components.length === 0) return null;
    try {
      return costSnapshot(previewVoucherCost(ctx.inputs, mfgInput(draft)), itemId, draft.qty);
    } catch {
      return null;
    }
  }, [ctx.inputs, draft, itemId]);
  const shortfalls = useMemo(() => (draft.components.length ? consumptionShortfalls(draft.components, date, ctx.inputs, voucher?.id) : []), [draft.components, date, ctx.inputs, voucher]);

  const submit = () => {
    const err = validateManufacturing(draft, ctx.items);
    if (err) return setError(err);
    try {
      const { id: _id, number: _n, ...rest } = draft;
      void _id; void _n;
      const saved = manufacturingDb.save({ ...rest, id: voucher?.id, number: voucher?.number }, ctx.items, ctx.inputs);
      onClose();
      ctx.changed(mfgT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={voucher ? `${mfgT('tabMfg')} ${voucher.number}` : mfgT('newMfg')}
      subtitle={voucher ? mfgT('keyHint') : `${mfgT('nextNumber', { number: manufacturingDb.nextNumber(date) })} · ${mfgT('keyHint')}`}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{mfgT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}><Factory size={16} aria-hidden="true" /> {mfgT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="mfg-date">{mfgT('date')}</label>
            <input id="mfg-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="mfg-item">{mfgT('finished')}</label>
            <select id="mfg-item" className={controls.select} value={itemId} onChange={(e) => pickItem(e.target.value)} autoFocus>
              <option value="">{mfgT('choose')}</option>
              {tracked.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="mfg-bom">{mfgT('bom')}</label>
            <select id="mfg-bom" className={controls.select} value={bomId} onChange={(e) => { setBomId(e.target.value); fill(itemId, e.target.value, qty); }}>
              <option value="">{mfgT('none')}</option>
              {itemBoms.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ` (${mfgT('defaultTag')})` : ''}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="mfg-qty">{mfgT('qtyToMake')}{item ? ` (${item.unit})` : ''}</label>
            <input id="mfg-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty}
              onChange={(e) => setQty(e.target.value)} onBlur={() => bomId && fill(itemId, bomId, qty)} />
          </div>
          {multi && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="mfg-gd">{mfgT('godown')}</label>
              <select id="mfg-gd" className={controls.select} value={godown} onChange={(e) => setGodown(e.target.value)}>
                <option value="">—</option>
                {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {item?.track_batches && (
            <>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="mfg-batch">{mfgT('batch')}</label>
                <input id="mfg-batch" className={controls.input} value={batch} onChange={(e) => setBatch(e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="mfg-exp">{mfgT('expiry')}</label>
                <input id="mfg-exp" type="date" className={controls.input} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </div>
            </>
          )}
        </div>
        {bomId && (
          <div><button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => fill(itemId, bomId, qty)}>{mfgT('fillFromBom')}</button></div>
        )}
        <p className={styles.section}>{mfgT('components')}</p>
        <LinesGrid lines={components} items={tracked.filter((i) => i.id !== itemId)} onChange={setComponents} opts={{ label: mfgT('component'), godowns: ctx.godowns, batch: anyBatch }} />
        <p className={styles.section}>{mfgT('outputs')}</p>
        <LinesGrid lines={outputs} items={tracked.filter((i) => i.id !== itemId)} onChange={setOutputs} opts={{ label: mfgT('byProduct'), outputs: true, godowns: ctx.godowns, batch: anyBatch }} />
        <p className={styles.section}>{mfgT('additionalCosts')}</p>
        <CostsGrid costs={costs} onChange={setCosts} />
        {preview && <CostSummary s={preview} />}
        {shortfalls.length > 0 && (
          <div className={styles.notice} role="status"><strong>{mfgT('shortfalls')}</strong><ul>{shortfalls.map((s) => <li key={s}>{s}</li>)}</ul></div>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mfg-narr">{mfgT('narration')}</label>
          <input id="mfg-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

