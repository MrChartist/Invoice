import { useMemo, useState } from 'react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { PURCHASE_CATEGORIES } from '../../types/purchases';
import { gstRateOptions } from '../../lib/tax-rules';
import { computePurchaseTotals, expenseLine, paymentsDb, purchasesDb, PAYMENT_METHODS } from '../../lib/purchases';
import { formatCurrency, todayInput } from '../../lib/utils';
import { supplierPayable } from '../../lib/purchase-normalize';
import { Modal } from '../ui/Modal';
import { BillableFields } from './BillableFields';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentres';
import { billablePatch, type BillableValue } from '../../lib/purchases';
import { NumberInput } from '../ui/NumberInput';
import { AttachmentsPanel } from '../attachments/AttachmentsPanel';
import type { AttachmentRef } from '../../types/attachments';
import { useT } from '../../i18n';
import { methodLabel } from '../../i18n/labels';
import { purT, purCategory } from '../../i18n/areas/purchases';
import { expenseAmountLabel } from '../../lib/purchases';
import { TdsBillPanel } from './TdsBillPanel';
import { saveBillGuarded } from '../../lib/bill-guard';
import { capT } from '../../i18n/areas/capture';
import { priorCreditsFor, resolveBillTds, type BillTdsInput } from '../../lib/tds-payables';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface ExpenseModalProps {
  open: boolean;
  onClose: () => void;
  expense?: PurchaseRecord | null;
  vendors: Vendor[];
  businessState: string;
  onSaved: (message: string) => void;
  /** 8.23: files to start a NEW expense with (a receipt shared into the app). */
  attachments?: AttachmentRef[];
}

/** Quick-add for day-to-day spends: amount + category + optional GST, no line items. */
export function ExpenseModal({ open, onClose, expense, ...rest }: ExpenseModalProps) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={expense ? purT('expEditTitle') : purT('expAddTitle')}
      subtitle={purT('expSub')}
    >
      <ExpenseForm key={expense?.id ?? (rest.attachments?.length ? 'shared' : 'new')} expense={expense ?? undefined} onClose={onClose} {...rest} />
    </Modal>
  );
}

type FormProps = Omit<ExpenseModalProps, 'open' | 'expense'> & { expense?: PurchaseRecord };

