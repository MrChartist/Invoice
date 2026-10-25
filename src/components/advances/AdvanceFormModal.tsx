import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { AdvanceError, computeAdvanceTax, saveAdvance, senderSnapshot, validateAdvance, type AdvanceInput } from '../../lib/advances';
import { localDb } from '../../lib/localDb';
import { INDIAN_STATES, resolveStateCode } from '../../lib/india-states';
import { checkGstin } from '../../lib/gstin';
import { GST_SLABS } from '../../lib/tax-rules';
import { referenceLabel } from '../../lib/receipts';
import { formatMoney, todayInput } from '../../lib/utils';
import type { AdvanceRecord, AdvanceSupply } from '../../types/advances';
import controls from '../../styles/controls.module.css';
import styles from './advances.module.css';

const METHODS = ['Bank transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];

interface Form {
  party: string;
  date: string;
  amount: string;
  supply: AdvanceSupply;
  rate: string;
  pos: string;
  method: string;
  reference: string;
  description: string;
  note: string;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

export interface AdvanceFormModalProps {
  open: boolean;
  advance: AdvanceRecord | null;
  /** Pre-fill the client (e.g. from a party filter). */
  partyName?: string;
  onClose: () => void;
  onSaved: (a: AdvanceRecord, isNew: boolean) => void;
}

/** Record / edit an advance receipt (Rule 50 receipt voucher). */
export function AdvanceFormModal({ open, advance, partyName, onClose, onSaved }: AdvanceFormModalProps) {
  const sender = useMemo(() => (open ? senderSnapshot() : null), [open]);
  const senderState = sender?.stateCode || checkGstin(sender?.companyGstin ?? '').stateCode || '';
  const clients = useMemo(() => (open ? localDb.clients.getAll() : []), [open]);
  const defaultRate = useMemo(() => (open ? localDb.settings.get().defaultTaxRate : 18), [open]);
  const [form, setForm] = useState<Form>(() => blank(''));
  const [error, setError] = useState('');

  function blank(party: string): Form {
    return { party, date: todayInput(), amount: '', supply: 'services', rate: String(defaultRate ?? 18), pos: senderState, method: METHODS[0], reference: '', description: '', note: '' };
  }

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      advance
        ? {
            party: advance.client.company || advance.client.name,
            date: advance.date,
            amount: String(advance.amount),
            supply: advance.supply,
            rate: String(advance.tax_rate),
            pos: advance.place_of_supply,
            method: advance.method,
            reference: advance.reference ?? '',
            description: advance.description ?? '',
            note: advance.note ?? '',
          }
        : blank(partyName ?? ''),
    );
    // Reset only when the dialog opens for a different voucher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, advance]);

  const party = norm(form.party);
  const client = clients.find((c) => norm(c.name) === party || norm(c.company) === party);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pickParty = (value: string) => {
    const c = clients.find((x) => norm(x.name) === norm(value) || norm(x.company) === norm(value));
    setForm((f) => ({ ...f, party: value, pos: c ? resolveStateCode({ code: c.state_code, gstin: c.gstin, name: c.state }) || f.pos : f.pos }));
  };

  const toInput = (): AdvanceInput => {
    const fromAdvance = advance && norm(advance.client.company || advance.client.name) === party ? advance.client : null;
    return {
      id: advance?.id,
      date: form.date,
      client: client
        ? { id: client.id, name: client.name, company: client.company, gstin: client.gstin, address: [client.address, client.city].filter(Boolean).join(', '), state_code: client.state_code, email: client.email }
        : fromAdvance ?? { name: form.party.trim() },
      place_of_supply: form.pos,
      supply: form.supply,
      tax_rate: Number(form.rate),
      amount: Number(form.amount),
      method: form.method,
      reference: form.reference,
      description: form.description,
      note: form.note,
    };
  };

  const preview = computeAdvanceTax({
    amount: Number(form.amount) || 0, rate: Number(form.rate) || 0, supply: form.supply, date: form.date || todayInput(), pos: form.pos,
    senderState: advance?.sender?.stateCode || senderState,
  });
  const tax = preview.igst + preview.cgst + preview.sgst;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = toInput();
    const errs = validateAdvance(input);
    if (errs.length) return setError(errs[0]);
    try {
      const saved = saveAdvance(input);
      onSaved(saved, !advance);
      onClose();
    } catch (err) {
      setError(err instanceof AdvanceError ? err.message : (err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={advance ? `Edit advance ${advance.number}` : 'Record an advance'}
      subtitle="Money received before the invoice. A receipt voucher (Rule 50) is issued in its own series."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="submit" form="advance-form" className={controls.btnPrimary}>{advance ? 'Save changes' : 'Save advance'}</button>
        </>
      }
    >
      <form id="advance-form" onSubmit={submit} noValidate className={styles.form}>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Received from *</span>
            <input className={controls.input} list="advance-parties" value={form.party} onChange={(e) => pickParty(e.target.value)} autoFocus />
            <datalist id="advance-parties">
              {clients.map((c) => c.company || c.name).filter(Boolean).map((n) => <option key={n} value={n} />)}
            </datalist>
            {form.party.trim() && !client && <span className={controls.hint}>Not in your clients; saved with the name only.</span>}
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Amount received (₹) *</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>Date received *</span>
            <input className={controls.input} type="date" value={form.date} max={todayInput()} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Advance for</span>
            <select className={controls.select} value={form.supply} onChange={(e) => set('supply', e.target.value as AdvanceSupply)}>
              <option value="services">Services</option>
              <option value="goods">Goods</option>
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>GST rate of the supply</span>
            <select className={controls.select} value={form.rate} onChange={(e) => set('rate', e.target.value)}>
              {GST_SLABS.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
            </select>
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Place of supply *</span>
          <select className={controls.select} value={form.pos} onChange={(e) => set('pos', e.target.value)}>
            <option value="">Choose…</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </label>
        <div className={styles.taxBox} role="status" aria-live="polite">
          {preview.applies
            ? <>GST due on this advance: <strong>₹{formatMoney(tax)}</strong> ({preview.supply_type === 'INTER' ? `IGST ₹${formatMoney(preview.igst)}` : `CGST ₹${formatMoney(preview.cgst)} + SGST ₹${formatMoney(preview.sgst)}`}) on a value of ₹{formatMoney(preview.taxable)}, worked out inside the amount received. It is reported in GSTR-1 Table 11A for this month.</>
            : form.supply === 'goods'
              ? <>No GST on an advance for goods (time of supply is the invoice, Notification 66/2017-CT).</>
              : <>No GST on this advance (export / zero-rated, or a nil rate).</>}
          {' '}Verify with your CA.
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Method</span>
            <select className={controls.select} value={form.method} onChange={(e) => set('method', e.target.value)}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{referenceLabel(form.method)} (optional)</span>
            <input className={controls.input} value={form.reference} onChange={(e) => set('reference', e.target.value.trimStart())} />
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Description of supply (printed)</span>
          <input className={controls.input} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={form.supply === 'goods' ? 'e.g. Advance for 200 units of item X' : 'e.g. Retainer for statutory audit FY 25-26'} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>Note (internal)</span>
          <input className={controls.input} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}
