import { useMemo, useState } from 'react';
import { ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId } from '../../lib/storage';
import {
  physicalDrift, physicalLines, physicalStockDb, physicalSummary, validatePhysical, type PhysicalDraftLine,
} from '../../lib/manufacturing';
import { computeTracking } from '../../lib/stock-tracking';
import { godownName } from '../../lib/godowns';
import type { PhysicalStockVoucher } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import { VoucherList } from './shared';
import { money, qtyText, type MfgContext } from './context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

/** Physical Stock voucher (Tally Ctrl+F7): counted vs book on a date; the difference is posted. */
export function PhysicalStockTab({ ctx }: { ctx: MfgContext }) {
  const [editing, setEditing] = useState<PhysicalStockVoucher | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PhysicalStockVoucher | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => physicalStockDb.all(), [ctx.version]);
  const drift = useMemo(() => new Map(rows.map((v) => [v.id, physicalDrift(v, ctx.inputs).length])), [rows, ctx.inputs]);

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{mfgT('tabPhysical')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {mfgT('newPhysical')}
          </button>
        )}
      </div>
      <VoucherList
        rows={rows}
        describe={(v) => {
          const s = physicalSummary(v.lines);
          const n = drift.get(v.id) ?? 0;
          return (
            <>
              {`${v.lines.length} · ${mfgT('shortage')} ${qtyText(s.shortageQty)} (${money(s.shortageValue)}) · ${mfgT('excess')} ${qtyText(s.excessQty)} (${money(s.excessValue)})`}
              {n > 0 && <div className={styles.loss}>{mfgT('drift', { n })}</div>}
            </>
          );
        }}
        actions={ctx.canBooks ? (v) => (
          <>
            <button type="button" className={controls.btnIcon} aria-label={`${mfgT('edit')} ${v.number}`} onClick={() => setEditing(v)}><Pencil size={15} /></button>
            <button type="button" className={controls.btnDanger} aria-label={`${mfgT('delete')} ${v.number}`} onClick={() => setDeleting(v)}><Trash2 size={15} /></button>
          </>
        ) : undefined}
      />
      {editing && <PhysicalModal ctx={ctx} voucher={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={mfgT('delete')} message={mfgT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={mfgT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            physicalStockDb.remove(deleting.id);
            ctx.changed(mfgT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function PhysicalModal({ ctx, voucher, onClose }: { ctx: MfgContext; voucher: PhysicalStockVoucher | null; onClose: () => void }) {
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.track_serials).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const multi = ctx.godowns.length > 1;
  const anyBatch = tracked.some((i) => i.track_batches);
  const [date, setDate] = useState(voucher?.date ?? todayInput());
  const [lines, setLines] = useState<PhysicalDraftLine[]>(() => voucher?.lines.map((l) => ({ id: l.id, item_id: l.item_id, godown_id: l.godown_id, batch_no: l.batch_no, counted: l.counted })) ?? []);
  const [narration, setNarration] = useState(voucher?.narration ?? '');
  const [error, setError] = useState('');
  const computed = useMemo(() => {
    try {
      return physicalLines(lines, date, ctx.inputs, voucher?.id);
    } catch {
      return [];
    }
  }, [lines, date, ctx.inputs, voucher]);
  const calc = new Map(computed.map((l) => [l.id, l]));
  const s = physicalSummary(computed);
  const patch = (id: string, change: Partial<PhysicalDraftLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const loadAll = () => {
    const tracking = computeTracking({ ...ctx.inputs, asOf: date || undefined, vouchers: (ctx.inputs.vouchers ?? []).filter((v) => v.id !== voucher?.id) });
    const next: PhysicalDraftLine[] = [];
    for (const it of tracked) {
      const t = tracking.get(it.id);
      if (it.track_batches && t?.batches.some((b) => b.batch && b.qty > 0)) {
        for (const b of t.batches) {
          if (!b.batch) continue;
          for (const [g, q] of Object.entries(multi ? b.byGodown : { '': b.qty })) {
            if (q > 0) next.push({ id: generateId(), item_id: it.id, godown_id: g || undefined, batch_no: b.batch, counted: q });
          }
        }
      } else if (multi) {
        const gs = Object.entries(t?.byGodown ?? {}).filter(([, q]) => q !== 0);
        if (gs.length === 0) next.push({ id: generateId(), item_id: it.id, counted: 0 });
        for (const [g, q] of gs) next.push({ id: generateId(), item_id: it.id, godown_id: g, counted: Math.max(q, 0) });
      } else next.push({ id: generateId(), item_id: it.id, counted: Math.max(t?.qty ?? 0, 0) });
    }
    setLines(next);
  };

  const submit = () => {
    const err = validatePhysical({ date, lines }, ctx.items);
    if (err) return setError(err);
    try {
      const saved = physicalStockDb.save({ id: voucher?.id, number: voucher?.number, date, lines, narration: narration.trim() || undefined }, ctx.items, ctx.inputs);
      onClose();
      ctx.changed(mfgT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={voucher ? `${mfgT('tabPhysical')} ${voucher.number}` : mfgT('newPhysical')}
      subtitle={voucher ? undefined : mfgT('nextNumber', { number: physicalStockDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{mfgT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}><ClipboardCheck size={16} aria-hidden="true" /> {mfgT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="phy-date">{mfgT('date')}</label>
            <input id="phy-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={loadAll}>{mfgT('loadAll')}</button>{' '}
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setLines((ls) => [...ls, { id: generateId(), item_id: '', counted: 0 }])}>
            <Plus size={14} aria-hidden="true" /> {mfgT('addLine')}
          </button>
        </div>
        <div className={styles.wrap}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{mfgT('item')}</th>{multi && <th>{mfgT('godown')}</th>}{anyBatch && <th>{mfgT('batch')}</th>}
                <th className={styles.num}>{mfgT('book')}</th><th className={styles.num}>{mfgT('counted')}</th>
                <th className={styles.num}>{mfgT('difference')}</th><th className={styles.num}>{mfgT('value')}</th>
                <th><span className={surface.srOnly}>{mfgT('actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = calc.get(l.id);
                const item = tracked.find((x) => x.id === l.item_id);
                const n = i + 1;
                return (
                  <tr key={l.id}>
                    <td>
                      <select className={controls.select} aria-label={mfgT('lineItem', { n })} value={l.item_id} onChange={(e) => patch(l.id, { item_id: e.target.value })}>
                        <option value="">{mfgT('choose')}</option>
                        {tracked.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                    </td>
                    {multi && (
                      <td>
                        <select className={controls.select} aria-label={`${n} ${mfgT('godown')}`} value={l.godown_id ?? ''} onChange={(e) => patch(l.id, { godown_id: e.target.value || undefined })}>
                          <option value="">—</option>
                          {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </td>
                    )}
                    {anyBatch && (
                      <td>{item?.track_batches ? <input className={controls.input} aria-label={`${n} ${mfgT('batch')}`} value={l.batch_no ?? ''} onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })} /> : '—'}</td>
                    )}
                    <td className={styles.num}>{c ? qtyText(c.book_qty) : '—'}</td>
                    <td>
                      <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${mfgT('counted')} ${n}${item ? ` ${item.name}${l.godown_id ? ` ${godownName(ctx.godowns, l.godown_id)}` : ''}` : ''}`}
                        value={String(l.counted)} onChange={(e) => patch(l.id, { counted: num(e.target.value) })} />
                    </td>
                    <td className={cn(styles.num, c && c.diff < 0 ? styles.loss : c && c.diff > 0 ? styles.profit : undefined)}>{c ? qtyText(c.diff) : '—'}</td>
                    <td className={styles.num}>{c ? money(Math.abs(c.diff) * num(c.rate)) : '—'}</td>
                    <td><button type="button" className={controls.btnIcon} aria-label={mfgT('removeLine', { n })} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <section className={styles.summary} aria-label={mfgT('difference')}>
          <div className={styles.cell}><span>{mfgT('shortage')}</span><strong className={styles.loss}>{qtyText(s.shortageQty)} · {money(s.shortageValue)}</strong></div>
          <div className={styles.cell}><span>{mfgT('excess')}</span><strong className={styles.profit}>{qtyText(s.excessQty)} · {money(s.excessValue)}</strong></div>
        </section>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="phy-narr">{mfgT('narration')}</label>
          <input id="phy-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
