/**
 * "RCM self-invoice" tab of the GST reports page (7O, 7.92): reverse-charge bills from unregistered suppliers,
 * self-invoices (Sec 31(3)(f) / Rule 46 — one per bill or consolidated for a month) and Rule 52 payment
 * vouchers, numbered in Indian-FY series (`RCM/FY…`, `RPV/FY…`), printable. Lazy-loaded.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, FilePlus2, Printer, Trash2 } from 'lucide-react';
import {
  RCM_DISCLAIMER,
  nextRcmNumber,
  rcmBills,
  rcmDocsDb,
  rcmDocsHtml,
  voucheredFor,
  type RcmDocument,
  type RcmParty,
} from '../../lib/rcm-self-invoice';
import { purchasesDb } from '../../lib/purchases';
import { localDb } from '../../lib/localDb';
import { todayIso } from '../../lib/tax-rules';
import { formatDate, formatMoney } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import PendingNote from '../ui/PendingNote';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { o7T } from '../../i18n/areas/gst-tds-7o';
import { printWhenReady } from '../../lib/print-fonts';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

export interface RcmDocsPanelProps {
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

type Draft =
  | { kind: 'SELF_INVOICE'; billIds: string[]; month?: string; date: string; number: string }
  | { kind: 'PAYMENT_VOUCHER'; billId: string; date: string; number: string; amount: string };

function recipient(): RcmParty {
  const p = localDb.settings.activeProfile();
  return {
    name: p?.companyName?.trim() || 'Your business',
    ...(p?.companyAddress?.trim() ? { address: p.companyAddress.trim() } : {}),
    ...(p?.companyGstin?.trim() ? { gstin: p.companyGstin.trim().toUpperCase() } : {}),
    ...((p?.stateCode || p?.companyGstin?.slice(0, 2)) ? { state_code: p?.stateCode || p?.companyGstin?.slice(0, 2) } : {}),
  };
}

function print(docs: RcmDocument[], name: string) {
  const html = rcmDocsHtml(docs, name);
  const w = window.open('', '_blank');
  if (!w) {
    downloadText(`${name.replace(/[\\/]/g, '-')}.html`, html, 'text/html');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  printWhenReady(w);
}

export function RcmDocsPanel({ notify }: RcmDocsPanelProps) {
  useT();
  const [version, setVersion] = useState(0);
  const [allSuppliers, setAllSuppliers] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<RcmDocument | null>(null);
  const today = todayIso();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the tables after a change
  const docs = useMemo(() => rcmDocsDb.all(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const purchases = useMemo(() => purchasesDb.all(), [version]);
  const bills = useMemo(() => rcmBills(purchases, docs, !allSuppliers), [purchases, docs, allSuppliers]);
  const months = useMemo(() => [...new Set(bills.filter((b) => b.unregistered && !b.selfInvoice).map((b) => b.date.slice(0, 7)))].sort().reverse(), [bills]);
  const refresh = () => setVersion((v) => v + 1);

  const startSelf = (billIds: string[], month?: string) => {
    const date = month ? lastDayOf(month, today) : today;
    setDraft({ kind: 'SELF_INVOICE', billIds, ...(month ? { month } : {}), date, number: nextRcmNumber('SELF_INVOICE', date, docs) });
  };
  const startVoucher = (billId: string) => {
    const b = bills.find((x) => x.id === billId);
    const left = b ? Math.max(b.supplierPayable - voucheredFor(docs, billId), 0) : 0;
    setDraft({ kind: 'PAYMENT_VOUCHER', billId, date: today, number: nextRcmNumber('PAYMENT_VOUCHER', today, docs), amount: left ? left.toFixed(2) : '' });
  };

  const save = () => {
    if (!draft) return;
    try {
      const rec = recipient();
      const doc = draft.kind === 'SELF_INVOICE'
        ? rcmDocsDb.create('SELF_INVOICE', { date: draft.date, number: draft.number, recipient: rec, bills: purchases.filter((p) => draft.billIds.includes(p.id)), ...(draft.month ? { consolidatedMonth: draft.month } : {}) })
        : rcmDocsDb.create('PAYMENT_VOUCHER', { date: draft.date, number: draft.number, recipient: rec, bill: purchases.find((p) => p.id === draft.billId), amount: Number(draft.amount) || 0 });
      notify(o7T('rcmSaved', { number: doc.number }), 'success');
      setDraft(null);
      refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const setDate = (date: string) => {
    if (!draft) return;
    // Re-number when the date moves into another FY (the series is per Indian FY).
    setDraft({ ...draft, date, number: nextRcmNumber(draft.kind, date || today, docs) } as Draft);
  };

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-rcm-docs>
      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, color: 'var(--sys-orange-ink)' }} />
        <span>{RCM_DISCLAIMER}</span>
      </div>
      <p className={styles.muted}>{o7T('rcmIntro')}</p>
      <PendingNote area="rcm_self" day={today} />

      <div className={styles.bar}>
        <div className={styles.checks}>
          <label className={controls.check}>
            <input type="checkbox" checked={allSuppliers} onChange={(e) => setAllSuppliers(e.target.checked)} /> {o7T('rcmAllSuppliers')}
          </label>
        </div>
        {months.length > 0 && (
          <label>
            {o7T('rcmConsolidate')}
            <SelectField className={controls.select} value="" onChange={(e) => {
              const m = e.target.value;
              if (m) startSelf(bills.filter((b) => b.unregistered && !b.selfInvoice && b.date.startsWith(m)).map((b) => b.id), m);
            }}>
              <option value="">{o7T('rcmPickMonth')}</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </SelectField>
          </label>
        )}
      </div>

      {draft && (
        <form className={surface.card} style={{ padding: 'var(--space-3, 0.75rem)' }} onSubmit={(e) => { e.preventDefault(); save(); }} data-rcm-draft>
          <h3 className={local.tbHeading}>
            {draft.kind === 'SELF_INVOICE'
              ? (draft.month ? o7T('rcmNewConsolidated', { month: draft.month, n: draft.billIds.length }) : o7T('rcmNewSelf'))
              : o7T('rcmNewVoucher')}
          </h3>
          <div className={styles.bar}>
            <label>
              {o7T('rcmDate')}
              <DateField className={controls.input} value={draft.date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              {o7T('rcmNumber')}
              <input className={`${controls.input} ${controls.inputMono}`} maxLength={16} value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value } as Draft)} required />
            </label>
            {draft.kind === 'PAYMENT_VOUCHER' && (
              <label>
                {o7T('rcmAmount')}
                <input type="number" min={0} step="0.01" className={controls.input} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required />
              </label>
            )}
          </div>
          <div className={styles.actions} style={{ marginTop: '0.75rem' }}>
            <button type="submit" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}>{o7T('rcmSave')}</button>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setDraft(null)}>{o7T('rcmCancel')}</button>
          </div>
        </form>
      )}

      <h3 className={local.tbHeading}>{o7T('rcmBillsTitle')}</h3>
      {bills.length === 0 ? (
        <p className={surface.sectionNote}>{o7T('rcmNoBills')}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label={o7T('rcmBillsTitle')}>
            <thead>
              <tr>
                <th scope="col">{o7T('rcmColBill')}</th>
                <th scope="col">{o7T('rcmColSupplier')}</th>
                <th scope="col">{o7T('rcmColTaxable')}</th>
                <th scope="col">{o7T('rcmColTax')}</th>
                <th scope="col">{o7T('rcmColSelf')}</th>
                <th scope="col">{o7T('rcmColVouchers')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const late = !b.selfInvoice && b.selfInvoiceDue && today > b.selfInvoiceDue;
                return (
                  <tr key={b.id}>
                    <th scope="row">{b.number || '-'}<div className={styles.muted}>{formatDate(b.date)}</div></th>
                    <td>{b.supplierName}{!b.unregistered && <div className={styles.muted}>{b.supplierGstin}</div>}</td>
                    <td>{formatMoney(b.taxable)}</td>
                    <td>{formatMoney(b.igst + b.cgst + b.sgst + b.cess)}</td>
                    <td className={late ? styles.bad : undefined}>
                      {b.selfInvoice || (b.unregistered ? (b.selfInvoiceDue ? o7T('rcmDueBy', { date: formatDate(b.selfInvoiceDue) }) : o7T('rcmPending')) : o7T('rcmSupplierInvoices'))}
                    </td>
                    <td>{b.vouchers.join(', ') || '-'}</td>
                    <td>
                      <span className={styles.actions}>
                        {b.unregistered && !b.selfInvoice && (
                          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => startSelf([b.id])}>
                            <FilePlus2 size={14} aria-hidden /> {o7T('rcmSelfBtn')}
                          </button>
                        )}
                        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => startVoucher(b.id)}>
                          <FilePlus2 size={14} aria-hidden /> {o7T('rcmVoucherBtn')}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className={local.tbHeading}>{o7T('rcmDocsTitle')}</h3>
      {docs.length === 0 ? (
        <p className={surface.sectionNote}>{o7T('rcmNoDocs')}</p>
      ) : (
        <>
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => print(docs, 'RCM documents')}>
              <Printer size={14} aria-hidden /> {o7T('rcmPrintAll')}
            </button>
          </div>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label={o7T('rcmDocsTitle')}>
              <thead>
                <tr>
                  <th scope="col">{o7T('rcmNumber')}</th>
                  <th scope="col">{o7T('rcmDate')}</th>
                  <th scope="col">{o7T('rcmColKind')}</th>
                  <th scope="col">{o7T('rcmColSupplier')}</th>
                  <th scope="col">{o7T('rcmColTaxable')}</th>
                  <th scope="col">{o7T('rcmColTax')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.number}</th>
                    <td>{formatDate(d.date)}</td>
                    <td>{d.kind === 'SELF_INVOICE' ? (d.consolidated_month ? o7T('rcmKindConsolidated', { month: d.consolidated_month }) : o7T('rcmKindSelf')) : o7T('rcmKindVoucher')}</td>
                    <td>{d.supplier.name}</td>
                    <td>{formatMoney(d.taxable)}</td>
                    <td>{formatMoney(d.igst + d.cgst + d.sgst + d.cess)}</td>
                    <td>
                      <span className={styles.actions}>
                        <button type="button" className={controls.btnIcon} aria-label={o7T('rcmPrint', { number: d.number })} title={o7T('rcmPrint', { number: d.number })} onClick={() => print([d], d.number)}><Printer size={15} /></button>
                        <button type="button" className={controls.btnIcon} aria-label={o7T('rcmDelete', { number: d.number })} title={o7T('rcmDelete', { number: d.number })} onClick={() => setDeleting(d)}><Trash2 size={15} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ul className={local.notes}>
        <li>{o7T('rcmNoteSeries')}</li>
        <li>{o7T('rcmNoteTime')}</li>
        <li>{o7T('rcmNoteBooks')}</li>
      </ul>

      <ConfirmDialog
        open={!!deleting}
        title={o7T('rcmDelete', { number: deleting?.number ?? '' })}
        message={o7T('rcmDeleteMsg', { number: deleting?.number ?? '' })}
        confirmLabel={o7T('rcmDeleteConfirm')}
        destructive
        onConfirm={() => {
          const d = deleting;
          setDeleting(null);
          if (!d) return;
          try {
            rcmDocsDb.remove(d.id);
            refresh();
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error');
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/** Last day of `month` (YYYY-MM), or `today` when the month is the current one. */
function lastDayOf(month: string, today: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  return last > today ? today : last;
}

export default RcmDocsPanel;
