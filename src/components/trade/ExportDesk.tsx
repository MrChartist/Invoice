/**
 * R4-C2 / C3 export desk (GST reports → Tools → Export desk, lazy): the realisation register (shipping bill →
 * IRM → e-BRC, FEMA clock, write-offs, bank statement, unrealised as at 31 March), IRMs, incentives and the import
 * register by Bill of Entry. Working papers — verify with your CA.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileSpreadsheet, Globe, Landmark } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { can } from '../../lib/access';
import { getTable } from '../../lib/storage';
import { formatDate, todayInput } from '../../lib/utils';
import { downloadCsv, downloadSheet, money, type Notify } from './desk-shared';
import { bankStatementSheet, liveRegister, registerSheet, unrealisedAt, writeoffsDb, irmsDb, type RealisationRow } from '../../lib/trade/export-register';
import { exportRealisationMonths } from '../../lib/trade/trade-rules';
import { importRegister, importRegisterSheet } from '../../lib/trade/boe-duty';
import { postBoeDuty } from '../../lib/trade/boe-post';
import { incentiveFigures, incentivesDb, scripsAvailable, utiliseScrip } from '../../lib/trade/export-incentives';
import type { Payment, InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';

const IrmsTab = lazy(() => import('./IrmsTab'));
const IncentivesTab = lazy(() => import('./IncentivesTab'));

type View = 'register' | 'irms' | 'incentives' | 'imports';
const VIEWS: readonly View[] = ['register', 'irms', 'incentives', 'imports'];
const VIEW_LABEL = { register: 'tabRegister', irms: 'tabIrms', incentives: 'tabIncentives', imports: 'tabImports' } as const;

const csv = downloadCsv;
const xlsx = downloadSheet;

/** The last 31 March on or before today. */
const lastMarch31 = (today: string) => (today.slice(5) >= '03-31' ? `${today.slice(0, 4)}-03-31` : `${Number(today.slice(0, 4)) - 1}-03-31`);

export default function ExportDesk({ notify }: { notify: Notify }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'register';
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  const today = todayInput();
  const rows = useMemo(() => (version >= 0 ? liveRegister(today) : []), [today, version]);

  return (
    <div className={styles.stack} data-export-desk>
      <p className={styles.muted}><Globe size={14} aria-hidden="true" /> {trT('deskIntro', { months: exportRealisationMonths(today) })}</p>
      <div className={styles.tabs} role="tablist" aria-label={trT('deskTitle')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={`${styles.tab} ${view === v ? styles.tabActive : ''}`} onClick={() => setParams((p) => { p.set('view', v); return p; }, { replace: true })}>
            {trT(VIEW_LABEL[v])}
          </button>
        ))}
      </div>
      {view === 'register' && <RegisterView rows={rows} today={today} notify={notify} changed={changed} />}
      {view === 'irms' && <Suspense fallback={null}><IrmsTab rows={rows} notify={notify} changed={changed} /></Suspense>}
      {view === 'incentives' && <Suspense fallback={null}><IncentivesTab rows={rows} notify={notify} changed={changed} /></Suspense>}
      {view === 'imports' && <ImportsView notify={notify} changed={changed} version={version} />}
    </div>
  );
}

/* ── Realisation register ────────────────────────────────────── */

