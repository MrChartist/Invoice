import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ChequeError, saveCheque, validateCheque, type ChequeInput } from '../../lib/cheques';
import { BankAccountSelect } from '../bank/BankAccountSelect';
import { DEFAULT_BANK_ID } from '../../lib/bank-accounts';
import { isPostDated, validUntil } from '../../lib/cheque-reminders';
import { localDb } from '../../lib/localDb';
import { purchasesDb, balanceOf } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { formatDate, formatMoney, todayInput } from '../../lib/utils';
import type { Cheque, ChequeDirection } from '../../types/cheques';
import controls from '../../styles/controls.module.css';
import { receivableBalance } from '../../lib/rcm';
import { useT } from '../../i18n';
import { chqT } from '../../i18n/areas/cheques';
import { bnkT } from '../../i18n/areas/banking';
import { allocatedTotal } from '../../lib/cheques';

export interface ChequeFormModalProps {
  open: boolean;
  direction: ChequeDirection;
  cheque: Cheque | null;
  onClose: () => void;
  onSaved: (c: Cheque, isNew: boolean) => void;
}

interface Form {
  number: string;
  bank: string;
  branch: string;
  cheque_date: string;
  amount: string;
  party_name: string;
  link: string;
  account_payee: boolean;
  notes: string;
  /** WP-5: our bank account, and several documents with an amount each. */
  bank_account_id: string;
  multi: boolean;
  allocs: Record<string, string>;
}

