import { useId, useState } from 'react';
import { Modal } from '../ui/Modal';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { makeAdjustment, type StockMove, type StockPosition } from '../../lib/inventory';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

const REASONS = ['Stocktake correction', 'Damaged / expired', 'Lost / theft', 'Found stock', 'Internal use', 'Other'];

export interface AdjustModalProps {
  open: boolean;
  position: StockPosition | null;
  onSave: (move: StockMove) => void;
  onClose: () => void;
}

/** Mounts fresh each time it opens so the form always starts blank. */
export function AdjustModal(props: AdjustModalProps) {
  if (!props.open || !props.position) return null;
  return <AdjustForm key={props.position.item.id} {...props} position={props.position} />;
}

function AdjustForm({ open, position, onSave, onClose }: AdjustModalProps & { position: StockPosition }) {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayInput());
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const uid = useId();

  const { item } = position;
  const q = num(qty);
  const after = position.qty + (direction === 'add' ? q : -q);
  const qtyError = q <= 0 ? 'Enter a quantity greater than zero.' : '';
  const dateError = !date ? 'Choose a date.' : '';

  const submit = () => {
    setTouched(true);
    if (qtyError || dateError) return;
    onSave(
      makeAdjustment({
        item_id: item.id, date, direction, qty: q, rate: direction === 'add' ? num(rate) : 0,
        reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
      }),
    );
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
              inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus aria-invalid={touched && !!qtyError}
            />
            {touched && qtyError && <span className={controls.error} role="alert">{qtyError}</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-d`}>Date *</label>
            <input id={`${uid}-d`} type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

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