function RegisterView({ rows, today, notify, changed }: { rows: RealisationRow[]; today: string; notify: Notify; changed: () => void }) {
  const [wo, setWo] = useState<RealisationRow | null>(null);
  const [asAt, setAsAt] = useState(() => lastMarch31(today));
  const parties = useMemo(() => [...new Set(rows.filter((r) => r.outstandingFcy > 0.005).map((r) => r.party))].sort(), [rows]);
  const [party, setParty] = useState('');
  const canBooks = can('books.edit');
  const unrealised = useMemo(() => unrealisedAt({ invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), irms: irmsDb.all(), writeoffs: writeoffsDb.all(), links: getTable('doc_links') }, asAt), [asAt, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return <p className={styles.muted}>{trT('noExports')}</p>;
  const sheet = registerSheet(rows);
  return (
    <>
      {rows.some((r) => r.status === 'overdue') && <p className={styles.note} role="note">{trT('overdueNote')}</p>}
      <div className={styles.actions}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => csv(`export-realisation-${today}.csv`, sheet)}><Download size={14} aria-hidden="true" /> {trT('downloadCsv')}</button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void xlsx(`export-realisation-${today}.xlsx`, 'Realisation', sheet)}><FileSpreadsheet size={14} aria-hidden="true" /> {trT('downloadXlsx')}</button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="realisation-table">
          <thead>
            <tr><th>{trT('colInvoice')}</th><th>{trT('colParty')}</th><th>{trT('colSb')}</th><th className={styles.num}>{trT('colFcy')}</th><th className={styles.num}>{trT('colRealised')}</th><th className={styles.num}>{trT('colOutstanding')}</th><th>{trT('colDue')}</th><th className={styles.num}>{trT('colDaysLeft')}</th><th>{trT('colStatus')}</th><th>{trT('colEbrc')}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoiceId} data-realisation-row={r.number}>
                <td>{r.number}<div className={styles.muted}>{formatDate(r.invoiceDate)}</div></td>
                <td>{r.party}</td>
                <td>{r.sbMissing ? <span className={styles.warn} title={trT('sbMissing')}>{r.sbNo || '—'} ⚠</span> : <>{r.sbNo}<div className={styles.muted}>{formatDate(r.sbDate)}</div></>}</td>
                <td className={styles.num}>{money(r.fcy, r.currency)}</td>
                <td className={styles.num}>{money(r.realisedFcy, r.currency)}</td>
                <td className={styles.num}>{money(r.outstandingFcy, r.currency)}</td>
                <td>{formatDate(r.dueDate)}<div className={styles.muted}>{r.months} m</div></td>
                <td className={`${styles.num} ${r.status === 'overdue' ? styles.bad : ''}`}>{r.outstandingFcy > 0.005 ? r.daysLeft : '—'}</td>
                <td><span className={`${styles.status} ${styles[`st_${r.status}`] ?? ''}`}>{trT(`st_${r.status}`)}</span>{r.writeOffReason && <div className={styles.muted}>{r.writeOffReason}</div>}</td>
                <td>{r.irms.map((x) => <div key={x.id + x.irm_no}>{x.irm_no}{x.ebrc_no ? ` · ${x.ebrc_no}` : ''}</div>)}</td>
                <td>
                  {canBooks && r.outstandingFcy > 0.005 && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setWo(r)}>{trT('writeOff')}</button>}
                  {canBooks && r.writtenOffFcy > 0 && (
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => {
                      try {
                        writeoffsDb.remove(r.invoiceId);
                        changed();
                      } catch (err) {
                        notify(trErr(err), 'error');
                      }
                    }}>{trT('writeOffUndo')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.panel}>
        <strong><Landmark size={14} aria-hidden="true" /> {trT('forBank')}</strong>
        <div className={styles.inline}>
          <label className={`${controls.field} ${styles.grow}`}>
            <span className={controls.label}>{trT('forBankParty')}</span>
            <select className={controls.select} value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">—</option>
              {parties.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!party} onClick={() => csv(`open-shipping-bills-${party.replace(/\W+/g, '-')}-${today}.csv`, bankStatementSheet(rows, party))}><Download size={14} aria-hidden="true" /> {trT('downloadCsv')}</button>
        </div>
      </div>

      <div className={styles.panel}>
        <strong>{trT('asAtTitle')}</strong>
        <p className={styles.muted}>{trT('asAtHint')}</p>
        <div className={styles.inline}>
          <label className={`${controls.field} ${styles.narrow}`}>
            <span className={controls.label}>{trT('asAtTitle')}</span>
            <input className={controls.input} type="date" value={asAt} onChange={(e) => setAsAt(e.target.value || lastMarch31(today))} />
          </label>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!unrealised.length} onClick={() => csv(`unrealised-exports-${asAt}.csv`, registerSheet(unrealised))}><Download size={14} aria-hidden="true" /> {trT('downloadCsv')} ({unrealised.length})</button>
        </div>
        {!unrealised.length && <p className={styles.muted}>{trT('asAtNone', { date: formatDate(asAt) })}</p>}
      </div>

      {wo && <WriteOffDialog row={wo} onClose={() => setWo(null)} onDone={(msg) => { setWo(null); changed(); notify(msg); }} />}
    </>
  );
}

