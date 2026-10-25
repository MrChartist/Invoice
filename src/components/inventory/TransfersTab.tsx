import { isStockDependencyError } from '../../lib/stock-timeline';
import { Suspense, lazy, useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId } from '../../lib/storage';
import { godownName, godownsDb, transfersDb, validateTransferShape } from '../../lib/godowns';
import { stockDb } from '../../lib/inventory';
import { useCreateOnTheFly } from '../masters/useCreateOnTheFly';
import { isAltC } from '../masters/useMasterKeys';
import { isPeriodLockedError } from '../../lib/period-lock';
import {
  batchOptions, blankTransferLine, computeTracking, serialsInStock, transferIssues, type TrackingMap,
} from '../../lib/stock-tracking';
import type { StockInputs, StockItem } from '../../lib/inventory';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer, type StockTransferLine } from '../../types/stock';
import { SerialPicker } from './SerialPicker';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';
import { loadBranches } from '../../lib/branch';
import { transferInvoiceOf, transferTaxPair } from '../../lib/branch-transfer';
import { localDb } from '../../lib/localDb';
import { branchT } from '../../i18n/areas/branch-books';

// WP-9: Sec 25(4) tax invoice + bill for a transfer between two GSTINs (lazy dialog).
const BranchTransferDialog = lazy(() => import('../branches/BranchTransferDialog'));

/** Stock transfer vouchers between godowns (6.10): list, create, delete. */
export function TransfersTab({ transfers, godowns, items, inputs, onChanged, onError }: {
  transfers: StockTransfer[];
  godowns: Godown[];
  items: StockItem[];
  /** Live stock inputs (transfers included), for availability checks. */
  inputs: StockInputs;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StockTransfer | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const sorted = useMemo(() => [...transfers].sort((a, b) => b.date.localeCompare(a.date) || b.transfer_number.localeCompare(a.transfer_number)), [transfers]);
  // Transfers between branches with different GSTINs, and the invoice already raised for each.
  const [taxFor, setTaxFor] = useState<StockTransfer | null>(null);
  const branches = useMemo(() => {
    try {
      return loadBranches();
    } catch {
      return [];
    }
  }, []);
  const raised = useMemo(() => {
    void transfers;
    if (!branches.some((b) => b.godown_id && b.gstin)) return null;
    return localDb.invoices.getAll();
  }, [branches, transfers]);
  const pairOf = (t: StockTransfer) => (raised ? transferTaxPair(t, branches, godowns) : null);

  return (
    <>
      <div className={styles.lookupHead} style={{ padding: '0 0 0.75rem', justifyContent: 'space-between' }}>
        <span className={styles.muted}>{invT('transfersNote')}</span>
        <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> {invT('newTransfer')}
        </button>
      </div>
      <table className={surface.table}>
        <thead>
          <tr><th>{invT('thNumber')}</th><th>{invT('thDate')}</th><th>{invT('thFromTo')}</th><th>{invT('thItems')}</th><th><span className={surface.srOnly}>{invT('thActions')}</span></th></tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id}>
              <td className={styles.mono}>{t.transfer_number}</td>
              <td>{formatDate(t.date)}</td>
              <td>{godownName(godowns, t.from_godown)} → {godownName(godowns, t.to_godown)}</td>
              <td>
                {t.lines.map((l) => `${byId.get(l.item_id)?.name ?? invT('deletedItem')} × ${l.qty}${l.batch_no ? ` (${l.batch_no})` : ''}`).join(', ')}
              </td>
              <td>
                {pairOf(t) && (() => {
                  const inv = transferInvoiceOf(t.id, raised ?? []);
                  return inv ? (
                    <span className={styles.muted}>{branchT('taxPairRaised', { number: inv.invoice_number })} </span>
                  ) : (
                    <button type="button" className={cn(controls.btnOutline, controls.btnSm)} title={branchT('taxPairNeeded')} onClick={() => setTaxFor(t)} data-testid={`bt-open-${t.id}`}>
                      {branchT('taxPair')}
                    </button>
                  );
                })()}
                <button type="button" className={controls.btnDanger} aria-label={invT('deleteNamed', { name: t.transfer_number })} onClick={() => setDeleting(t)}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={5} className={styles.muted}>{invT('noTransfers')}</td></tr>}
        </tbody>
      </table>

      {creating && (
        <TransferModal
          godowns={godowns}
          items={items.filter((i) => i.track_stock)}
          inputs={inputs}
          onClose={() => setCreating(false)}
          onSaved={(t) => {
            setCreating(false);
            onChanged(invT('transferSaved', { number: t.transfer_number }));
          }}
        />
      )}
      {taxFor && (() => {
        const pair = pairOf(taxFor);
        return pair ? (
          <Suspense fallback={null}>
            <BranchTransferDialog
              transfer={taxFor}
              from={pair.from}
              to={pair.to}
              items={items}
              onClose={() => setTaxFor(null)}
              onSaved={(msg) => {
                setTaxFor(null);
                onChanged(msg);
              }}
            />
          </Suspense>
        ) : null;
      })()}
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={invT('transferDeleteTitle')}
        message={invT('transferDeleteMsg', { number: deleting?.transfer_number ?? '', godown: deleting ? godownName(godowns, deleting.from_godown) : '' })}
        confirmLabel={invT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const del = (confirmStock: boolean): void => {
            try {
              transfersDb.remove(deleting.id, { confirmStock });
              onChanged(invT('transferDeleted', { number: deleting.transfer_number }));
            } catch (err) {
              if (isStockDependencyError(err) && err.confirmable && window.confirm(err.message)) return del(true);
              onError(isPeriodLockedError(err) || isStockDependencyError(err) ? (err as Error).message : invT('transferDeleteFailed'));
            }
          };
          del(false);
        }}
      />
    </>
  );
}

