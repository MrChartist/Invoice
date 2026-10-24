import { useId, useState } from 'react';
import { Modal } from '../ui/Modal';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { makeAdjustment, type StockMove, type StockPosition } from '../../lib/inventory';
import { batchOptions, duplicateSerials, parseSerials, serialsInStock, type ItemTracking } from '../../lib/stock-tracking';
import { MAIN_GODOWN_ID, type Godown } from '../../types/stock';
import { SerialPicker } from './SerialPicker';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

const REASONS = ['Stocktake correction', 'Damaged / expired', 'Lost / theft', 'Found stock', 'Internal use', 'Other'];

export interface AdjustModalProps {
  open: boolean;
  position: StockPosition | null;
  onSave: (move: StockMove) => void;
  onClose: () => void;
  /** Batch / serial / godown state of the item (6.6 / 6.10 / 6.11). */
  tracking?: ItemTracking;
  /** Godowns, Main first; the picker shows only when there is more than one. */
  godowns?: Godown[];
  defaultGodown?: string;
}

/** Mounts fresh each time it opens so the form always starts blank. */
export function AdjustModal(props: AdjustModalProps) {
  if (!props.open || !props.position) return null;
  return <AdjustForm key={props.position.item.id} {...props} position={props.position} />;
}

function AdjustForm({ open, position, onSave, onClose, tracking, godowns = [], defaultGodown }: AdjustModalProps & { position: StockPosition }) {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayInput());
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [godown, setGodown] = useState(defaultGodown || MAIN_GODOWN_ID);
  const [batch, setBatch] = useState('');
  const [mfg, setMfg] = useState('');
  const [expiry, setExpiry] = useState('');
  const [serialText, setSerialText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const uid = useId();

  const { item } = position;
  const multi = godowns.length > 1;
  const byBatch = !!item.track_batches;
  const bySerial = !!item.track_serials;
  const addSerials = bySerial && direction === 'add' ? parseSerials(serialText) : [];
  // Removing serial-tracked stock: the quantity is the serials ticked.
  const q = bySerial && direction === 'remove' ? picked.length : num(qty);
  const after = position.qty + (direction === 'add' ? q : -q);
  const qtyError = q <= 0 ? (bySerial && direction === 'remove' ? 'Tick the serials to remove.' : 'Enter a quantity greater than zero.') : '';
  const dateError = !date ? 'Choose a date.' : '';
  const where = multi ? godown : undefined;
  const removable = byBatch && direction === 'remove' ? batchOptions(tracking, date, where) : [];
  const dups = duplicateSerials(addSerials);
  const trackError =
    bySerial && direction === 'add' && addSerials.length !== q ? `List one serial per unit (${addSerials.length} listed for ${q}).`
    : dups.length ? `Serial ${dups[0]} is listed twice.`
    : bySerial && direction === 'add' && addSerials.some((s) => tracking?.serials.some((x) => x.inStock && x.serial.toUpperCase() === s.toUpperCase()))
      ? 'One of these serials is already in stock.'
    : byBatch && direction === 'remove' && removable.length > 0 && !batch ? 'Choose the batch to remove.'
    : '';

  const submit = () => {
    setTouched(true);
    if (qtyError || dateError || trackError) return;
    const move = makeAdjustment({
      item_id: item.id, date, direction, qty: q, rate: direction === 'add' ? num(rate) : 0,
      reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
    });
    onSave({
      ...move,
      ...(multi && godown !== MAIN_GODOWN_ID ? { godown_id: godown } : {}),
      ...(byBatch && batch.trim() ? { batch_no: batch.trim() } : {}),
      ...(byBatch && direction === 'add' && mfg ? { mfg_date: mfg } : {}),
      ...(byBatch && direction === 'add' && expiry ? { expiry_date: expiry } : {}),
      ...(bySerial ? { serials: direction === 'add' ? addSerials : picked } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Adjust stock"
      subtitle={`${item.name} · currently ${position.qty} ${item.unit}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>Record adjustment</button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className={controls.segment} role="group" aria-label="Adjustment direction">
          <button type="button" className={direction === 'add' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={direction === 'add'} onClick={() => setDirection('add')}>Add stock</button>
          <button type="button" className={direction === 'remove' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={direction === 'remove'} onClick={() => setDirection('remove')}>Remove stock</button>
        </div>

        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-q`}>Quantity ({item.unit}) *</label>
            <input
              id={`${uid}-q`} className={`${controls.input} ${controls.inputNumeric} ${touched && qtyError ? controls.inputInvalid : ''}`}
              inputMode="decimal" value={bySerial && direction === 'remove' ? String(q) : qty} onChange={(e) => setQty(e.target.value)} autoFocus
              aria-invalid={touched && !!qtyError} readOnly={bySerial && direction === 'remove'}
            />
            {touched && qtyError && <span className={controls.error} role="alert">{qtyError}</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-d`}>Date *</label>
            <input id={`${uid}-d`} type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {multi && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-g`}>Godown</label>
            <select id={`${uid}-g`} className={controls.select} value={godown} onChange={(e) => { setGodown(e.target.value); setPicked([]); setBatch(''); }}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        {byBatch && direction === 'add' && (
          <div className={controls.row3}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-b`}>Batch no.</label>
              <input id={`${uid}-b`} className={controls.input} value={batch} onChange={(e) => setBatch(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-mfg`}>MFG date</label>
              <input id={`${uid}-mfg`} type="date" className={controls.input} value={mfg} onChange={(e) => setMfg(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-exp`}>Expiry date</label>
              <input id={`${uid}-exp`} type="date" className={controls.input} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          </div>
        )}
        {byBatch && direction === 'remove' && removable.length > 0 && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-rb`}>Batch</label>
            <select id={`${uid}-rb`} className={controls.select} value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">Choose…</option>
              {removable.map((b) => (
                <option key={b.batch} value={b.batch}>
                  {b.batch}{b.expiry ? ` · exp ${b.expiry}` : ''} · {b.qty} {item.unit}{b.expired ? ' · EXPIRED' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {bySerial && direction === 'add' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sn`}>Serial / IMEI numbers (one per line)</label>
            <textarea id={`${uid}-sn`} className={controls.textarea} rows={3} value={serialText} onChange={(e) => setSerialText(e.target.value)} />
          </div>
        )}
        {bySerial && direction === 'remove' && (
          <SerialPicker label="Serials to remove" options={serialsInStock(tracking, where)} value={picked} onChange={setPicked} />
        )}
        {touched && trackError && <span className={controls.error} role="alert">{trackError}</span>}

        {direction === 'add' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-r`}>Unit cost</label>
            <input id={`${uid}-r`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={`Blank = current average (${position.avgCost})`} />
          </div>
        )}

        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-why`}>Reason</label>
          <select id={`${uid}-why`} className={controls.select} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-n`}>Note</label>
          <input id={`${uid}-n`} className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {q > 0 && (
          <div className={`${styles.notice} ${after < 0 ? styles.noticeDanger : ''}`} role="status">
            After this adjustment: <strong>{Math.round(after * 1000) / 1000} {item.unit}</strong>
            {after < 0 && ' (negative stock)'}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