function WriteOffDialog({ row, onClose, onDone }: { row: RealisationRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(row.outstandingFcy);
  const [date, setDate] = useState(todayInput());
  const [error, setError] = useState('');
  const save = () => {
    try {
      writeoffsDb.save({ invoice_id: row.invoiceId, date, reason, fcy: amount });
      onDone(trT('writeOffDone', { number: row.number, amount: money(amount, row.currency) }));
    } catch (err) {
      setError(trErr(err));
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={trT('writeOffTitle', { number: row.number })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{trT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={save}>{trT('writeOffSave')}</button></>}>
      <div className={styles.stack}>
        <label className={controls.field}><span className={controls.label}>{trT('writeOffReason')}</span><textarea className={controls.textarea} rows={2} value={reason} placeholder={trT('writeOffReasonPh')} onChange={(e) => setReason(e.target.value)} /></label>
        <div className={styles.inline}>
          <label className={`${controls.field} ${styles.grow}`}><span className={controls.label}>{trT('writeOffAmount', { currency: row.currency })}</span><NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={amount} onChange={setAmount} /></label>
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('writeOffDate')}</span><input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className={styles.muted}>{trT('overdueNote')}</p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/* ── Import register by Bill of Entry (R4-C3) ────────────────── */

function ImportsView({ notify, changed, version }: { notify: Notify; changed: () => void; version: number }) {
  const rows = useMemo(() => (version >= 0 ? importRegister(getTable('purchases')) : []), [version]);
  const scrips = useMemo(() => (version >= 0 ? scripsAvailable(incentivesDb.all()) : []), [version]);
  const [scripFor, setScripFor] = useState<string | null>(null);
  const [scripId, setScripId] = useState('');
  const [scripAmt, setScripAmt] = useState(0);
  const canBooks = can('books.edit');
  if (!rows.length) return <p className={styles.muted}>{trT('impNone')}</p>;
  const sheet = importRegisterSheet(rows);
  const post = (id: string) => {
    try {
      const v = postBoeDuty(id);
      changed();
      notify(trT('boePosted', { number: v.number }));
    } catch (err) {
      notify(trErr(err), 'error');
    }
  };
  const applyScrip = (billId: string, date: string) => {
    try {
      const r = utiliseScrip(scripId, billId, scripAmt, date);
      setScripFor(null);
      changed();
      const vid = r.utilised?.[r.utilised.length - 1]?.voucher_id;
      notify(trT('boeScripUsed', { number: getTable<{ id: string; number: string }>('vouchers').find((v) => v.id === vid)?.number ?? '' }));
    } catch (err) {
      notify(trErr(err), 'error');
    }
  };
  return (
    <>
      <p className={styles.muted}>{trT('impIntro')}</p>
      <p className={styles.note} role="note">{trT('boeBooksNote')}</p>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => csv(`import-register-${todayInput()}.csv`, sheet)}><Download size={14} aria-hidden="true" /> {trT('downloadCsv')}</button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void xlsx(`import-register-${todayInput()}.xlsx`, 'Imports', sheet)}><FileSpreadsheet size={14} aria-hidden="true" /> {trT('downloadXlsx')}</button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="import-register">
          <thead><tr><th>{trT('colBoe')}</th><th>{trT('colPort')}</th><th>{trT('colSupplier')}</th><th className={styles.num}>AV</th><th className={styles.num}>BCD</th><th className={styles.num}>SWS</th><th className={styles.num}>IGST</th><th className={styles.num}>{trT('colCess')}</th><th className={styles.num}>{trT('colDuty')}</th><th className={styles.num}>{trT('colItc')}</th><th>{trT('colPosted')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.billId}>
                <td>{r.boeNo || '—'}<div className={styles.muted}>{formatDate(r.boeDate)} · {r.billNo}</div></td>
                <td>{r.port}</td>
                <td>{r.supplier}</td>
                <td className={styles.num}>{money(r.av)}</td>
                <td className={styles.num}>{money(r.bcd)}</td>
                <td className={styles.num}>{money(r.sws)}</td>
                <td className={styles.num}>{money(r.igst)}</td>
                <td className={styles.num}>{money(r.cess)}</td>
                <td className={styles.num}>{money(r.duty)}</td>
                <td className={styles.num}>{money(r.itcTaken)}</td>
                <td>
                  {r.posted ? <span className={styles.ok}>✓</span> : canBooks && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => post(r.billId)}>{trT('boePost')}</button>}
                  {canBooks && scrips.length > 0 && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setScripFor(r.billId); setScripId(scrips[0].id); setScripAmt(Math.min(incentiveFigures(scrips[0]).scripBalance, r.duty)); }}>{trT('boeScrip')}</button>}
                  {scripFor === r.billId && (
                    <div className={styles.inline}>
                      <select className={controls.select} aria-label={trT('boeScripPick')} value={scripId} onChange={(e) => setScripId(e.target.value)}>
                        {scrips.map((s) => <option key={s.id} value={s.id}>{s.scrip_no || s.id.slice(0, 6)} · {money(incentiveFigures(s).scripBalance)}</option>)}
                      </select>
                      <NumberInput className={`${controls.input} ${controls.inputNumeric}`} aria-label={trT('boeScripAmount')} value={scripAmt} onChange={setScripAmt} />
                      <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => applyScrip(r.billId, r.boeDate)}>{trT('boeScripUse')}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
