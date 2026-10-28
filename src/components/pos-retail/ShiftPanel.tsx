import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { localDb } from '../../lib/localDb';
import { zReportHtml, type PosDayClose } from '../../lib/pos';
import { posReturnsDb } from '../../lib/pos-returns';
import { closeBlocker, shiftExpected, shiftReport, shiftsDb, type PosShift } from '../../lib/pos-shifts';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import { dateLocale, useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from './retail.module.css';

function printHtml(html: string, name: string) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  } else {
    downloadText(`${name}.html`, html, 'text/html');
  }
}

const asClose = (s: PosShift, expected: number, counted: number): PosDayClose => ({
  id: s.id, day: s.day, opening_float: s.opening_float, expected_cash: expected, counted_cash: counted,
  difference: Math.round((counted - expected) * 100) / 100, bills: 0, net: 0, cash: 0, upi: 0, card: 0,
  ...(s.note ? { note: s.note } : {}), closed_at: s.closed_at ?? new Date().toISOString(),
});

/**
 * Cashier shift (8.142): open with a float, X report (totals so far) at any time, close with the cash
 * count = the shift's Z report. Closing is refused while bills are on hold. The day close is separate.
 */
export function ShiftPanel({ open, onClose, held, notify, onChanged }: {
  open: boolean;
  onClose: () => void;
  held: number;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  onChanged: (shift: PosShift | undefined) => void;
}) {
  useT();
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => shiftsDb.current(), [tick, open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => shiftsDb.all().filter((s) => s.day === todayInput()), [tick, open]);
  const [float, setFloat] = useState(0);
  const [counted, setCountedValue] = useState(0);
  // QA-3 F16: no difference (and no close) until the cash is counted: a blank count is not ₹0.
  const [countedTyped, setCountedTyped] = useState(false);
  const setCounted = (n: number) => {
    setCountedValue(n);
    setCountedTyped(true);
  };
  const [note, setNote] = useState('');
  const z = useMemo(
    () => (current ? shiftReport(current, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, tick],
  );
  const expected = z && current ? shiftExpected(z, current.opening_float) : 0;
  const blocker = closeBlocker(held);
  const business = localDb.settings.activeProfile()?.companyName;

  const doOpen = () => {
    try {
      const s = shiftsDb.open(float, todayInput());
      setTick((t) => t + 1);
      onChanged(s);
      notify(retailT('shiftOpened', { n: s.number, user: s.user_name }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const doClose = () => {
    if (!current || !z) return;
    try {
      const s = shiftsDb.close(current.id, z, counted, held, note);
      setTick((t) => t + 1);
      setCountedValue(0);
      setCountedTyped(false);
      onChanged(undefined);
      notify(retailT('shiftClosed', { n: s.number, diff: formatCurrency(s.difference ?? 0) }));
      printHtml(zReportHtml(z, { business, close: asClose(s, s.expected_cash ?? 0, s.counted_cash ?? 0), title: retailT('zShiftTitle', { n: s.number, user: s.user_name }) }), `shift-${s.day}-${s.number}`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={retailT('shiftTitle')}
      subtitle={current ? retailT('shiftOpenSub', { n: current.number, user: current.user_name, time: new Date(current.opened_at).toLocaleTimeString(dateLocale()) }) : retailT('shiftNoneSub')}
      footer={
        current ? (
          <>
            <button type="button" className={controls.btnOutline} onClick={() => z && printHtml(zReportHtml(z, { business, title: retailT('xTitle', { n: current.number, user: current.user_name }) }), `x-report-${current.day}-${current.number}`)}>
              <Printer size={16} /> {retailT('printX')}
            </button>
            <button type="button" className={controls.btnPrimary} onClick={doClose} disabled={!!blocker || !countedTyped} title={countedTyped ? undefined : retailT('expectedNoCount', { float: formatCurrency(current.opening_float), amount: formatCurrency(expected) })} data-shift-close>{retailT('closeShift')}</button>
          </>
        ) : (
          <button type="button" className={controls.btnPrimary} onClick={doOpen} data-shift-open>{retailT('openShift')}</button>
        )
      }
    >
      <div className={styles.grid}>
        {!current ? (
          <label className={controls.field}>
            <span className={controls.label}>{retailT('openingFloat')}</span>
            <NumberInput id="shift-float" className={cn(controls.input, controls.inputNumeric)} value={float} onChange={setFloat} placeholder="0" />
            <span className={controls.hint}>{retailT('shiftOptional')}</span>
          </label>
        ) : z && (
          <>
            <p className={styles.section}>{retailT('xReport')}</p>
            <div className={styles.stats} data-x-report>
              <div className={styles.stat} data-x="bills"><span>{retailT('dayBills')}</span><strong>{z.bills}</strong></div>
              <div className={styles.stat} data-x="net"><span>{retailT('daySales')}</span><strong>{formatCurrency(z.net)}</strong></div>
              <div className={styles.stat} data-x="cash"><span>{retailT('t.Cash')}</span><strong>{formatCurrency(z.tenders.cash)}</strong></div>
              <div className={styles.stat} data-x="upi"><span>UPI</span><strong>{formatCurrency(z.tenders.upi)}</strong></div>
              <div className={styles.stat} data-x="card"><span>{retailT('t.Card')}</span><strong>{formatCurrency(z.tenders.card)}</strong></div>
              <div className={styles.stat} data-x="other"><span>{retailT('dayOther')}</span><strong>{formatCurrency(z.tenders.other)}</strong></div>
              <div className={styles.stat} data-x="credit"><span>{retailT('t.Account')}</span><strong>{formatCurrency(z.credit)}</strong></div>
              <div className={styles.stat} data-x="returns"><span>{retailT('dayReturns')}</span><strong>{formatCurrency(z.returns.value)}</strong></div>
            </div>
            <p className={styles.section}>{retailT('closeTitle')}</p>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('counted')}</span>
                <NumberInput id="shift-counted" className={cn(controls.input, controls.inputNumeric)} value={counted} onChange={setCounted} placeholder="0" />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('note')}</span>
                <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <p className={styles.muted} data-x="expected">
              {countedTyped
                ? retailT('expectedCash', { float: formatCurrency(current!.opening_float), amount: formatCurrency(expected), diff: formatCurrency(Math.round((counted - expected) * 100) / 100) })
                : retailT('expectedNoCount', { float: formatCurrency(current!.opening_float), amount: formatCurrency(expected) })}
            </p>
            {blocker && <p className={styles.warn} role="alert" data-shift-blocked>{blocker}</p>}
          </>
        )}
        {today.length > 0 && (
          <>
            <p className={styles.section}>{retailT('shiftsToday')}</p>
            <table className={styles.table}>
              <tbody>
                {today.map((s) => (
                  <tr key={s.id}>
                    <td>#{s.number} · {s.user_name}</td>
                    <td>{new Date(s.opened_at).toLocaleTimeString(dateLocale())}{s.closed_at ? ` – ${new Date(s.closed_at).toLocaleTimeString(dateLocale())}` : ` · ${retailT('openNow')}`}</td>
                    <td className={styles.r}>{s.totals ? formatCurrency(s.totals.net) : retailT('billsN', { n: s.bill_ids.length })}</td>
                    <td className={styles.r}>{s.closed_at ? formatCurrency(s.difference ?? 0) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}