const blank = (): Form => ({ number: '', bank: '', branch: '', cheque_date: todayInput(), amount: '', party_name: '', link: '', account_payee: true, notes: '', bank_account_id: '', multi: false, allocs: {} });
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Add / edit a received or issued cheque (6.26). */
export function ChequeFormModal({ open, direction, cheque, onClose, onSaved }: ChequeFormModalProps) {
  useT(); // re-render on a language switch (5.4)
  const [form, setForm] = useState<Form>(blank);
  const [error, setError] = useState('');
  const dir = cheque?.direction ?? direction;
  const received = dir === 'received';

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      cheque
        ? {
            number: cheque.number,
            bank: cheque.bank,
            branch: cheque.branch ?? '',
            cheque_date: cheque.cheque_date,
            amount: String(cheque.amount),
            party_name: cheque.party_name,
            link: cheque.invoice_id ?? cheque.purchase_id ?? '',
            account_payee: cheque.account_payee !== false,
            notes: cheque.notes ?? '',
            bank_account_id: cheque.bank_account_id ?? '',
            multi: !!cheque.allocations?.length,
            allocs: Object.fromEntries((cheque.allocations ?? []).map((a) => [a.invoice_id ?? a.purchase_id ?? '', String(a.amount)])),
          }
        : blank(),
    );
  }, [open, cheque]);

  const clients = useMemo(() => (open ? localDb.clients.getAll() : []), [open]);
  const vendors = useMemo(() => (open ? vendorsDb.all() : []), [open]);
  const invoices = useMemo(() => (open ? localDb.invoices.getAll() : []), [open]);
  const bills = useMemo(() => (open ? purchasesDb.all() : []), [open]);

  const party = norm(form.party_name);
  const client = received ? clients.find((c) => norm(c.name) === party || norm(c.company) === party) : undefined;
  const vendor = !received ? vendors.find((v) => norm(v.name) === party) : undefined;

  // Documents the cheque can settle: open INR invoices (received) / unpaid bills (issued), the party's first.
  const options = useMemo(() => {
    if (received) {
      return invoices
        .filter((i) => ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY'].includes(i.doc_type ?? 'INVOICE') && i.status !== 'Draft' && i.status !== 'Cancelled')
        .filter((i) => (i.currency || 'INR').toUpperCase() === 'INR' && (receivableBalance(i) > 0 || i.id === cheque?.invoice_id))
        .filter((i) => !party || norm(i.client?.name) === party || norm(i.client?.company) === party || (client?.id && i.client?.id === client.id) || i.id === cheque?.invoice_id)
        .map((i) => ({ id: i.id, due: receivableBalance(i), label: chqT('fOption', { number: i.invoice_number, party: i.client?.name ?? '', amount: formatMoney(receivableBalance(i)) }) }));
    }
    return bills
      .filter((b) => balanceOf(b) > 0 || b.id === cheque?.purchase_id)
      .filter((b) => !party || norm(b.vendor_name) === party || b.id === cheque?.purchase_id)
      .map((b) => ({ id: b.id, due: balanceOf(b), label: chqT('fOption', { number: b.bill_number || chqT('billWord'), party: b.vendor_name, amount: formatMoney(balanceOf(b)) }) }));
  }, [received, invoices, bills, party, client, cheque]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pickLink = (id: string) => {
    set('link', id);
    if (!id) return;
    if (received) {
      const inv = invoices.find((i) => i.id === id);
      if (inv) setForm((f) => ({ ...f, link: id, party_name: f.party_name || inv.client?.company || inv.client?.name || '', amount: f.amount || String(receivableBalance(inv)) }));
    } else {
      const b = bills.find((x) => x.id === id);
      if (b) setForm((f) => ({ ...f, link: id, party_name: f.party_name || b.vendor_name, amount: f.amount || String(balanceOf(b)) }));
    }
  };

  const toInput = (): ChequeInput => {
    const linkedInvoice = received && form.link && !form.multi ? invoices.find((i) => i.id === form.link) : undefined;
    const allocations = form.multi
      ? Object.entries(form.allocs).filter(([, v]) => Number(v) > 0).map(([id, v]) => (received ? { invoice_id: id, amount: Number(v) } : { purchase_id: id, amount: Number(v) }))
      : undefined;
    return {
      ...(cheque ?? {}),
      id: cheque?.id,
      direction: dir,
      number: form.number.trim(),
      bank: form.bank.trim(),
      branch: form.branch.trim() || undefined,
      cheque_date: form.cheque_date,
      amount: Number(form.amount),
      party_name: form.party_name.trim(),
      client_id: received ? client?.id ?? linkedInvoice?.client?.id : undefined,
      vendor_id: !received ? vendor?.id : undefined,
      invoice_id: received && !form.multi ? form.link || undefined : undefined,
      purchase_id: !received && !form.multi ? form.link || undefined : undefined,
      allocations: allocations?.length ? allocations : undefined,
      account_payee: received ? undefined : form.account_payee,
      notes: form.notes.trim() || undefined,
      bank_account_id: form.bank_account_id && form.bank_account_id !== DEFAULT_BANK_ID ? form.bank_account_id : undefined,
    };
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = toInput();
    const errs = validateCheque(input, []);
    if (errs.length) return setError(errs[0]);
    try {
      const saved = saveCheque(input);
      onSaved(saved, !cheque);
      onClose();
    } catch (err) {
      setError(err instanceof ChequeError ? err.message : (err as Error).message);
    }
  };

  const today = todayInput();
  const pdc = form.cheque_date && isPostDated({ cheque_date: form.cheque_date }, today);
  const frozen = !!(cheque?.payment_id || cheque?.purchase_payment_id || cheque?.payment_ids?.length || cheque?.purchase_payment_ids?.length);
  const allocSum = allocatedTotal(Object.values(form.allocs).map((v) => ({ amount: Number(v) || 0 })));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={cheque ? chqT('fEdit') : received ? chqT('fReceived') : chqT('fIssue')}
      subtitle={received ? chqT('fSubReceived') : chqT('fSubIssued')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{chqT('cancel')}</button>
          <button type="submit" form="cheque-form" className={controls.btnPrimary}>{cheque ? chqT('saveChanges') : chqT('fSave')}</button>
        </>
      }
    >
      <form id="cheque-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{received ? chqT('fFrom') : chqT('fPayee')}</span>
            <input className={controls.input} list="cheque-parties" value={form.party_name} onChange={(e) => set('party_name', e.target.value)} autoFocus />
            <datalist id="cheque-parties">
              {(received ? clients.map((c) => c.company || c.name) : vendors.map((v) => v.name)).filter(Boolean).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('fAmount')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={form.amount} disabled={frozen} onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('fNumber')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" maxLength={6} value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="000123" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{received ? chqT('fDrawn') : chqT('fOurBank')}</span>
            <input className={controls.input} value={form.bank} onChange={(e) => set('bank', e.target.value)} placeholder="HDFC Bank" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('fDate')}</span>
            <input className={controls.input} type="date" value={form.cheque_date} onChange={(e) => set('cheque_date', e.target.value)} />
          </label>
        </div>
        {form.cheque_date && (
          <span className={controls.hint}>
            {pdc ? chqT('fPdc', { date: formatDate(form.cheque_date) }) : ''}
            {chqT('fValid', { date: formatDate(validUntil(form.cheque_date)) })}
          </span>
        )}
        <BankAccountSelect purpose="cheque" id="cheque-bank-account" label={bnkT('intoAccount')} method="Cheque" value={form.bank_account_id} onChange={(id) => set('bank_account_id', id)} />
        <label className={controls.check}>
          <input type="checkbox" checked={form.multi} disabled={frozen} onChange={(e) => set('multi', e.target.checked)} /> {bnkT('severalDocs')}
        </label>
        {form.multi && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {options.map((o) => (
              <div key={o.id} className={controls.row}>
                <label className={controls.check} style={{ flex: 2 }}>
                  <input type="checkbox" checked={o.id in form.allocs} disabled={frozen}
                    onChange={(e) => setForm((f) => {
                      const allocs = { ...f.allocs };
                      if (e.target.checked) allocs[o.id] = String(o.due);
                      else delete allocs[o.id];
                      return { ...f, allocs };
                    })} /> {o.label}
                </label>
                {o.id in form.allocs && (
                  <input className={`${controls.input} ${controls.inputNumeric}`} style={{ flex: 1 }} inputMode="decimal" aria-label={o.label} disabled={frozen} value={form.allocs[o.id]}
                    onChange={(e) => setForm((f) => ({ ...f, allocs: { ...f.allocs, [o.id]: e.target.value.replace(/[^0-9.]/g, '') } }))} />
                )}
              </div>
            ))}
            <span className={controls.hint}>{bnkT('allocated', { amount: formatMoney(allocSum), total: formatMoney(Number(form.amount) || 0) })}</span>
          </div>
        )}
        {!form.multi && (
        <label className={controls.field}>
          <span className={controls.label}>{received ? chqT('fAgainstInv') : chqT('fAgainstBill')}</span>
          <select className={controls.select} value={form.link} disabled={frozen} onChange={(e) => pickLink(e.target.value)}>
            <option value="">{received ? chqT('fNotLinkedAdv') : chqT('fNotLinked')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <span className={controls.hint}>
            {received
              ? chqT('fHintReceived')
              : chqT('fHintIssued')}
          </span>
        </label>
        )}
        {!received && (
          <label className={controls.check}>
            <input type="checkbox" checked={form.account_payee} onChange={(e) => set('account_payee', e.target.checked)} /> {chqT('fCrossing')}
          </label>
        )}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('fBranch')}</span>
            <input className={controls.input} value={form.branch} onChange={(e) => set('branch', e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('fNotes')}</span>
            <input className={controls.input} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
      </form>
    </Modal>
  );
}
