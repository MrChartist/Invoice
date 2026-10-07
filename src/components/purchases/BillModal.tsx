import { useMemo, useState } from 'react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { PURCHASE_CATEGORIES } from '../../types/purchases';
import { INDIAN_STATES } from '../../lib/india-states';
import { blankPurchaseLine, computePurchaseTotals, purchasesDb } from '../../lib/purchases';
import { addDaysInput, formatCurrency, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { VendorPicker } from './VendorPicker';
import { LineItemsEditor } from './LineItemsEditor';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface BillModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing bill to edit; omit to create. */
  purchase?: PurchaseRecord | null;
  vendors: Vendor[];
  onVendorCreated: (vendor: Vendor) => void;
  /** State code of the business, drives CGST+SGST vs IGST. */
  businessState: string;
  onSaved: (message: string) => void;
}

/** Supplier bill with line items, GST split by place of supply, and ITC flag. */
export function BillModal({ open, onClose, purchase, ...rest }: BillModalProps) {
  // Re-mount the form per bill so state initialises from props without effects.
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={purchase ? 'Edit purchase bill' : 'Add purchase bill'}
      subtitle="Record a supplier bill. GST is split automatically by place of supply."
    >
      <BillForm key={purchase?.id ?? 'new'} purchase={purchase ?? undefined} onClose={onClose} {...rest} />
    </Modal>
  );
}

type FormProps = Omit<BillModalProps, 'open' | 'purchase'> & { purchase?: PurchaseRecord };

function BillForm({ purchase, vendors, onVendorCreated, businessState, onSaved, onClose }: FormProps) {
  const [vendorId, setVendorId] = useState(purchase?.vendor_id ?? '');
  const [billNumber, setBillNumber] = useState(purchase?.bill_number ?? '');
  const [date, setDate] = useState(purchase?.date ?? todayInput());
  const [dueDate, setDueDate] = useState(purchase?.due_date ?? addDaysInput(30));
  const [pos, setPos] = useState(purchase?.place_of_supply ?? businessState);
  const [category, setCategory] = useState(purchase?.category ?? 'Purchases');
  const [lines, setLines] = useState(purchase?.lines?.length ? purchase.lines : [blankPurchaseLine()]);
  const [itc, setItc] = useState(purchase?.itc_eligible ?? true);
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [error, setError] = useState('');

  const vendor = vendors.find((v) => v.id === vendorId);
  const totals = useMemo(
    () => computePurchaseTotals(lines, { placeOfSupply: pos, businessState }),
    [lines, pos, businessState],
  );
  const interState = !!pos && !!businessState && pos !== businessState;

  const submit = () => {
    if (!vendor && !purchase?.vendor_name) return setError('Choose or create a vendor.');
    if (!billNumber.trim()) return setError("Enter the supplier's bill number.");
    if (!date) return setError('Choose the bill date.');
    if (dueDate && dueDate < date) return setError('Due date cannot be before the bill date.');
    const real = lines.filter((l) => l.name.trim() || l.rate > 0);
    if (real.length === 0 || real.some((l) => !l.name.trim())) return setError('Every line needs an item name.');
    if (totals.total <= 0) return setError('The bill total must be greater than zero.');
    if (purchase && totals.total < purchase.amount_paid) {
      return setError(`Total cannot drop below the ${formatCurrency(purchase.amount_paid)} already paid.`);
    }
    try {
      purchasesDb.save({
        ...purchase,
        kind: 'PURCHASE',
        vendor_id: vendor?.id ?? purchase?.vendor_id,
        vendor_name: vendor?.name ?? purchase?.vendor_name ?? '',
        vendor_gstin: vendor?.gstin ?? purchase?.vendor_gstin,
        bill_number: billNumber.trim(),
        date,
        due_date: dueDate || undefined,
        place_of_supply: pos || undefined,
        category,
        lines: real,
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        itc_eligible: itc && totals.tax > 0,
        total: totals.total,
        amount_paid: purchase?.amount_paid ?? 0,
        notes: notes.trim() || undefined,
      });
      onSaved(purchase ? 'Bill updated' : `Bill ${billNumber.trim()} saved`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <VendorPicker
        id="bill-vendor"
        vendors={vendors}
        value={vendorId}
        onCreated={onVendorCreated}
        onSelect={(v) => {
          setVendorId(v?.id ?? '');
          if (v?.state_code) setPos(v.state_code);
          if (v) setItc(!!v.gstin);
        }}
      />

      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-no">Bill number</label>
          <input id="bill-no" className={controls.input} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-date">Bill date</label>
          <input id="bill-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-due">Due date</label>
          <input id="bill-due" type="date" className={controls.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-pos">Place of supply</label>
          <select id="bill-pos" className={controls.select} value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Not specified</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
          <span className={controls.hint}>
            {interState ? 'Inter-state: IGST applies.' : 'Intra-state: CGST + SGST apply.'}
            {!businessState && ' Set your GSTIN in Settings to detect this accurately.'}
          </span>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-cat">Category</label>
          <select id="bill-cat" className={controls.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <h3 className={styles.sectionTitle}>Line items</h3>
      <LineItemsEditor lines={lines} onChange={setLines} />

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>Taxable value</span><span>{formatCurrency(totals.taxable)}</span></div>
        {interState ? (
          <div className={styles.totalRow}><span>IGST</span><span>{formatCurrency(totals.igst)}</span></div>
        ) : (
          <>
            <div className={styles.totalRow}><span>CGST</span><span>{formatCurrency(totals.cgst)}</span></div>
            <div className={styles.totalRow}><span>SGST</span><span>{formatCurrency(totals.sgst)}</span></div>
          </>
        )}
        <div className={styles.totalGrand}><span>Bill total</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <label className={controls.check}>
        <input type="checkbox" checked={itc} onChange={(e) => setItc(e.target.checked)} />
        Claim input tax credit on this bill
      </label>
      {itc && totals.tax > 0 && vendor && !vendor.gstin && (
        <p className={styles.note}>This vendor has no GSTIN — ITC generally cannot be claimed on unregistered purchases.</p>
      )}

      <div className={controls.field}>
        <label className={controls.label} htmlFor="bill-notes">Notes</label>
        <textarea id="bill-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{purchase ? 'Save changes' : 'Save bill'}</button>
      </div>
    </form>
  );
}