function TransferModal({ godowns: baseGodowns, items: baseItems, inputs, onClose, onSaved }: {
  godowns: Godown[];
  items: StockItem[];
  inputs: StockInputs;
  onClose: () => void;
  onSaved: (t: StockTransfer) => void;
}) {
  // Alt+C on the godown / item pickers creates the master on the fly (Tally parity).
  const fly = useCreateOnTheFly();
  const [added, setAdded] = useState<{ godowns: Godown[]; items: StockItem[] }>({ godowns: [], items: [] });
  const godowns = useMemo(() => [...baseGodowns, ...added.godowns], [baseGodowns, added.godowns]);
  const items = useMemo(() => [...baseItems, ...added.items], [baseItems, added.items]);
  const createGodown = (apply: (id: string) => void) => (e: KeyboardEvent<HTMLSelectElement>) => {
    if (!isAltC(e.nativeEvent)) return;
    e.preventDefault();
    void fly.open({ kind: 'godown' }).then((g) => {
      if (!g) return;
      const row = godownsDb.list().find((x) => x.id === g.id);
      if (row) setAdded((a) => ({ ...a, godowns: [...a.godowns, row] }));
      apply(g.id);
    });
  };
  const createItem = (lineId: string) => (e: KeyboardEvent<HTMLSelectElement>) => {
    if (!isAltC(e.nativeEvent)) return;
    e.preventDefault();
    void fly.open({ kind: 'stockItem' }).then((it) => {
      if (!it) return;
      const row = stockDb.items().find((x) => x.id === it.id);
      if (row?.track_stock) setAdded((a) => ({ ...a, items: [...a.items, row] }));
      if (row?.track_stock) patch(lineId, { item_id: row.id, batch_no: undefined, serials: undefined });
    });
  };
  const [date, setDate] = useState(todayInput());
  const [from, setFrom] = useState(MAIN_GODOWN_ID);
  const [to, setTo] = useState(baseGodowns.find((g) => g.id !== MAIN_GODOWN_ID)?.id ?? '');
  const [lines, setLines] = useState<StockTransferLine[]>([blankTransferLine(generateId())]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const tracking: TrackingMap = useMemo(() => computeTracking({ ...inputs, asOf: date || undefined }), [inputs, date]);
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);

  const patch = (id: string, change: Partial<StockTransferLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const submit = () => {
    const draft = { id: '', date, from_godown: from, to_godown: to, lines: lines.filter((l) => l.item_id) };
    const err = validateTransferShape(draft) || transferIssues(draft, inputs)[0] || '';
    if (err) return setError(err);
    try {
      onSaved(transfersDb.save({ date, from_godown: from, to_godown: to, lines: draft.lines, notes: notes.trim() || undefined }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={invT('newStockTransfer')}
      subtitle={invT('transferSub', { number: transfersDb.nextNumber(date) })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{invT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            <ArrowLeftRight size={16} aria-hidden="true" /> {invT('saveTransfer')}
          </button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="tr-date">{invT('date')}</label>
            <input id="tr-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="tr-from">{invT('fromGodown')}</label>
            <select id="tr-from" className={controls.select} value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={createGodown(setFrom)} aria-keyshortcuts="Alt+C">
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="tr-to">{invT('toGodown')}</label>
            <select id="tr-to" className={controls.select} value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={createGodown(setTo)} aria-keyshortcuts="Alt+C">
              <option value="">{invT('choose')}</option>
              {godowns.filter((g) => g.id !== from).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        {lines.map((l, i) => {
          const item = items.find((x) => x.id === l.item_id);
          const t = item ? tracking.get(item.id) : undefined;
          const available = t ? (t.byGodown[from] ?? 0) : 0;
          return (
            <div key={l.id} className={styles.serialBox}>
              <div className={styles.lineRow}>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`tr-item-${l.id}`}>{invT('itemN', { n: i + 1 })}</label>
                  <select
                    id={`tr-item-${l.id}`}
                    className={controls.select}
                    value={l.item_id}
                    onChange={(e) => patch(l.id, { item_id: e.target.value, batch_no: undefined, serials: undefined })}
                    onKeyDown={createItem(l.id)}
                    aria-keyshortcuts="Alt+C"
                  >
                    <option value="">{invT('chooseItem')}</option>
                    {sortedItems.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  {item && <span className={controls.hint}>{invT('inSource', { qty: available, unit: item.unit })}</span>}
                </div>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`tr-qty-${l.id}`}>{invT('quantity')}</label>
                  <input
                    id={`tr-qty-${l.id}`}
                    className={`${controls.input} ${controls.inputNumeric}`}
                    inputMode="decimal"
                    value={item?.track_serials ? String((l.serials ?? []).length) : String(l.qty || '')}
                    readOnly={!!item?.track_serials}
                    onChange={(e) => patch(l.id, { qty: num(e.target.value) })}
                  />
                </div>
                {item?.track_batches ? (
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor={`tr-batch-${l.id}`}>{invT('batch')}</label>
                    <select id={`tr-batch-${l.id}`} className={controls.select} value={l.batch_no ?? ''} onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })}>
                      <option value="">{invT('choose')}</option>
                      {batchOptions(t, date, from).map((b) => (
                        <option key={b.batch} value={b.batch}>{b.batch}{b.expiry ? ` · ${invT('exp', { date: b.expiry })}` : ''} · {b.qty}{b.expired ? ` · ${invT('expired')}` : ''}</option>
                      ))}
                    </select>
                  </div>
                ) : <span />}
                <button type="button" className={controls.btnDanger} aria-label={invT('removeLine', { n: i + 1 })} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                  <Trash2 size={15} />
                </button>
              </div>
              {item?.track_serials && (
                <SerialPicker
                  label={invT('serialsForItem', { n: i + 1 })}
                  options={serialsInStock(t, from)}
                  value={l.serials ?? []}
                  onChange={(next) => patch(l.id, { serials: next.length ? next : undefined, qty: next.length })}
                />
              )}
            </div>
          );
        })}
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, blankTransferLine(generateId())])}>
          <Plus size={14} aria-hidden="true" /> {invT('addLine')}
        </button>

        <div className={controls.field}>
          <label className={controls.label} htmlFor="tr-notes">{invT('notes')}</label>
          <input id="tr-notes" className={controls.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={invT('notesPh')} />
        </div>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
      {fly.node}
    </Modal>
  );
}
