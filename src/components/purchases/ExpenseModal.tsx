import { useMemo, useState } from 'react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { PURCHASE_CATEGORIES } from '../../types/purchases';
import { GST_SLABS } from '../../types/invoice';
import { computePurchaseTotals, expenseLine, paymentsDb, purchasesDb, PAYMENT_METHODS } from '../../lib/purchases';
import { formatCurrency, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface ExpenseModalProps {
  open: boolean;
  onClose: () => void;
  expense?: PurchaseRecord | null;
  vendors: Vendor[];
  businessState: string;
  onSaved: (message: string) => void;
}

/** Quick-add for day-to-day spends: amount + category + optional GST, no line items. */
export function ExpenseModal({ open, onClose, expense, ...rest }: ExpenseModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={expense ? 'Edit expense' : 'Quick add expense'}
      subtitle="Rent, subscriptions, travel — no line items needed."
    >
      <ExpenseForm key={expense?.id ?? 'new'} expense={expense ?? undefined} onClose={onClose} {...rest} />
    </Modal>
  );
}

type FormProps = Omit<ExpenseModalProps, 'open' | 'expense'> & { expense?: PurchaseRecord };

function ExpenseForm({ expense, vendors, businessState, onSaved, onClose }: FormProps) {
  const first = expense?.lines?.[0];
  const [category, setCategory] = useState(expense?.category ?? 'Rent');
  const [amount, setAmount] = useState(first ? first.rate : 0);
  const [taxRate, setTaxRate] = useState(first?.tax_rate ?? 0);
  const [inclusive, setInclusive] = useState(false);
  const [date, setDate] = useState(expense?.date ?? todayInput());
  const [vendorId, setVendorId] = useState(expense?.vendor_id ?? '');
  const [vendorName, setVendorName] = useState(expense && !expense.vendor_id ? expense.vendor_name : '');
  const [itc, setItc] = useState(expense?.itc_eligible ?? false);
  const [paidNow, setPaidNow] = useState(true);
  const [method, setMethod] = useState('UPI');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [error, setError] = useState('');

  const vendor = vendors.find((v) => v.id === vendorId);
  const line = useMemo(() => expenseLine(category, amount, taxRate, inclusive), [category, amount, taxRate, inclusive]);
  const totals = useMemo(
    () => computePurchaseTotals([line], { placeOfSupply: businessState, businessState, gstApplies: taxRate > 0 }),
    [line, businessState, taxRate],
  );

  const submit = () => {
    if (!(amount > 0)) return setError('Enter the expense amount.');
    if (!date) return setError('Choose the date.');
    if (expense && totals.total < expense.amount_paid) {
      return setError(`Total cannot drop below the ${formatCurrency(expense.amount_paid)} already paid.`);
    }
    try {
      const saved = purchasesDb.save({
        ...expense,
        kind: 'EXPENSE',
        vendor_id: vendor?.id,
        vendor_name: vendor?.name ?? (vendorName.trim() || category),
        vendor_gstin: vendor?.gstin,
        bill_number: expense?.bill_number ?? '',
        date,
        due_date: undefined,
        place_of_supply: businessState || undefined,
        category,
        lines: [line],
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        itc_eligible: itc && totals.tax > 0,
        total: totals.total,
        amount_paid: expense?.amount_paid ?? 0,
        notes: notes.trim() || undefined,
      });
      if (!expense && paidNow) paymentsDb.record(saved.id, { amount: saved.total, date, method });
      onSaved(expense ? 'Expense updated' : `Expense of ${formatCurrency(saved.total)} added`);
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
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-cat">Category</label>
          <select id="exp-cat" className={controls.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-date">Date</label>
          <input id="exp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-amt">Amount (₹)</label>
          <NumberInput id="exp-amt" className={controls.inputNumeric} value={amount} placeholder="0.00" onChange={setAmount} autoFocus />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-tax">GST rate</label>
          <select id="exp-tax" className={controls.select} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}>
            {GST_SLABS.map((s) => (
              <option key={s} value={s}>{s === 0 ? 'No GST' : `${s}%`}</option>
            ))}
          </select>
        </div>
      </div>

      {taxRate > 0 && (
        <>
          <label className={controls.check}>
            <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
            Amount already includes GST
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={itc} onChange={(e) => setItc(e.target.checked)} />
            Claim input tax credit
          </label>
        </>
      )}

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>Taxable value</span><span>{formatCurrency(totals.taxable)}</span></div>
        <div className={styles.totalRow}><span>GST</span><span>{formatCurrency(totals.tax)}</span></div>
        <div className={styles.totalGrand}><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <div className={controls.field}>
        <label className={controls.label} htmlFor="exp-vendor">Paid to (optional)</label>
        <select id="exp-vendor" className={controls.select} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Not linked to a vendor</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        {!vendorId && (
          <input
            className={controls.input}
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="Payee name, e.g. Landlord"
            aria-label="Payee name"
          />
        )}
      </div>

      {!expense && (
        <div className={controls.row}>
          <label className={controls.check}>
            <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />
            Already paid
          </label>
          {paidNow && (
            <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className={controls.field}>
        <label className={controls.label} htmlFor="exp-notes">Notes</label>
        <textarea id="exp-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{expense ? 'Save changes' : 'Add expense'}</button>
      </div>
    </form>
  );
}
