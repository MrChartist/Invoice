import { useId, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { makeAdjustment, type StockMove, type StockPosition } from '../../lib/inventory';
import { batchOptions, duplicateSerials, parseSerials, serialsInStock, type ItemTracking } from '../../lib/stock-tracking';
import { MAIN_GODOWN_ID, type Godown } from '../../types/stock';
import { SerialPicker } from './SerialPicker';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import { unitT } from '../../i18n/areas/units';
import { cleanAltUnits, factorFor, roundTypedQty, unitChoices, unitsDb } from '../../lib/units';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

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
  useT(); // re-render on a language switch (5.4)
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
  const [unit, setUnit] = useState(position.item.unit);
  const units = useMemo(() => unitsDb.stored(), []);
  const uid = useId();

  const { item } = position;
  const multi = godowns.length > 1;
  const byBatch = !!item.track_batches;
  const bySerial = !!item.track_serials;
  const addSerials = bySerial && direction === 'add' ? parseSerials(serialText) : [];
  // Removing serial-tracked stock: the quantity is the serials ticked.
  const q = bySerial && direction === 'remove' ? picked.length : num(qty);
  // 7M: an item with alternate units may be adjusted in one (2 BOX = 24 NOS); serials always count base units.
  const alt = !bySerial && !!cleanAltUnits(item.alt_units, item.unit || 'NOS');
  const factor = alt ? factorFor(item, unit) ?? 1 : 1;
  const after = position.qty + (direction === 'add' ? q : -q) * factor;
  const qtyError = q <= 0 ? (bySerial && direction === 'remove' ? invT('errTickSerials') : invT('errQty')) : '';
  const dateError = !date ? invT('errDate') : '';
  const where = multi ? godown : undefined;
  const removable = byBatch && direction === 'remove' ? batchOptions(tracking, date, where) : [];
  const dups = duplicateSerials(addSerials);
  const trackError =
    bySerial && direction === 'add' && addSerials.length !== q ? invT('errSerialCount', { listed: addSerials.length, qty: q })
    : dups.length ? invT('errSerialTwice', { serial: dups[0] })
    : bySerial && direction === 'add' && addSerials.some((s) => tracking?.serials.some((x) => x.inStock && x.serial.toUpperCase() === s.toUpperCase()))
      ? invT('errSerialInStock')
    : byBatch && direction === 'remove' && removable.length > 0 && !batch ? invT('errChooseBatch')
    : '';

  const submit = () => {
    setTouched(true);
    if (qtyError || dateError || trackError) return;
    const move = makeAdjustment({
      item_id: item.id, date, direction, qty: q, rate: direction === 'add' ? num(rate) : 0,
      reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
      ...(factor !== 1 ? { unit, unit_factor: factor } : {}),
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
      title={invT('adjust')}
      subtitle={invT('adjustSub', { name: item.name, qty: position.qty, unit: item.unit })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{invT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>{invT('recordAdj')}</button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className={controls.segment} role="group" aria-label={invT('direction')}>
          <button type="button" className={direction === 'add' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={direction === 'add'} onClick={() => setDirection('add')}>{invT('addStock')}</button>
          <button type="button" className={direction === 'remove' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={direction === 'remove'} onClick={() => setDirection('remove')}>{invT('removeStock')}</button>
        </div>

        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-q`}>{invT('qtyUnit', { unit: alt ? unit : item.unit })}</label>
            <input
              id={`${uid}-q`} className={`${controls.input} ${controls.inputNumeric} ${touched && qtyError ? controls.inputInvalid : ''}`}
              inputMode="decimal" value={bySerial && direction === 'remove' ? String(q) : qty} onChange={(e) => setQty(e.target.value)} autoFocus
              onBlur={() => qty && !bySerial && setQty(String(roundTypedQty(qty, unit, units)))}
              aria-invalid={touched && !!qtyError} readOnly={bySerial && direction === 'remove'}
            />
            {touched && qtyError && <span className={controls.error} role="alert">{qtyError}</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-d`}>{invT('dateReq')}</label>
            <DateField id={`${uid}-d`} className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {alt && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-u`}>{unitT('lineUnit', { n: 1 })}</label>
            <SelectField id={`${uid}-u`} className={controls.select} value={unit} onChange={(e) => { setUnit(e.target.value); if (qty) setQty(String(roundTypedQty(qty, e.target.value, units))); }}>
              {unitChoices(item).map((c) => <option key={c.unit} value={c.unit}>{c.unit}{c.factor !== 1 ? ` (${unitT('equals', { qty: c.factor, unit: item.unit })})` : ''}</option>)}
            </SelectField>
          </div>
        )}

        {multi && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-g`}>{invT('godown')}</label>
            <SelectField id={`${uid}-g`} className={controls.select} value={godown} onChange={(e) => { setGodown(e.target.value); setPicked([]); setBatch(''); }}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField>
          </div>
        )}

        {byBatch && direction === 'add' && (
          <div className={controls.row3}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-b`}>{invT('batchNo')}</label>
              <input id={`${uid}-b`} className={controls.input} value={batch} onChange={(e) => setBatch(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-mfg`}>{invT('mfgDate')}</label>
              <DateField id={`${uid}-mfg`} className={controls.input} value={mfg} onChange={(e) => setMfg(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-exp`}>{invT('expiryDate')}</label>
              <DateField id={`${uid}-exp`} className={controls.input} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          </div>
        )}
        {byBatch && direction === 'remove' && removable.length > 0 && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-rb`}>{invT('batch')}</label>
            <SelectField id={`${uid}-rb`} className={controls.select} value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">{invT('choose')}</option>
              {removable.map((b) => (
                <option key={b.batch} value={b.batch}>
                  {b.batch}{b.expiry ? ` · ${invT('exp', { date: b.expiry })}` : ''} · {b.qty} {item.unit}{b.expired ? ` · ${invT('expired')}` : ''}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        {bySerial && direction === 'add' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sn`}>{invT('serialsAdd')}</label>
            <textarea id={`${uid}-sn`} className={controls.textarea} rows={3} value={serialText} onChange={(e) => setSerialText(e.target.value)} />
          </div>
        )}
        {bySerial && direction === 'remove' && (
          <SerialPicker label={invT('serialsRemove')} options={serialsInStock(tracking, where)} value={picked} onChange={setPicked} />
        )}
        {touched && trackError && <span className={controls.error} role="alert">{trackError}</span>}

        {direction === 'add' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-r`}>{invT('unitCost')}</label>
            <input id={`${uid}-r`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={invT('unitCostPh', { avg: position.avgCost })} />
          </div>
        )}

        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-why`}>{invT('reason')}</label>
          <SelectField id={`${uid}-why`} className={controls.select} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{invT(`reason.${r}` as 'reason.Other')}</option>)}
          </SelectField>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-n`}>{invT('note')}</label>
          <input id={`${uid}-n`} className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {q > 0 && (
          <div className={`${styles.notice} ${after < 0 ? styles.noticeDanger : ''}`} role="status">
            {invT('after')} <strong>{Math.round(after * 1000) / 1000} {item.unit}</strong>
            {after < 0 && invT('negativeParen')}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
