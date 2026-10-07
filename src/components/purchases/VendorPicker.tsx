import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Vendor } from '../../types/purchases';
import { vendorsDb, validateVendor } from '../../lib/vendors';
import { GstinInput } from '../ui/GstinInput';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface VendorPickerProps {
  vendors: Vendor[];
  value?: string;
  onSelect: (vendor: Vendor | undefined) => void;
  /** Called after an inline create so the parent can refresh its vendor list. */
  onCreated: (vendor: Vendor) => void;
  id?: string;
}

/** Dropdown of saved vendors with an inline "new vendor" form (GSTIN validated offline). */
export function VendorPicker({ vendors, value, onSelect, onCreated, id }: VendorPickerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setCreating(false);
    setName('');
    setGstin('');
    setStateCode('');
    setError('');
  };

  const create = () => {
    const problem = validateVendor({ name, gstin });
    if (problem) return setError(problem);
    try {
      const vendor = vendorsDb.save({ name, gstin, state_code: stateCode });
      onCreated(vendor);
      onSelect(vendor);
      reset();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>Vendor</label>
      <div className={styles.vendorRow}>
        <select
          id={id}
          className={controls.select}
          value={value ?? ''}
          onChange={(e) => onSelect(vendors.find((v) => v.id === e.target.value))}
        >
          <option value="">Select a vendor…</option>
          {[...vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.gstin ? ` · ${v.gstin}` : ''}
            </option>
          ))}
        </select>
        {!creating && (
          <button type="button" className={controls.btnOutline} onClick={() => setCreating(true)}>
            <Plus size={16} /> New vendor
          </button>
        )}
      </div>

      {creating && (
        <div className={styles.inlineCard}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${id}-vname`}>Vendor name</label>
            <input
              id={`${id}-vname`}
              className={controls.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sharma Stationers"
              autoFocus
            />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${id}-vgstin`}>GSTIN (optional)</label>
            <GstinInput id={`${id}-vgstin`} value={gstin} onChange={setGstin} onStateCode={setStateCode} />
          </div>
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.inlineActions}>
            <button type="button" className={controls.btnGhost} onClick={reset}>Cancel</button>
            <button type="button" className={controls.btnPrimary} onClick={create}>Save vendor</button>
          </div>
        </div>
      )}
    </div>
  );
}