function ExpenseForm({ expense, vendors, businessState, onSaved, onClose, attachments: seeded }: FormProps) {
  const first = expense?.lines?.[0];
  const [category, setCategory] = useState(expense?.category ?? 'Rent');
  const [amount, setAmount] = useState(first ? first.rate : 0);
  const [taxRate, setTaxRate] = useState(first?.tax_rate ?? 0);
  // QA-3 F11: a receipt shows what was paid, so a new expense takes the amount as GST-inclusive (an edit keeps the stored taxable rate).
  const [inclusive, setInclusive] = useState(!expense);
  const [date, setDate] = useState(expense?.date ?? todayInput());
  const [vendorId, setVendorId] = useState(expense?.vendor_id ?? '');
  const [vendorName, setVendorName] = useState(expense && !expense.vendor_id ? expense.vendor_name : '');
  const [itc, setItc] = useState(expense?.itc_eligible ?? false);
  const [paidNow, setPaidNow] = useState(true);
  const [method, setMethod] = useState('UPI');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [costCentre, setCostCentre] = useState<string | undefined>(expense?.cost_centre_id);
  const centres = useCostCentres();
  const [billable, setBillable] = useState<BillableValue>({
    billable_to_client_id: expense?.billable_to_client_id,
    markup_percent: expense?.markup_percent,
    pure_agent: expense?.pure_agent,
  });
  const [attachments, setAttachments] = useState<AttachmentRef[]>(expense?.attachments ?? seeded ?? []);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [tds, setTds] = useState<BillTdsInput>(() => ({
    section: expense?.tds_section ?? '',
    on: expense?.tds_on ?? 'BILL',
    pan: expense?.tds_pan ?? '',
    lowerCert: expense?.tds_cert_no,
    ...(expense?.tds_section ? { rate: expense.tds_rate, base: expense.tds_base, amount: expense.tds_amount } : {}),
  }));

  const vendor = vendors.find((v) => v.id === vendorId);
  const line = useMemo(() => expenseLine(category, amount, taxRate, inclusive), [category, amount, taxRate, inclusive]);
  const totals = useMemo(
    () => computePurchaseTotals([line], { placeOfSupply: businessState, businessState, gstApplies: taxRate > 0 }),
    [line, businessState, taxRate],
  );

  const tdsResolved = useMemo(
    () => resolveBillTds(tds, { date, taxable: totals.taxable, prior: priorCreditsFor(purchasesDb.all(), { id: vendor?.id, name: vendor?.name ?? vendorName, pan: tds.pan }), excludeId: expense?.id }),
    [tds, date, totals.taxable, vendor?.id, vendor?.name, vendorName, expense?.id],
  );

  const submit = () => {
    if (!(amount > 0)) return setError(purT('errExpAmount'));
    if (!date) return setError(purT('errDate'));
    if (expense && totals.total < expense.amount_paid) {
      return setError(purT('errTotalBelowPaid', { amount: formatCurrency(expense.amount_paid) }));
    }
    try {
      // 8C: duplicate warnings (save again to override), approval hold (a "paid now" expense keeps its payment for approval).
      const tdsPay = tdsResolved.fields.tds_on === 'PAYMENT' ? tdsResolved.fields.tds_amount ?? 0 : 0;
      const res = saveBillGuarded({
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
        ...billablePatch(billable),
        cost_centre_id: costCentre,
        attachments: attachments.length ? attachments : undefined,
        ...tdsResolved.fields,
      }, { confirmed: !!warning, payNow: !expense && paidNow ? { method, date, ...(tdsPay > 0 ? { tds_amount: tdsPay } : {}) } : undefined });
      if (res.kind === 'warn') {
        setWarning(res.message);
        return;
      }
      if (res.kind === 'held') {
        onSaved(capT('heldMsg'));
        onClose();
        return;
      }
      const saved = res.bill;
      if (!expense && paidNow) {
        // TDS deducted when paying: the payment is the net amount, the TDS settles the rest.
        const tdsNow = saved.tds_on === 'PAYMENT' ? saved.tds_amount ?? 0 : 0;
        paymentsDb.record(saved.id, { amount: supplierPayable(saved) - tdsNow, date, method, tdsAmount: tdsNow });
      }
      onSaved(expense ? purT('expUpdated') : purT('expAdded', { amount: formatCurrency(saved.total) }));
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
          <label className={controls.label} htmlFor="exp-cat">{purT('category')}</label>
          <select id="exp-cat" className={controls.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{purCategory(c)}</option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-date">{purT('date')}</label>
          <input id="exp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-amt">{purT(expenseAmountLabel(taxRate, inclusive))}</label>
          <NumberInput id="exp-amt" className={controls.inputNumeric} value={amount} placeholder="0.00" onChange={setAmount} autoFocus />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="exp-tax">{purT('gstRate')}</label>
          <select id="exp-tax" className={controls.select} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}>
            {gstRateOptions(date, taxRate).map((s) => (
              <option key={s} value={s}>{s === 0 ? purT('noGst') : `${s}%`}</option>
            ))}
          </select>
        </div>
      </div>

      {taxRate > 0 && (
        <>
          <label className={controls.check}>
            <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
            {purT('inclusive')}
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={itc} onChange={(e) => setItc(e.target.checked)} />
            {purT('claimItc')}
          </label>
        </>
      )}

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>{purT('taxable')}</span><span>{formatCurrency(totals.taxable)}</span></div>
        <div className={styles.totalRow}><span>GST</span><span>{formatCurrency(totals.tax)}</span></div>
        <div className={styles.totalGrand}><span>{purT('total')}</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <div className={controls.field}>
        <label className={controls.label} htmlFor="exp-vendor">{purT('paidTo')}</label>
        <select id="exp-vendor" className={controls.select} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{purT('notLinked')}</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        {!vendorId && (
          <input
            className={controls.input}
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder={purT('payeePh')}
            aria-label={purT('payee')}
          />
        )}
      </div>

      {!expense && (
        <div className={controls.row}>
          <label className={controls.check}>
            <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />
            {purT('alreadyPaid')}
          </label>
          {paidNow && (
            <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)} aria-label={purT('paymentMethod')}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{methodLabel(m)}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <CostCentreSelect id="exp-cost-centre" label={purT('costCentre')} centres={centres} value={costCentre} onChange={setCostCentre} />

      <div className={controls.field}>
        <label className={controls.label} htmlFor="exp-notes">{purT('notes')}</label>
        <textarea id="exp-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <TdsBillPanel value={tds} onChange={setTds} suggestion={tdsResolved.suggestion} payableNet={totals.total - (tdsResolved.fields.tds_on === 'BILL' ? tdsResolved.fields.tds_amount ?? 0 : 0)} nonResident={vendor?.non_resident} date={date} />

      <BillableFields idPrefix="exp" value={billable} onChange={setBillable} rebilledIn={expense?.rebilled_in} />

      <AttachmentsPanel value={attachments} onChange={setAttachments} label={purT('attachments')} />

      {warning && <p className={styles.formError} role="alert">{warning}</p>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{purT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{expense ? purT('saveChanges') : purT('addExpense')}</button>
      </div>
    </form>
  );
}
