/**
 * Banking documents (WP-5): deposit slip, payment advice, bulk e-payment file and day-end cash tally.
 * Lazy-loaded from the Reconcile page (`/reconcile?tab=documents&doc=deposit|advice|epay|cash`).
 * Printed documents stay in English (bank forms); screen labels go through `bnkT`.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, Save } from 'lucide-react';
import { bankAccountsDb, DEFAULT_BANK_ID, maskAccountNo, pickableBankAccounts, type BankAccount } from '../../../lib/bank-accounts';
import { loadCheques } from '../../../lib/cheques';
import { DENOMINATIONS, cashTotal, type DenominationCounts } from '../../../lib/denominations';
import { depositSlipView, depositableCheques, loadDepositSlips, saveDepositSlip, type DepositSlipView } from '../../../lib/deposit-slip';
import { buildPaymentAdvice, supplierPaymentRefs, type PaymentAdvice } from '../../../lib/payment-advice';
import { UPLOAD_PRESETS, buildUploadFile, suggestMode, validateUpload, type UploadMode, type UploadPreset, type UploadRow } from '../../../lib/bank-upload';
import { loadCashTallies, saveCashTally, tallyCash } from '../../../lib/cash-tally';
import { accountBalanceAt, buildVouchers, loadBooksData } from '../../../lib/books';
import { paymentsDb, purchasesDb } from '../../../lib/purchases';
import { vendorBalances, vendorsDb } from '../../../lib/vendors';
import { vendorPaymentsDb } from '../../../lib/billwise';
import { formatDate, formatMoney, todayInput } from '../../../lib/utils';
import type { Vendor } from '../../../types/purchases';
import { useT } from '../../../i18n';
import { bnkT } from '../../../i18n/areas/banking';
import { fxbT } from '../../../i18n/areas/extras-7u';
import { epayAmountsOverLimit, saveEpayBatch, type EpayBatch } from '../../../lib/epay-confirm';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import styles from './bankdocs.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
// 7U: forex bank ledgers and e-payment confirmation, loaded only when opened.
const ForexBankPanel = lazy(() => import('./ForexBankPanel'));
const EpayConfirmPanel = lazy(() => import('./EpayConfirmPanel'));

export type BankDoc = 'deposit' | 'advice' | 'epay' | 'cash' | 'forex';
const DOCS: { id: Exclude<BankDoc, 'forex'>; label: 'docDeposit' | 'docAdvice' | 'docEpay' | 'docCash' }[] = [
  { id: 'deposit', label: 'docDeposit' },
  { id: 'advice', label: 'docAdvice' },
  { id: 'epay', label: 'docEpay' },
  { id: 'cash', label: 'docCash' },
];
const rupees = (n: number) => `₹${formatMoney(n)}`;

/** Print `node` alone (same pattern as the BRS print). */
function usePrint(): [boolean, () => void] {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('bank-doc-printing');
    const done = () => {
      document.body.classList.remove('bank-doc-printing');
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('bank-doc-printing');
    };
  }, [printing]);
  return [printing, () => setPrinting(true)];
}

function PrintPortal({ show, children }: { show: boolean; children: React.ReactNode }) {
  return show ? createPortal(<div className={styles.printRoot}>{children}</div>, document.body) : null;
}

