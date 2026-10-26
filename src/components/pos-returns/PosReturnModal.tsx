import { useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import {
  REFUND_METHODS, findBillByNumber, planReturn, posReturnsDb, recentPosBills, savePosReturn, suggestRefund,
  type PosReturn, type RefundMethod, type ReturnSettlement,
} from '../../lib/pos-returns';
import { WALK_IN_NAME } from '../../lib/pos';
import { num } from '../../lib/invoice-calc';
import type { InvoiceRecord } from '../../types/invoice';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { returnsT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../pos/pos.module.css';
import own from './returns.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  /** An exchange was saved: the POS uses its credit on the next bill. */
  onExchange: (row: PosReturn) => void;
}

const NO_REFUND: Record<RefundMethod, number> = { Cash: 0, UPI: 0, Card: 0 };

/**
 * POS return / exchange (WP-9, P1-25): find the original bill (scan / type its number or pick a
 * recent one), choose lines and quantities, then refund by tender, exchange against a new bill or
 * keep the credit on account. The credit note goes through `documents.createCreditNote` with
 * goods returned to stock.
 */
export function PosReturnModal({ open, onClose, notify, onExchange }: Props) {
  useT();
  const [tick, setTick] = useState(0);
  const data = useMemo(
    () => ({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), links: readLinks(), returns: posReturnsDb.all() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, tick],
  );
  const [code, setCode] = useState('');
  const [billId, setBillId] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [settlement, setSettlement] = useState<ReturnSettlement>('refund');
  const [refund, setRefund] = useState(NO_REFUND);
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const day = todayInput();

  const bill: InvoiceRecord | undefined = data.invoices.find((i) => i.id === billId);
  const recent = useMemo(() => recentPosBills(data.invoices), [data.invoices]);
  const picks = Object.entries(qty).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  const plan = bill ? planReturn(bill, picks, { ...data, day }) : null;
  const walkIn = bill ? (bill.client?.name || '').trim() === WALK_IN_NAME : true;

  // Refund defaults follow the bill's tenders until the cashier edits them.
  const suggested = bill && plan ? suggestRefund(bill, data.payments, Math.min(plan.amount, plan.refundable)) : [];
  const shownRefund = touched ? refund : REFUND_METHODS.reduce((o, m) => ({ ...o, [m]: suggested.find((s) => s.method === m)?.amount ?? 0 }), { ...NO_REFUND });

  const walkInOf = (inv: InvoiceRecord) => (inv.client?.name || '').trim() === WALK_IN_NAME;
  const pick = (inv: InvoiceRecord | null) => {
    setErrors([]);
    setQty({});
    setTouched(false);
    if (!inv) {
      setErrors([returnsT('notFound', { code })]);
      return;
    }
    setBillId(inv.id);
    setSettlement(walkInOf(inv) || data.payments.some((p) => p.invoice_id === inv.id) ? 'refund' : 'account');
  };
  const save = () => {
    if (!bill) return;
    const res = savePosReturn({
      bill,
      lines: picks,
      settlement,
      refunds: settlement === 'refund' ? REFUND_METHODS.map((m) => ({ method: m, amount: shownRefund[m] })) : [],
    });
    if (!res.ok) {
      setErrors(res.errors);
      if (res.creditNote) setTick((t) => t + 1);
      notify(res.errors[0] ?? returnsT('failed'), 'error');
      return;
    }
    const cn = res.creditNote!;
    if (settlement === 'exchange' && res.row) {
      onExchange(res.row);
      notify(returnsT('savedExchange', { number: cn.invoice_number, amount: formatCurrency(res.row.amount) }));
    } else if (settlement === 'refund') {
      notify(returnsT('savedRefund', { number: cn.invoice_number, amount: formatCurrency(res.row?.amount ?? 0) }));
    } else {
      notify(returnsT('savedAccount', { number: cn.invoice_number }));
    }
    setBillId('');
    setQty({});
    setCode('');
    setTick((t) => t + 1);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={returnsT('title')}
      subtitle={returnsT('subtitle')}
      footer={
        <>
          <button type="button" className={controls.btnGhost} onClick={onClose}>{returnsT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={!bill || !plan?.credit}>
            <RotateCcw size={16} /> {returnsT('save')}
          </button>
        </>
      }
    >
      <div className={own.stack}>
        <form
          className={own.find}
          onSubmit={(e) => {
            e.preventDefault();
            pick(findBillByNumber(code, data.invoices));
          }}
        >
          <label className={controls.field}>
            <span className={controls.label}>{returnsT('billNumber')}</span>
            <input id="ret-bill" className={controls.input} value={code} autoFocus onChange={(e) => setCode(e.target.value)} placeholder={returnsT('billPlaceholder')} />
          </label>
          <button type="submit" className={controls.btnOutline}><Search size={16} /> {returnsT('find')}</button>
          <label className={controls.field}>
            <span className={controls.label}>{returnsT('recent')}</span>
            <select
              id="ret-recent"
              className={controls.select}
              value={billId}
              onChange={(e) => pick(data.invoices.find((i) => i.id === e.target.value) ?? null)}
            >
              <option value="">{returnsT('pickBill')}</option>
              {recent.map((i) => (
                <option key={i.id} value={i.id}>{`${i.invoice_number} · ${formatDate(i.issue_date)} · ${formatCurrency(i.total)}`}</option>
              ))}
            </select>
          </label>
        </form>

        {bill && plan && (
          <>
            <p className={styles.muted}>
              {returnsT('billLine', { number: bill.invoice_number, date: formatDate(bill.issue_date), party: bill.client?.name || WALK_IN_NAME, total: formatCurrency(bill.total) })}
            </p>
            <div className={own.lines}>
            <table className={surface.table} aria-label={returnsT('linesLabel')}>
              <thead>
                <tr>
                  <th>{returnsT('colItem')}</th>
                  <th className={surface.numeric}>{returnsT('colSold')}</th>
                  <th className={surface.numeric}>{returnsT('colReturnable')}</th>
                  <th className={surface.numeric}>{returnsT('colReturn')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((l, n) => (
                  <tr key={l.item.id}>
                    <td>{l.item.name}{num(l.item.rate) === 0 ? ` (${returnsT('free')})` : ''}</td>
                    <td className={surface.numeric}>{l.originalQty}</td>
                    <td className={surface.numeric}>{l.remainingQty}</td>
                    <td className={surface.numeric}>
                      <div className={own.qty}>
                        <NumberInput
                          className={cn(controls.input, controls.inputNumeric, styles.qtyInput)}
                          value={qty[l.item.id] ?? 0}
                          onChange={(q) => setQty((cur) => ({ ...cur, [l.item.id]: Math.min(Math.max(q, 0), l.remainingQty) }))}
                          disabled={l.remainingQty <= 0}
                          aria-label={returnsT('qtyLabel', { name: l.item.name, n: String(n + 1) })}
                        />
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} disabled={l.remainingQty <= 0} onClick={() => setQty((cur) => ({ ...cur, [l.item.id]: l.remainingQty }))}>
                          {returnsT('all')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className={styles.totals}>
              <div className={styles.grand}><span>{returnsT('creditTotal')}</span><span data-ret-total>{formatCurrency(plan.amount)}</span></div>
              <div><span>{returnsT('refundable')}</span><span>{formatCurrency(plan.refundable)}</span></div>
            </div>

            <fieldset className={own.settle}>
              <legend className={controls.label}>{returnsT('settleLegend')}</legend>
              <label className={controls.check}>
                <input type="radio" name="ret-settle" checked={settlement === 'refund'} onChange={() => setSettlement('refund')} disabled={plan.refundable <= 0} />
                {returnsT('settleRefund')}
              </label>
              <label className={controls.check}>
                <input type="radio" name="ret-settle" checked={settlement === 'exchange'} onChange={() => setSettlement('exchange')} disabled={plan.refundable <= 0} />
                {returnsT('settleExchange')}
              </label>
              <label className={controls.check}>
                <input type="radio" name="ret-settle" checked={settlement === 'account'} onChange={() => setSettlement('account')} disabled={walkIn} />
                {returnsT('settleAccount')}
              </label>
              {walkIn && <p className={controls.hint}>{returnsT('walkInHint')}</p>}
            </fieldset>

            {settlement === 'refund' && (
              <div className={own.refunds}>
                {REFUND_METHODS.map((m) => (
                  <label key={m} className={controls.field}>
                    <span className={controls.label}>{returnsT('refundIn', { method: m })}</span>
                    <NumberInput
                      id={`ret-${m}`}
                      className={cn(controls.input, controls.inputNumeric)}
                      value={shownRefund[m]}
                      onChange={(v) => {
                        setTouched(true);
                        setRefund({ ...shownRefund, [m]: v });
                      }}
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            )}
            {settlement === 'exchange' && <p className={controls.hint}>{returnsT('exchangeHint')}</p>}
          </>
        )}

        {(errors.length > 0 || (plan && plan.errors.length > 0 && picks.length > 0)) && (
          <ul className={styles.errors} role="alert">
            {(errors.length ? errors : plan?.errors ?? []).map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <p className={controls.hint}>{returnsT('footnote')}</p>
      </div>
    </Modal>
  );
}
