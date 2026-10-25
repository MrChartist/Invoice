import { useMemo, useState } from 'react';
import { Pencil, Plus, Shuffle, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import {
  consumptionShortfalls, costSnapshot, previewVoucherCost, sjInput, stockJournalsDb, validateStockJournal,
} from '../../lib/manufacturing';
import { godownName, transfersDb, validateTransferShape } from '../../lib/godowns';
import { transferIssues } from '../../lib/stock-tracking';
import { MAIN_GODOWN_ID } from '../../types/stock';
import type { AdditionalCost, StockJournal } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import { LinesGrid } from './LinesGrid';
import { blankLine, type GridLine } from './context';
import { CostsGrid } from './CostsGrid';
import { CostSummary, VoucherList } from './shared';
import { qtyText, type MfgContext } from './context';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

/**
 * Stock Journal (Tally Alt+F7): source → destination for conversions and repacking. Godown
 * transfers use the same `stock_transfers` (STR) records as Inventory → Transfers, never a journal.
 */
export function StockJournalTab({ ctx }: { ctx: MfgContext }) {
  const [editing, setEditing] = useState<StockJournal | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StockJournal | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => stockJournalsDb.all(), [ctx.version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transfers = useMemo(() => transfersDb.all().map((t) => ({ ...t, number: t.transfer_number })), [ctx.version]);
  const byId = useMemo(() => new Map(ctx.items.map((i) => [i.id, i])), [ctx.items]);
  const lineText = (ls: { item_id: string; qty: number }[]) => ls.map((l) => `${byId.get(l.item_id)?.name ?? '?'} × ${qtyText(l.qty)}`).join(', ');

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{mfgT('transferHint')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {mfgT('newSj')}
          </button>
        )}
      </div>
      <VoucherList
        rows={rows}
        describe={(j) => `${lineText(j.consume)} → ${lineText(j.produce)}`}
        value={(j) => j.cost_snapshot?.finished}
        actions={ctx.canBooks ? (j) => (
          <>
            <button type="button" className={controls.btnIcon} aria-label={`${mfgT('edit')} ${j.number}`} onClick={() => setEditing(j)}><Pencil size={15} /></button>
            <button type="button" className={controls.btnDanger} aria-label={`${mfgT('delete')} ${j.number}`} onClick={() => setDeleting(j)}><Trash2 size={15} /></button>
          </>
        ) : undefined}
      />
      {transfers.length > 0 && (
        <>
          <p className={styles.section} style={{ margin: '1rem 0 0.5rem' }}>{mfgT('transferMode')}</p>
          <VoucherList rows={transfers} describe={(t) => `${godownName(ctx.godowns, t.from_godown)} → ${godownName(ctx.godowns, t.to_godown)}: ${lineText(t.lines)}`} />
        </>
      )}
      {editing && <SjModal ctx={ctx} journal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={mfgT('delete')} message={mfgT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={mfgT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            stockJournalsDb.remove(deleting.id);
            ctx.changed(mfgT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

const clean = (ls: GridLine[]) => ls.filter((l) => l.item_id).map((l) => ({ ...l, qty: num(l.qty) }));

function SjModal({ ctx, journal, onClose }: { ctx: MfgContext; journal: StockJournal | null; onClose: () => void }) {
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.track_serials).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const multi = ctx.godowns.length > 1;
  const [mode, setMode] = useState<'conversion' | 'transfer'>('conversion');
  const [date, setDate] = useState(journal?.date ?? todayInput());
  const [consume, setConsume] = useState<GridLine[]>(() => journal?.consume.map((l) => ({ ...l })) ?? [blankLine()]);
  const [produce, setProduce] = useState<GridLine[]>(() => journal?.produce.map((l) => ({ ...l })) ?? [blankLine()]);
  const [costs, setCosts] = useState<AdditionalCost[]>(() => journal?.costs ?? []);
  const [narration, setNarration] = useState(journal?.narration ?? '');
  const [from, setFrom] = useState(MAIN_GODOWN_ID);
  const [to, setTo] = useState(ctx.godowns.find((g) => g.id !== MAIN_GODOWN_ID)?.id ?? '');
  const [error, setError] = useState('');
  const anyBatch = tracked.some((i) => i.track_batches);

  const draft = useMemo((): StockJournal => ({
    id: journal?.id ?? '__draft__', number: journal?.number ?? '', date, consume: clean(consume), produce: clean(produce),
    costs: costs.filter((c) => num(c.value) > 0), narration: narration.trim() || undefined,
  }), [journal, date, consume, produce, costs, narration]);
  const preview = useMemo(() => {
    if (mode !== 'conversion' || !draft.consume.length || !draft.produce.length) return null;
    try {
      return costSnapshot(previewVoucherCost(ctx.inputs, sjInput(draft)), undefined, draft.produce.reduce((s, l) => s + l.qty, 0));
    } catch {
      return null;
    }
  }, [ctx.inputs, draft, mode]);
  const shortfalls = useMemo(() => (mode === 'conversion' && draft.consume.length ? consumptionShortfalls(draft.consume, date, ctx.inputs, journal?.id) : []), [mode, draft.consume, date, ctx.inputs, journal]);

  const submit = () => {
    try {
      if (mode === 'transfer') {
        const lines = clean(consume).map((l) => ({ id: l.id, item_id: l.item_id, qty: l.qty, ...(l.batch_no ? { batch_no: l.batch_no } : {}) }));
        const tr = { id: '', date, from_godown: from, to_godown: to, lines };
        const err = validateTransferShape(tr) || transferIssues(tr, ctx.inputs)[0] || '';
        if (err) return setError(err);
        const saved = transfersDb.save({ date, from_godown: from, to_godown: to, lines, notes: narration.trim() || undefined });
        onClose();
        ctx.changed(mfgT('saved', { number: saved.transfer_number }));
        return;
      }
      const err = validateStockJournal(draft, ctx.items);
      if (err) return setError(err);
      const { id: _id, number: _n, ...rest } = draft;
      void _id; void _n;
      const saved = stockJournalsDb.save({ ...rest, id: journal?.id, number: journal?.number }, ctx.items, ctx.inputs);
      onClose();
      ctx.changed(mfgT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const nextNo = mode === 'transfer' ? transfersDb.nextNumber(date) : stockJournalsDb.nextNumber(date);
  return (
    <Modal open onClose={onClose} size="xl" title={journal ? `${mfgT('tabSj')} ${journal.number}` : mfgT('newSj')}
      subtitle={journal ? mfgT('keyHint') : `${mfgT('nextNumber', { number: nextNo })} · ${mfgT('keyHint')}`}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{mfgT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}><Shuffle size={16} aria-hidden="true" /> {mfgT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        {!journal && (
          <div className={controls.segment} role="tablist" aria-label={mfgT('mode')}>
            {(['conversion', 'transfer'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => { setMode(m); setError(''); }}>
                {m === 'conversion' ? mfgT('conversionMode') : mfgT('transferMode')}
              </button>
            ))}
          </div>
        )}
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="sj-date">{mfgT('date')}</label>
            <input id="sj-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {mode === 'transfer' && multi && (
            <>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sj-from">{mfgT('fromGodown')}</label>
                <select id="sj-from" className={controls.select} value={from} onChange={(e) => setFrom(e.target.value)}>
                  {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sj-to">{mfgT('toGodown')}</label>
                <select id="sj-to" className={controls.select} value={to} onChange={(e) => setTo(e.target.value)}>
                  {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        {mode === 'transfer' ? (
          multi ? (
            <>
              <p className={styles.muted}>{mfgT('transferHint')}</p>
              <LinesGrid lines={consume} items={tracked} onChange={setConsume} opts={{ label: mfgT('transfer'), batch: anyBatch }} />
            </>
          ) : <p className={styles.notice}>{mfgT('needGodowns')}</p>
        ) : (
          <>
            <p className={styles.section}>{mfgT('source')}</p>
            <LinesGrid lines={consume} items={tracked} onChange={setConsume} opts={{ label: mfgT('source'), godowns: ctx.godowns, batch: anyBatch }} />
            <p className={styles.section}>{mfgT('destination')}</p>
            <LinesGrid lines={produce} items={tracked} onChange={setProduce} opts={{ label: mfgT('destination'), godowns: ctx.godowns, batch: anyBatch, valuation: true }} />
            <p className={styles.section}>{mfgT('additionalCosts')}</p>
            <CostsGrid costs={costs} onChange={setCosts} />
            {preview && <CostSummary s={preview} />}
            {shortfalls.length > 0 && <div className={styles.notice} role="status"><strong>{mfgT('shortfalls')}</strong><ul>{shortfalls.map((s) => <li key={s}>{s}</li>)}</ul></div>}
          </>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="sj-narr">{mfgT('narration')}</label>
          <input id="sj-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
