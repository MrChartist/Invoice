import { Fragment, useMemo, useState } from 'react';
import { Download, Gift, Printer } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useCan } from '../../hooks/useCan';
import { useToast } from '../ui/useToast';
import {
  GV_CA_NOTE, expiryFrom, giftVouchersDb, gvHistory, gvRegister, gvRegisterCsv, readGvSettings, saveGvSettings,
} from '../../lib/retail/gift-vouchers';
import { peekTable } from '../../lib/storage';
import { loadBranches } from '../../lib/branch';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import type { GiftVoucher } from '../../types/stores-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import { printGiftVoucherSlips } from './GiftVoucherSlip';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

const SALE_METHODS = ['Cash', 'UPI', 'Card', 'Cheque', 'Bank transfer'];

/**
 * Gift vouchers (R4-B1), a tab of /receivables: sell / issue (bulk), the register by branch and period with CSV,
 * a per-voucher history, cancel with refund, and "Recognise unredeemed balance" (breakage) with undo.
 */
export default function GiftVouchersPanel() {
  useT();
  const { can } = useCan();
  const { notify, toastNode } = useToast();
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const settings = useMemo(() => readGvSettings(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const branches = useMemo(() => loadBranches(), []);
  const business = useMemo(() => localDb.settings.activeProfile()?.companyName ?? '', []);
  const [sell, setSell] = useState({ count: 1, face: 1000, date: today, buyer: '', branch: '', method: 'Cash', promo: false, expires: '' });
  const [period, setPeriod] = useState({ from: '', to: '', branch: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<GiftVoucher | null>(null);
  const [lastSold, setLastSold] = useState<GiftVoucher[]>([]);
  const [form, setForm] = useState(settings);

  const vouchers = useMemo(() => giftVouchersDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const payments = useMemo(() => peekTable<Payment>('transactions'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => peekTable<InvoiceRecord>('invoices'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reg = useMemo(() => gvRegister(vouchers, payments, invoices, { ...period, day: today }), [vouchers, payments, invoices, period, today]);
  const breakage = useMemo(() => giftVouchersDb.breakageDue(today), [tick, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const journals = useMemo(() => [...new Set(vouchers.map((v) => v.breakage_voucher_id).filter((x): x is string => !!x))], [vouchers]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—';

  const run = (fn: () => string) => {
    try {
      notify(fn(), 'success');
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const doSell = () => run(() => {
    const out = giftVouchersDb.sell({
      count: sell.count, face_value: sell.face, issued_on: sell.date, buyer: sell.buyer, branch_id: sell.branch || undefined,
      promo: sell.promo, method: sell.method, ...(sell.expires ? { expires_on: sell.expires } : {}),
    });
    setSell((s) => ({ ...s, buyer: '', expires: '' }));
    setLastSold(out.vouchers);
    return out.receipt ? sT('gvSold', { n: out.vouchers.length, receipt: out.receipt }) : sT('gvIssued', { n: out.vouchers.length });
  });

  const t = reg.totals;
  return (
    <section className={surface.card} aria-label={sT('gvTitle')}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><Gift size={16} /> {sT('gvTitle')}</span></div>
      <div className={cn(surface.cardBody, css.stack)}>
        <p className={css.note}>{GV_CA_NOTE}</p>

        {can('doc.create') && (
          <div className={css.box} data-gv-sell>
            <div className={css.boxHead}>{sT('gvSellTitle')}</div>
            <div className={css.bar}>
              <label className={controls.field}><span className={controls.label}>{sT('gvCount')}</span><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={sell.count} onChange={(v) => setSell({ ...sell, count: v })} data-gv-count /></label>
              <label className={controls.field}><span className={controls.label}>{sT('gvFace')}</span><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={sell.face} onChange={(v) => setSell({ ...sell, face: v })} data-gv-face /></label>
              <label className={controls.field}><span className={controls.label}>{sT('date')}</span><input type="date" className={controls.input} value={sell.date} onChange={(e) => setSell({ ...sell, date: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{sT('gvExpires')}</span><input type="date" className={controls.input} value={sell.expires || (sell.date ? expiryFrom(sell.date, settings.validity_months) : '')} onChange={(e) => setSell({ ...sell, expires: e.target.value })} /></label>
              <label className={cn(controls.field, css.grow)}><span className={controls.label}>{sT('gvBuyer')}</span><input className={controls.input} value={sell.buyer} onChange={(e) => setSell({ ...sell, buyer: e.target.value })} /></label>
              {branches.length > 0 && (
                <label className={controls.field}><span className={controls.label}>{sT('branch')}</span>
                  <select className={controls.select} value={sell.branch} onChange={(e) => setSell({ ...sell, branch: e.target.value })}>
                    <option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
              {!sell.promo && (
                <label className={controls.field}><span className={controls.label}>{sT('gvPaidBy')}</span>
                  <select className={controls.select} value={sell.method} onChange={(e) => setSell({ ...sell, method: e.target.value })}>
                    {SALE_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className={controls.check}><input type="checkbox" checked={sell.promo} onChange={(e) => setSell({ ...sell, promo: e.target.checked })} /> {sT('gvPromoIssue')}</label>
            <div className={css.actions}>
              <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={doSell} data-gv-sell-save>
                <Gift size={14} aria-hidden="true" /> {sell.promo ? sT('gvIssueBtn') : sT('gvSellBtn', { amount: formatCurrency(sell.count * sell.face) })}
              </button>
              {lastSold.length > 0 && (
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => printGiftVoucherSlips(lastSold, business)} data-gv-print-last>
                  <Printer size={14} aria-hidden="true" /> {sT('gvPrintSlips', { n: lastSold.length })}
                </button>
              )}
            </div>
            <p className={css.note}>{sell.promo ? sT('gvPromoHint') : sT('gvSellHint')}</p>
          </div>
        )}

        <div className={css.bar}>
          <label className={controls.field}><span className={controls.label}>{sT('from')}</span><input type="date" className={controls.input} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
          <label className={controls.field}><span className={controls.label}>{sT('to')}</span><input type="date" className={controls.input} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
          {branches.length > 0 && (
            <label className={controls.field}><span className={controls.label}>{sT('branch')}</span>
              <select className={controls.select} value={period.branch} onChange={(e) => setPeriod({ ...period, branch: e.target.value })}>
                <option value="">{sT('allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => downloadText(`gift-vouchers-${today}.csv`, gvRegisterCsv(reg, branchName), 'text/csv')}>
            <Download size={14} aria-hidden="true" /> {sT('csv')}
          </button>
        </div>
        <div className={css.stats}>
          <div className={css.stat}><span className={css.statLabel}>{sT('gvIssuedN')}</span><span className={css.statValue}>{t.issued}</span></div>
          <div className={css.stat}><span className={css.statLabel}>{sT('gvSoldValue')}</span><span className={css.statValue}>{formatCurrency(t.soldValue)}</span></div>
          <div className={css.stat}><span className={css.statLabel}>{sT('gvRedeemed')}</span><span className={css.statValue}>{formatCurrency(t.redeemed)}</span></div>
          <div className={css.stat}><span className={css.statLabel}>{sT('gvOutstanding')}</span><span className={css.statValue} data-gv-outstanding>{formatCurrency(t.balance)}</span></div>
          <div className={css.stat}><span className={css.statLabel}>{sT('gvExpired')}</span><span className={css.statValue}>{formatCurrency(t.expired)}</span></div>
        </div>
        {branches.length > 0 && reg.byBranch.length > 1 && (
          <div className={css.wrap}>
            <table className={surface.table}>
              <thead><tr><th>{sT('branch')}</th><th className={css.num}>{sT('gvIssuedN')}</th><th className={css.num}>{sT('gvSoldValue')}</th><th className={css.num}>{sT('gvRedeemed')}</th><th className={css.num}>{sT('gvOutstanding')}</th></tr></thead>
              <tbody>{reg.byBranch.map((b) => (
                <tr key={b.branch_id}><td>{b.branch_id ? branchName(b.branch_id) : sT('noBranch')}</td><td className={css.num}>{b.totals.issued}</td><td className={css.num}>{formatCurrency(b.totals.soldValue)}</td><td className={css.num}>{formatCurrency(b.totals.redeemed)}</td><td className={css.num}>{formatCurrency(b.totals.balance)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}

        <div className={css.wrap}>
          <table className={surface.table} data-gv-register>
            <thead><tr><th>{sT('number')}</th><th>{sT('gvCode')}</th><th className={css.num}>{sT('gvFace')}</th><th>{sT('gvExpires')}</th><th>{sT('gvBuyer')}</th><th className={css.num}>{sT('balance')}</th><th>{sT('status')}</th><th><span className={surface.srOnly}>{sT('actions')}</span></th></tr></thead>
            <tbody>
              {reg.rows.map(({ voucher: v, state }) => (
                <Fragment key={v.id}>
                  <tr>
                    <td className={css.mono}>{v.number}{v.promo ? ` · ${sT('gvPromo')}` : ''}</td>
                    <td className={css.mono}>{v.code}</td>
                    <td className={css.num}>{formatCurrency(v.face_value)}</td>
                    <td>{formatDate(v.expires_on)}</td>
                    <td>{v.buyer ?? ''}</td>
                    <td className={css.num}>{formatCurrency(state.balance)}</td>
                    <td><span className={cn(css.chip, css[state.status])}>{sT(`st.${state.status}`)}</span></td>
                    <td className={css.actions}>
                      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>{sT('history')}</button>
                      <button type="button" className={controls.btnIcon} aria-label={sT('gvPrint', { number: v.number })} onClick={() => printGiftVoucherSlips([v], business)}><Printer size={14} /></button>
                      {can('doc.deleteIssued') && state.status !== 'cancelled' && state.redeemed + state.promoUsed === 0 && !v.breakage_voucher_id && (
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setCancelling(v)}>{sT('gvCancel')}</button>
                      )}
                    </td>
                  </tr>
                  {open === v.id && (
                    <tr><td colSpan={8}>
                      <ul className={css.stack}>
                        {gvHistory(v, payments, invoices).map((h, i) => <li key={i} className={css.applied}><span>{formatDate(h.date)} · {h.what}{h.ref ? ` · ${h.ref}` : ''}</span><strong>{formatCurrency(h.amount)}</strong></li>)}
                      </ul>
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {reg.rows.length === 0 && <tr><td colSpan={8} className={css.muted}>{sT('gvNone')}</td></tr>}
            </tbody>
          </table>
        </div>

        {can('books.edit') && (breakage.length > 0 || journals.length > 0) && (
          <div className={css.box}>
            <div className={css.boxHead}>{sT('gvBreakage')}</div>
            {breakage.length > 0 && (
              <div className={css.applied}>
                <span>{sT('gvBreakageDue', { n: breakage.length, amount: formatCurrency(breakage.reduce((s, r) => s + r.balance, 0)) })}</span>
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => { const r = giftVouchersDb.recogniseBreakage(today, today); return sT('gvBreakageDone', { journal: r.journal, amount: formatCurrency(r.amount) }); })}>{sT('gvRecognise')}</button>
              </div>
            )}
            {journals.map((j) => (
              <div key={j} className={css.applied}>
                <span>{sT('gvBreakageJournal', { n: vouchers.filter((v) => v.breakage_voucher_id === j).length })}</span>
                <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => sT('gvUndone', { n: giftVouchersDb.undoBreakage(j) }))}>{sT('undo')}</button>
              </div>
            ))}
            <p className={css.note}>{sT('gvBreakageHint')}</p>
          </div>
        )}

        {can('settings.manage') && (
          <details>
            <summary>{sT('settings')}</summary>
            <div className={css.bar}>
              <label className={controls.field}><span className={controls.label}>{sT('gvValidity')}</span><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={form.validity_months} onChange={(v) => setForm({ ...form, validity_months: v })} /></label>
              <label className={controls.field}><span className={controls.label}>{sT('gvPrefix')}</span><input className={cn(controls.input, css.gridInput)} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} /></label>
              <label className={controls.check}><input type="checkbox" checked={form.allow_partial} onChange={(e) => setForm({ ...form, allow_partial: e.target.checked })} /> {sT('gvPartial')}</label>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => { saveGvSettings(form); return sT('saved'); })}>{sT('save')}</button>
            </div>
          </details>
        )}
      </div>
      <ConfirmDialog
        open={!!cancelling}
        destructive
        title={sT('gvCancelTitle', { number: cancelling?.number ?? '' })}
        message={cancelling?.promo ? sT('gvCancelPromoMsg') : sT('gvCancelMsg', { amount: formatCurrency(cancelling?.face_value ?? 0) })}
        confirmLabel={sT('gvCancel')}
        onClose={() => setCancelling(null)}
        onConfirm={() => {
          const v = cancelling;
          setCancelling(null);
          if (v) run(() => { giftVouchersDb.cancel(v.id, today); return sT('gvCancelled', { number: v.number }); });
        }}
      />
      {toastNode}
    </section>
  );
}
