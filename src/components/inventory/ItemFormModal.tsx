import { useId, useState } from 'react';
import { Modal } from '../ui/Modal';
import { UNITS, GST_SLABS } from '../../types/invoice';
import { num } from '../../lib/invoice-calc';
import type { StockItem } from '../../lib/inventory';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

export interface ItemFormModalProps {
  open: boolean;
  /** Item being edited, or a blank item from `blankStockItem()` when adding. */
  item: StockItem | null;
  isNew: boolean;
  /** Names already used by other stock items (lower-cased) — blocks duplicates. */
  takenNames: string[];
  onSave: (item: StockItem) => void;
  onClose: () => void;
}

interface Draft {
  name: string; sku: string; hsn: string; unit: string; track_stock: boolean;
  opening_qty: string; opening_rate: string; reorder_level: string;
  sale_rate: string; tax_rate: string; location: string;
}

function toDraft(i: StockItem): Draft {
  return {
    name: i.name, sku: i.sku ?? '', hsn: i.hsn ?? '', unit: i.unit || 'NOS', track_stock: i.track_stock,
    opening_qty: String(i.opening_qty || ''), opening_rate: String(i.opening_rate || ''),
    reorder_level: String(i.reorder_level || ''), sale_rate: i.sale_rate ? String(i.sale_rate) : '',
    tax_rate: i.tax_rate !== undefined ? String(i.tax_rate) : '', location: i.location ?? '',
  };
}

/** Mounts the form fresh each time it opens, so drafts never leak between items. */
export function ItemFormModal(props: ItemFormModalProps) {
  if (!props.open || !props.item) return null;
  return <ItemForm key={props.item.id} {...props} item={props.item} />;
}

function ItemForm({ open, item, isNew, takenNames, onSave, onClose }: ItemFormModalProps & { item: StockItem }) {
  const [d, setD] = useState<Draft>(() => toDraft(item));
  const [touched, setTouched] = useState(false);
  const uid = useId();

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const name = d.name.trim();
  const dup = takenNames.includes(name.toLowerCase());
  const nameError = !name ? 'Item name is required.' : dup ? 'A stock item with this name already exists.' : '';
  const negative = [d.opening_qty, d.opening_rate, d.reorder_level, d.sale_rate].some((v) => num(v) < 0);
  const taxBad = d.tax_rate !== '' && (num(d.tax_rate) < 0 || num(d.tax_rate) > 100);
  const valid = !nameError && !negative && !taxBad;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSave({
      ...item,
      name,
      sku: d.sku.trim() || undefined,
      hsn: d.hsn.trim() || undefined,
      unit: d.unit,
      track_stock: d.track_stock,
      opening_qty: num(d.opening_qty),
      opening_rate: num(d.opening_rate),
      reorder_level: num(d.reorder_level),
      sale_rate: d.sale_rate === '' ? undefined : num(d.sale_rate),
      tax_rate: d.tax_rate === '' ? undefined : num(d.tax_rate),
      location: d.location.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isNew ? 'Add stock item' : 'Edit stock item'}
      subtitle="Name must match the item name used on invoices so sales reduce this stock."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            {isNew ? 'Add item' : 'Save changes'}
          </button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-name`}>Item name *</label>
          <input
            id={`${uid}-name`}
            className={`${controls.input} ${touched && nameError ? controls.inputInvalid : ''}`}
            value={d.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Wireless Mouse"
            aria-invalid={touched && !!nameError}
            autoComplete="off"
          />
          {touched && nameError && <span className={controls.error} role="alert">{nameError}</span>}
        </div>

        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sku`}>SKU</label>
            <input id={`${uid}-sku`} className={controls.input} value={d.sku} onChange={(e) => set('sku', e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-hsn`}>HSN / SAC</label>
            <input
              id={`${uid}-hsn`} className={controls.input} inputMode="numeric" value={d.hsn}
              onChange={(e) => set('hsn', e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
            />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-unit`}>Unit</label>
            <select id={`${uid}-unit`} className={controls.select} value={d.unit} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sale`}>Sale rate</label>
            <input id={`${uid}-sale`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.sale_rate} onChange={(e) => set('sale_rate', e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-gst`}>GST %</label>
            <input
              id={`${uid}-gst`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal"
              list={`${uid}-slabs`} value={d.tax_rate} onChange={(e) => set('tax_rate', e.target.value)}
              aria-invalid={taxBad}
            />
            <datalist id={`${uid}-slabs`}>{GST_SLABS.map((s) => <option key={s} value={s} />)}</datalist>
            {taxBad && <span className={controls.error} role="alert">GST must be between 0 and 100.</span>}
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-loc`}>Location</label>
            <input id={`${uid}-loc`} className={controls.input} value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="Rack / godown" />
          </div>
        </div>

        <label className={controls.check}>
          <input type="checkbox" checked={d.track_stock} onChange={(e) => set('track_stock', e.target.checked)} />
          Track stock for this item (turn off for services)
        </label>

        {d.track_stock && (
          <>
            <p className={styles.sectionLabel}>Opening balance and reorder</p>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-oq`}>Opening qty</label>
                <input id={`${uid}-oq`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.opening_qty} onChange={(e) => set('opening_qty', e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-or`}>Opening rate (cost)</label>
                <input id={`${uid}-or`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.opening_rate} onChange={(e) => set('opening_rate', e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-rl`}>Reorder level</label>
                <input id={`${uid}-rl`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={d.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
              </div>
            </div>
          </>
        )}
        {touched && negative && <span className={controls.error} role="alert">Quantities and rates cannot be negative.</span>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