function DenominationGrid({ counts, onChange }: { counts: DenominationCounts; onChange: (c: DenominationCounts) => void }) {
  return (
    <div className={styles.denoms}>
      {DENOMINATIONS.map((d) => (
        <label key={d} className={styles.denom}>
          <span className={styles.denomLabel}>₹{d} ×</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" aria-label={`₹${d} ${bnkT('count')}`} value={counts[String(d)] ? String(counts[String(d)]) : ''}
            onChange={(e) => onChange({ ...counts, [String(d)]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </label>
      ))}
    </div>
  );
}

function AccountSelect({ id, label, accounts, value, onChange }: { id: string; label: string; accounts: BankAccount[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className={controls.field} htmlFor={id}>
      <span className={controls.label}>{label}</span>
      <select id={id} className={controls.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}{a.account_no ? ` (${maskAccountNo(a.account_no)})` : ''}</option>
        ))}
      </select>
    </label>
  );
}

/* ── Deposit slip ─────────────────────────────────────────── */

function SlipDocument({ v }: { v: DepositSlipView }) {
  return (
    <div className={styles.doc}>
      <h1>Pay-in slip {v.number}</h1>
      <div className={styles.docMeta}>
        <span>Date: {formatDate(v.date)}</span>
        <span>Account name: {v.accountName}</span>
        <span>Account no.: {v.accountNo || '________________'}</span>
        <span>IFSC / branch: {[v.ifsc, v.branch].filter(Boolean).join(' / ') || '—'}</span>
        <span>Depositor: {v.depositor || '________________'}</span>
      </div>
      {v.cheques.length > 0 && (
        <table>
          <thead><tr><th>Cheque no.</th><th>Drawn on (bank / branch)</th><th>Date</th><th>Drawer</th><th className="num">Amount (₹)</th></tr></thead>
          <tbody>
            {v.cheques.map((c) => (
              <tr key={c.number + c.bank}><td>{c.number}</td><td>{[c.bank, c.branch].filter(Boolean).join(', ')}</td><td>{formatDate(c.date)}</td><td>{c.party}</td><td className={styles.num}>{formatMoney(c.amount)}</td></tr>
            ))}
            <tr><td colSpan={4}><strong>Total cheques</strong></td><td className={styles.num}><strong>{formatMoney(v.chequeTotal)}</strong></td></tr>
          </tbody>
        </table>
      )}
      {v.cashTotal > 0 && (
        <table>
          <thead><tr><th>Denomination</th><th className="num">Pieces</th><th className="num">Amount (₹)</th></tr></thead>
          <tbody>
            {v.cash.filter((r) => r.count > 0).map((r) => (
              <tr key={r.value}><td>₹{r.value}</td><td className={styles.num}>{r.count}</td><td className={styles.num}>{formatMoney(r.amount)}</td></tr>
            ))}
            <tr><td colSpan={2}><strong>Total cash</strong></td><td className={styles.num}><strong>{formatMoney(v.cashTotal)}</strong></td></tr>
          </tbody>
        </table>
      )}
      <p><strong>Grand total: ₹{formatMoney(v.total)}</strong> — {v.words}</p>
      <p>Signature of depositor: ____________________</p>
    </div>
  );
}

function DepositSlipPanel({ notify }: { notify: Notify }) {
  const [accounts] = useState(() => pickableBankAccounts('cheque')); // R5-A2: no clearing accounts
  const [date, setDate] = useState(todayInput());
  const [accountId, setAccountId] = useState(DEFAULT_BANK_ID);
  const [depositor, setDepositor] = useState('');
  const [cheques, setCheques] = useState(() => loadCheques());
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [cash, setCash] = useState<DenominationCounts>({});
  const [slips, setSlips] = useState(() => loadDepositSlips());
  const [view, setView] = useState<DepositSlipView | null>(null);
  const [contra, setContra] = useState(true);
  const [printing, print] = usePrint();
  const today = todayInput();
  const inHand = useMemo(() => depositableCheques(cheques, date > today ? today : date), [cheques, date, today]);
  const chosen = inHand.filter((c) => picked[c.id]);
  const account = accounts.find((a) => a.id === accountId);
  const draft = depositSlipView({ number: '', date, cash, depositor }, chosen, account);

  const save = () => {
    try {
      const slip = saveDepositSlip({ date, bank_account_id: accountId, cheque_ids: chosen.map((c) => c.id), cash, depositor, post_cash_contra: contra }, today);
      const all = loadCheques();
      setCheques(all);
      setSlips(loadDepositSlips());
      setPicked({});
      setCash({});
      setView(depositSlipView(slip, slip.cheque_ids.map((id) => all.find((c) => c.id === id)!).filter(Boolean), account));
      notify(bnkT('slipSaved', { number: slip.number }) + (slip.cash_voucher_number ? ` ${fxbT('contraPosted', { number: slip.cash_voucher_number })}` : ''), 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const reprint = (id: string) => {
    const s = slips.find((x) => x.id === id);
    if (!s) return;
    setView(depositSlipView(s, s.cheque_ids.map((cid) => cheques.find((c) => c.id === cid)!).filter(Boolean), bankAccountsDb.all().find((a) => a.id === (s.bank_account_id ?? DEFAULT_BANK_ID))));
  };

  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{bnkT('date')}</span>
          <input className={controls.input} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <AccountSelect id="slip-account" label={bnkT('account')} accounts={accounts} value={accountId} onChange={setAccountId} />
        <label className={controls.field}><span className={controls.label}>{bnkT('depositor')}</span>
          <input className={controls.input} value={depositor} onChange={(e) => setDepositor(e.target.value)} /></label>
      </div>
      <section className={surface.card}>
        <div className={surface.cardHead}>{bnkT('chequesInHand')}</div>
        <div className={surface.cardBody}>
          {inHand.length === 0 ? <p className={styles.muted}>{bnkT('noChequesInHand')}</p> : (
            <ul className={styles.list}>
              {inHand.map((c) => (
                <li key={c.id} className={styles.listItem}>
                  <label className={controls.check}>
                    <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })} />
                    {c.number} · {c.bank} · {c.party_name} · {formatDate(c.cheque_date)}
                  </label>
                  <span className={styles.num}>{rupees(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className={surface.card}>
        <div className={surface.cardHead}>{bnkT('cash')}</div>
        <div className={surface.cardBody}>
          <DenominationGrid counts={cash} onChange={setCash} />
          <label className={controls.check}>
            <input type="checkbox" checked={contra} onChange={(e) => setContra(e.target.checked)} /> {fxbT('postContra')}
          </label>
          <p className={styles.muted}>{contra ? fxbT('contraNote') : bnkT('slipCashNote')}</p>
        </div>
      </section>
      <div className={styles.totals}>
        <span>{bnkT('chequeTotal')}: <strong>{rupees(draft.chequeTotal)}</strong></span>
        <span>{bnkT('cashTotal')}: <strong>{rupees(draft.cashTotal)}</strong></span>
        <span>{bnkT('total')}: <strong>{rupees(draft.total)}</strong></span>
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={controls.btnPrimary} onClick={save} disabled={!chosen.length && !(cashTotal(cash) > 0)}><Save size={16} /> {bnkT('saveSlip')}</button>
        {view && <button type="button" className={controls.btnOutline} onClick={print}><Printer size={16} /> {bnkT('print')} {view.number}</button>}
      </div>
      {view && <section className={surface.card}><div className={surface.cardBody}><SlipDocument v={view} /></div></section>}
      <section className={surface.card}>
        <div className={surface.cardHead}>{bnkT('recentSlips')}</div>
        <div className={surface.cardBody}>
          {slips.length === 0 ? <p className={styles.muted}>{bnkT('noSlips')}</p> : (
            <ul className={styles.list}>
              {[...slips].reverse().slice(0, 20).map((s) => (
                <li key={s.id} className={styles.listItem}>
                  <button type="button" className={controls.btnGhost} onClick={() => reprint(s.id)}>{s.number}</button>
                  <span>{formatDate(s.date)}</span>
                  <span className={styles.num}>{rupees(s.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <PrintPortal show={printing && !!view}>{view && <SlipDocument v={view} />}</PrintPortal>
    </div>
  );
}

/* ── Payment advice ───────────────────────────────────────── */

function AdviceDocument({ a }: { a: PaymentAdvice }) {
  return (
    <div className={styles.doc}>
      <h1>Payment advice</h1>
      <div className={styles.docMeta}>
        <span>To: {a.vendor}{a.vendorGstin ? ` (GSTIN ${a.vendorGstin})` : ''}</span>
        <span>Date: {formatDate(a.date)}</span>
        <span>Mode: {a.method}{a.reference ? ` · Ref ${a.reference}` : ''}</span>
        <span>Paid to: {a.vendorBank || '—'}</span>
        {a.paidFrom && <span>Paid from: {a.paidFrom}</span>}
      </div>
      <p>We have made the following payment to you:</p>
      <table>
        <thead><tr><th>Bill no.</th><th>Bill date</th><th className="num">Bill amount</th><th className="num">TDS deducted</th><th className="num">Paid now</th><th className="num">Balance</th></tr></thead>
        <tbody>
          {a.lines.map((l) => (
            <tr key={l.billNo + l.billDate}><td>{l.billNo}</td><td>{formatDate(l.billDate)}</td><td className={styles.num}>{formatMoney(l.billAmount)}</td><td className={styles.num}>{formatMoney(l.tdsOnBill + l.tdsNow)}</td><td className={styles.num}>{formatMoney(l.paid)}</td><td className={styles.num}>{formatMoney(l.balance)}</td></tr>
          ))}
          {a.onAccount > 0 && <tr><td colSpan={4}>{a.onAccountLabel}</td><td className={styles.num}>{formatMoney(a.onAccount)}</td><td /></tr>}
          <tr><td colSpan={3}><strong>Total</strong></td><td className={styles.num}><strong>{formatMoney(a.totalTds)}</strong></td><td className={styles.num}><strong>{formatMoney(a.totalPaid)}</strong></td><td /></tr>
        </tbody>
      </table>
      <p>Amount paid: ₹{formatMoney(a.totalPaid)} — {a.words}</p>
      {a.totalTds > 0 && <p>TDS of ₹{formatMoney(a.totalTds)} has been deducted and will be deposited with the government; the Form 16A certificate follows after the quarter.</p>}
    </div>
  );
}

function PaymentAdvicePanel() {
  const [input] = useState(() => ({ purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), vendors: vendorsDb.all(), bankAccounts: bankAccountsDb.all() }));
  const refs = useMemo(() => supplierPaymentRefs(input), [input]);
  const [key, setKey] = useState('');
  const advice = key ? buildPaymentAdvice(key, input) : null;
  const [printing, print] = usePrint();
  if (!refs.length) return <p className={styles.muted}>{bnkT('noPayments')}</p>;
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <label className={controls.field} style={{ minWidth: 320 }}>
          <span className={controls.label}>{bnkT('payment')}</span>
          <select className={controls.select} value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{bnkT('pickPayment')}</option>
            {refs.slice(0, 300).map((r) => (
              <option key={r.key} value={r.key}>{formatDate(r.date)} · {r.vendor} · {rupees(r.amount)}{r.reference ? ` · ${r.reference}` : ''}</option>
            ))}
          </select>
        </label>
        {advice && <button type="button" className={controls.btnOutline} onClick={print}><Printer size={16} /> {bnkT('print')}</button>}
      </div>
      {advice && <section className={surface.card}><div className={surface.cardBody}><AdviceDocument a={advice} /></div></section>}
      <PrintPortal show={printing && !!advice}>{advice && <AdviceDocument a={advice} />}</PrintPortal>
    </div>
  );
}

/* ── e-Payments ───────────────────────────────────────────── */

interface EpayRow { vendorId: string; amount: string; mode: UploadMode; reference: string }

function saveFile(name: string, text: string) {
  // No BOM: bank upload parsers often reject it.
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function VendorBankEditor({ vendor, onSaved, notify }: { vendor: Vendor; onSaved: () => void; notify: Notify }) {
  const [f, setF] = useState({ bank_account_no: vendor.bank_account_no ?? '', bank_ifsc: vendor.bank_ifsc ?? '', bank_name: vendor.bank_name ?? '', beneficiary_name: vendor.beneficiary_name ?? '' });
  const save = () => {
    try {
      vendorsDb.save({ ...vendor, bank_account_no: f.bank_account_no.replace(/\s+/g, '') || undefined, bank_ifsc: f.bank_ifsc.trim().toUpperCase() || undefined, bank_name: f.bank_name.trim() || undefined, beneficiary_name: f.beneficiary_name.trim() || undefined });
      onSaved();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={styles.grid}>
      <label className={controls.field}><span className={controls.label}>{bnkT('accountNo')}</span>
        <input className={`${controls.input} ${controls.inputMono}`} autoComplete="off" value={f.bank_account_no} onChange={(e) => setF({ ...f, bank_account_no: e.target.value })} /></label>
      <label className={controls.field}><span className={controls.label}>{bnkT('ifsc')}</span>
        <input className={`${controls.input} ${controls.inputMono}`} maxLength={11} value={f.bank_ifsc} onChange={(e) => setF({ ...f, bank_ifsc: e.target.value.toUpperCase() })} /></label>
      <label className={controls.field}><span className={controls.label}>{bnkT('bankName')}</span>
        <input className={controls.input} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></label>
      <label className={controls.field}><span className={controls.label}>{bnkT('beneficiary')}</span>
        <input className={controls.input} value={f.beneficiary_name} onChange={(e) => setF({ ...f, beneficiary_name: e.target.value })} /></label>
      <div className={styles.toolbar}><button type="button" className={controls.btnPrimary} onClick={save}>{bnkT('save')}</button></div>
    </div>
  );
}

function EPaymentsPanel({ notify }: { notify: Notify }) {
  const [accounts] = useState(() => pickableBankAccounts('epay')); // R5-A2: no clearing accounts
  const [vendors, setVendors] = useState(() => vendorsDb.all());
  const [preset, setPreset] = useState<UploadPreset>('generic');
  const [date, setDate] = useState(todayInput());
  const [accountId, setAccountId] = useState(DEFAULT_BANK_ID);
  const [rows, setRows] = useState<EpayRow[]>([]);
  const [editing, setEditing] = useState('');
  const [batches, setBatches] = useState(0);
  const byId = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const debit = accounts.find((a) => a.id === accountId)?.account_no ?? '';
  const uploadRows: UploadRow[] = rows.map((r) => {
    const v = byId.get(r.vendorId);
    return { beneficiary: v?.beneficiary_name || v?.name || '', accountNo: v?.bank_account_no ?? '', ifsc: v?.bank_ifsc ?? '', amount: Number(r.amount) || 0, mode: r.mode, reference: r.reference, email: v?.email, bankName: v?.bank_name, vendorId: r.vendorId };
  });
  const problems = rows.length ? validateUpload({ preset, date, debitAccountNo: debit, rows: uploadRows }) : [];
  const setRow = (i: number, patch: Partial<EpayRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const fillDue = () => {
    const due = vendorBalances(purchasesDb.all());
    setRows(vendors.filter((v) => (due.get(v.id)?.outstanding ?? 0) > 0).map((v) => {
      const amt = due.get(v.id)!.outstanding;
      return { vendorId: v.id, amount: String(amt), mode: suggestMode(amt), reference: 'Bills due' };
    }));
  };
  // 8.46: payments above the approval limit of a user who may not approve → the batch goes for approval, no file.
  const overLimit = epayAmountsOverLimit(uploadRows.map((r) => r.amount)).length;
  const download = () => {
    try {
      const f = buildUploadFile({ preset, date, debitAccountNo: debit, rows: uploadRows });
      // 7U: keep the batch so the payments can be recorded once the bank confirms.
      const batch = saveEpayBatch({ date, bank_account_id: accountId, preset, rows: uploadRows.map((r) => ({ vendorId: r.vendorId, vendorName: byId.get(r.vendorId ?? '')?.name ?? r.beneficiary, amount: r.amount, mode: r.mode, reference: r.reference, accountNo: r.accountNo })) }, { forApproval: overLimit > 0 });
      setBatches((n) => n + 1);
      if (batch.approval) return notify(fxbT('sentApproval', { number: batch.number }), 'info');
      saveFile(f.filename, f.text);
      notify(`${bnkT('downloaded', { n: f.count, amount: rupees(f.total) })} ${fxbT('batchKept', { number: batch.number })}`, 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  /** 8.46: the file of a batch the owner approved (bank details read from the supplier master now). */
  const batchFile = (b: EpayBatch) => {
    const vs = vendorsDb.all();
    const rowsOf: UploadRow[] = b.rows.map((r) => {
      const v = vs.find((x) => x.id === r.vendor_id);
      return { beneficiary: v?.beneficiary_name || v?.name || r.vendor_name, accountNo: v?.bank_account_no ?? '', ifsc: v?.bank_ifsc ?? '', amount: r.amount, mode: r.mode, reference: r.reference, email: v?.email, bankName: v?.bank_name, vendorId: r.vendor_id };
    });
    const f = buildUploadFile({ preset: b.preset, date: b.date, debitAccountNo: accounts.find((a) => a.id === (b.bank_account_id ?? DEFAULT_BANK_ID))?.account_no ?? '', rows: rowsOf });
    saveFile(f.filename, f.text);
  };
  const presetLabel = { generic: 'presetGeneric', hdfc: 'presetHdfc', icici: 'presetIcici', sbi: 'presetSbi' } as const;
  return (
    <div className={styles.stack}>
      <p className={styles.warn} role="note">{bnkT('epayIntro')}</p>
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{bnkT('preset')}</span>
          <select className={controls.select} value={preset} onChange={(e) => setPreset(e.target.value as UploadPreset)}>
            {UPLOAD_PRESETS.map((p) => <option key={p} value={p}>{bnkT(presetLabel[p])}</option>)}
          </select></label>
        <label className={controls.field}><span className={controls.label}>{bnkT('date')}</span>
          <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <AccountSelect id="epay-account" label={bnkT('paidFrom')} accounts={accounts} value={accountId} onChange={setAccountId} />
      </div>
      {rows.map((r, i) => {
        const v = byId.get(r.vendorId);
        return (
          <div key={i} className={styles.stack} style={{ gap: '0.375rem' }}>
            <div className={styles.rowEdit}>
              <label className={controls.field}><span className={controls.label}>{bnkT('vendor')}</span>
                <select className={controls.select} value={r.vendorId} onChange={(e) => setRow(i, { vendorId: e.target.value })}>
                  <option value="">—</option>
                  {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></label>
              <label className={controls.field}><span className={controls.label}>{bnkT('amount')}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
              <label className={controls.field}><span className={controls.label}>{bnkT('mode')}</span>
                <select className={controls.select} value={r.mode} onChange={(e) => setRow(i, { mode: e.target.value as UploadMode })}>
                  {(['NEFT', 'RTGS', 'IMPS', 'IFT'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
              <label className={controls.field}><span className={controls.label}>{bnkT('reference')}</span>
                <input className={controls.input} maxLength={30} value={r.reference} onChange={(e) => setRow(i, { reference: e.target.value })} /></label>
              <button type="button" className={controls.btnGhost} onClick={() => setRows(rows.filter((_, k) => k !== i))}>{bnkT('remove')}</button>
            </div>
            {v && (
              <span className={styles.muted}>
                {bnkT('bankDetails')}: {v.bank_account_no ? [v.bank_name, maskAccountNo(v.bank_account_no), v.bank_ifsc].filter(Boolean).join(' · ') : bnkT('noBankDetails')}{' '}
                <button type="button" className={controls.btnGhost} onClick={() => setEditing(editing === v.id ? '' : v.id)}>{bnkT('editBank')}</button>
              </span>
            )}
            {v && editing === v.id && <VendorBankEditor key={v.id} vendor={v} notify={notify} onSaved={() => { setVendors(vendorsDb.all()); setEditing(''); }} />}
          </div>
        );
      })}
      <div className={styles.toolbar}>
        <button type="button" className={controls.btnOutline} onClick={() => setRows([...rows, { vendorId: '', amount: '', mode: 'NEFT', reference: '' }])}>{bnkT('addRow')}</button>
        <button type="button" className={controls.btnOutline} onClick={fillDue}>{bnkT('fillDue')}</button>
        <button type="button" className={controls.btnPrimary} onClick={download} disabled={!rows.length || problems.length > 0}><Download size={16} /> {overLimit ? fxbT('sendApproval') : bnkT('download')}</button>
      </div>
      {overLimit > 0 && <p className={styles.warn} role="note">{fxbT('overLimit', { n: overLimit })}</p>}
      {problems.length > 0 && (
        <ul className={styles.list}>{problems.slice(0, 12).map((p) => <li key={p} className={styles.warn}>{p}</li>)}</ul>
      )}
      <Suspense fallback={null}><EpayConfirmPanel notify={notify} version={batches} onFile={batchFile} /></Suspense>
    </div>
  );
}

/* ── Cash tally ───────────────────────────────────────────── */

function CashTallyPanel({ notify }: { notify: Notify }) {
  const [books] = useState(() => loadBooksData());
  const vouchers = useMemo(() => buildVouchers(books), [books]);
  const [date, setDate] = useState(todayInput());
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [note, setNote] = useState('');
  const [list, setList] = useState(() => loadCashTallies());
  const expected = accountBalanceAt(vouchers, books.openings, 'cash', date);
  const t = tallyCash(counts, expected);
  const save = () => {
    try {
      saveCashTally({ date, counts, expected, note });
      setList(loadCashTallies());
      notify(bnkT('countSaved', { date: formatDate(date) }), 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>{bnkT('cashIntro')}</p>
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{bnkT('date')}</span>
          <input className={controls.input} type="date" max={todayInput()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className={controls.field}><span className={controls.label}>{bnkT('note')}</span>
          <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <DenominationGrid counts={counts} onChange={setCounts} />
      <div className={styles.totals}>
        <span>{bnkT('expected')}: <strong>{rupees(expected)}</strong></span>
        <span>{bnkT('counted')}: <strong>{rupees(t.counted)}</strong></span>
        <span className={t.status === 'tallied' ? styles.ok : styles.bad}>
          {t.status === 'tallied' ? bnkT('tallied') : t.status === 'excess' ? bnkT('excess', { amount: rupees(t.difference) }) : bnkT('short', { amount: rupees(-t.difference) })}
        </span>
      </div>
      <div className={styles.toolbar}><button type="button" className={controls.btnPrimary} onClick={save}><Save size={16} /> {bnkT('saveCount')}</button></div>
      {list.length > 0 && (
        <section className={surface.card}>
          <div className={surface.cardHead}>{bnkT('recentCounts')}</div>
          <div className={surface.cardBody}>
            <ul className={styles.list}>
              {list.slice(0, 30).map((r) => (
                <li key={r.id} className={styles.listItem}>
                  <span>{formatDate(r.date)}</span>
                  <span className={styles.num}>{rupees(r.counted)} / {rupees(r.expected)}</span>
                  <span className={Math.abs(r.difference) < 0.005 ? styles.ok : styles.bad}>{bnkT('difference')}: {rupees(r.difference)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Shell ────────────────────────────────────────────────── */

export function BankingDocs({ doc, onDoc, notify }: { doc: BankDoc; onDoc: (d: BankDoc) => void; notify: Notify }) {
  useT(); // re-render on a language switch (5.4)
  return (
    <div className={styles.stack}>
      <div className={controls.segment} role="group" aria-label={bnkT('tabDocuments')}>
        {DOCS.map((d) => (
          <button key={d.id} type="button" className={doc === d.id ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={doc === d.id} onClick={() => onDoc(d.id)}>
            {bnkT(d.label)}
          </button>
        ))}
        <button type="button" className={doc === 'forex' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={doc === 'forex'} onClick={() => onDoc('forex')}>
          {fxbT('docForex')}
        </button>
      </div>
      {doc === 'deposit' && <DepositSlipPanel notify={notify} />}
      {doc === 'advice' && <PaymentAdvicePanel />}
      {doc === 'epay' && <EPaymentsPanel notify={notify} />}
      {doc === 'cash' && <CashTallyPanel notify={notify} />}
      {doc === 'forex' && <Suspense fallback={null}><ForexBankPanel notify={notify} /></Suspense>}
    </div>
  );
}

export default BankingDocs;
