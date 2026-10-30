/**
 * R4-C2 incentives register: RoDTEP (e-scrip), duty drawback and IGST refund per shipping bill — claim, credit,
 * scrip sale; journals through `saveVoucher`. Receivable = claimed − credited. Verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { ExportIncentive, IncentiveKind } from '../../types/trade-r4';
import { NumberInput } from '../ui/NumberInput';
import { can } from '../../lib/access';
import { getTable } from '../../lib/storage';
import { formatDate, todayInput } from '../../lib/utils';
import type { RealisationRow } from '../../lib/trade/export-register';
import { INCENTIVE_KINDS, incentiveFigures, incentiveTotals, incentivesDb, incentivesSheet, postIncentiveClaim, recordIncentiveCredit, transferScrip } from '../../lib/trade/export-incentives';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';
import { downloadCsv, money, type Notify } from './desk-shared';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const voucherNo = (id?: string) => getTable<{ id: string; number: string }>('vouchers').find((v) => v.id === id)?.number ?? '';

export default function IncentivesTab({ rows, notify, changed }: { rows: RealisationRow[]; notify: Notify; changed: () => void }) {
  useT();
  const [version, setVersion] = useState(0);
  const list = useMemo(() => (version >= 0 ? incentivesDb.all().sort((a, b) => b.date.localeCompare(a.date)) : []), [version]);
  const totals = useMemo(() => incentiveTotals(list), [list]);
  const [draft, setDraft] = useState<Partial<ExportIncentive>>(() => ({ kind: 'rodtep', date: todayInput(), invoice_id: rows[0]?.invoiceId }));
  const [acting, setActing] = useState<{ id: string; mode: 'credit' | 'sell' } | null>(null);
  const [amount, setAmount] = useState(0);
  const [value, setValue] = useState(0);
  const [day, setDay] = useState(todayInput());
  const [scripNo, setScripNo] = useState('');
  const canBooks = can('books.edit');
  const numberOf = (id: string) => rows.find((r) => r.invoiceId === id)?.number ?? '-';
  const run = (fn: () => string | void) => {
    try {
      const msg = fn();
      setVersion((v) => v + 1);
      changed();
      if (msg) notify(msg);
    } catch (err) {
      notify(trErr(err), 'error');
    }
  };

  return (
    <>
      <p className={styles.muted}>{trT('incIntro')}</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>{trT('incTotals')}</th><th className={styles.num}>{trT('incClaimed')}</th><th className={styles.num}>{trT('incCredited')}</th><th className={styles.num}>{trT('incReceivable')}</th><th className={styles.num}>{trT('incScripBalance')}</th></tr></thead>
          <tbody>
            {INCENTIVE_KINDS.map((k) => (
              <tr key={k}><td>{trT(`k_${k}`)}</td><td className={styles.num}>{money(totals[k].claimed)}</td><td className={styles.num}>{money(totals[k].credited)}</td><td className={styles.num}>{money(totals[k].receivable)}</td><td className={styles.num}>{k === 'rodtep' ? money(totals[k].scripBalance) : '-'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!list.length} onClick={() => downloadCsv(`export-incentives-${todayInput()}.csv`, incentivesSheet(list, numberOf))}><Download size={14} aria-hidden="true" /> {trT('downloadCsv')}</button>
      </div>

      {canBooks && rows.length > 0 && (
        <div className={styles.panel} aria-label={trT('incAdd')}>
          <strong>{trT('incAdd')}</strong>
          <div className={styles.inline}>
            <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('incKind')}</span>
              <SelectField className={controls.select} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as IncentiveKind })}>
                {INCENTIVE_KINDS.map((k) => <option key={k} value={k}>{trT(`k_${k}`)}</option>)}
              </SelectField>
            </label>
            <label className={`${controls.field} ${styles.grow}`}><span className={controls.label}>{trT('incInvoice')}</span>
              <SelectField className={controls.select} value={draft.invoice_id ?? ''} onChange={(e) => setDraft({ ...draft, invoice_id: e.target.value })}>
                {rows.map((r) => <option key={r.invoiceId} value={r.invoiceId}>{r.number}{r.sbNo ? ` · SB ${r.sbNo}` : ''}</option>)}
              </SelectField>
            </label>
            <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('incDate')}</span><DateField className={controls.input} value={draft.date ?? ''} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
            <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('incRate')}</span><NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={Number(draft.rate) || 0} onChange={(n) => setDraft({ ...draft, rate: n || undefined })} /></label>
            <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('incClaimed')}</span><NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={Number(draft.claimed) || 0} onChange={(n) => setDraft({ ...draft, claimed: n })} /></label>
            <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => run(() => {
              incentivesDb.save({ ...(draft as ExportIncentive), invoice_id: draft.invoice_id ?? rows[0].invoiceId });
              setDraft({ kind: draft.kind, date: draft.date, invoice_id: draft.invoice_id });
              return trT('incSaved');
            })}>{trT('incSave')}</button>
          </div>
        </div>
      )}

      {!list.length ? <p className={styles.muted}>{trT('incNone')}</p> : (
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="incentives-table">
            <thead><tr><th>{trT('incKind')}</th><th>{trT('incInvoice')}</th><th>{trT('incDate')}</th><th className={styles.num}>{trT('incClaimed')}</th><th className={styles.num}>{trT('incCredited')}</th><th className={styles.num}>{trT('incReceivable')}</th><th>{trT('incScrip')}</th><th className={styles.num}>{trT('incScripBalance')}</th><th /></tr></thead>
            <tbody>
              {list.map((r) => {
                const f = incentiveFigures(r);
                return (
                  <tr key={r.id}>
                    <td>{trT(`k_${r.kind}`)}{r.appendix ? ` · ${r.appendix}` : ''}{r.rate ? ` · ${r.rate}%` : ''}</td>
                    <td>{numberOf(r.invoice_id)}</td>
                    <td>{formatDate(r.date)}</td>
                    <td className={styles.num}>{money(f.claimed)}</td>
                    <td className={styles.num}>{money(f.credited)}{r.credited_on ? <div className={styles.muted}>{formatDate(r.credited_on)}</div> : null}</td>
                    <td className={styles.num}>{money(f.receivable)}</td>
                    <td>{r.scrip_no ?? '-'}</td>
                    <td className={styles.num}>{r.kind === 'rodtep' ? money(f.scripBalance) : '-'}</td>
                    <td>
                      {canBooks && !r.claim_voucher_id && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => trT('incPosted', { number: voucherNo(postIncentiveClaim(r.id, r.date, numberOf(r.invoice_id)).claim_voucher_id) }))}>{trT('incPostClaim')}</button>}
                      {canBooks && f.receivable > 0.005 && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setActing({ id: r.id, mode: 'credit' }); setAmount(f.receivable); }}>{trT('incCredit')}</button>}
                      {canBooks && r.kind === 'rodtep' && f.scripBalance > 0.005 && !r.transferred && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setActing({ id: r.id, mode: 'sell' }); setAmount(f.scripBalance); setValue(f.scripBalance); }}>{trT('incTransfer')}</button>}
                      {acting?.id === r.id && (
                        <div className={styles.inline}>
                          <NumberInput className={`${controls.input} ${controls.inputNumeric}`} aria-label={acting.mode === 'credit' ? trT('incCreditAmount') : trT('incTransferAmount')} value={amount} onChange={setAmount} />
                          {acting.mode === 'sell' && <NumberInput className={`${controls.input} ${controls.inputNumeric}`} aria-label={trT('incTransferValue')} value={value} onChange={setValue} />}
                          {acting.mode === 'credit' && r.kind === 'rodtep' && <input className={controls.input} aria-label={trT('incScrip')} placeholder={trT('incScrip')} value={scripNo} onChange={(e) => setScripNo(e.target.value)} />}
                          <DateField className={controls.input} aria-label={trT('incCreditDate')} value={day} onChange={(e) => setDay(e.target.value)} />
                          <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => run(() => {
                            if (acting.mode === 'credit') recordIncentiveCredit(r.id, amount, day, scripNo ? { no: scripNo, date: day } : undefined);
                            else transferScrip(r.id, amount, value, day);
                            setActing(null);
                            return trT('incSaved');
                          })}>{trT('save')}</button>
                          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setActing(null)}>{trT('cancel')}</button>
                        </div>
                      )}
                      {canBooks && !r.voucher_ids.length && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => incentivesDb.remove(r.id))}>{trT('remove')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
