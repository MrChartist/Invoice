import { useMemo, useState } from 'react';
import { Download, Printer, Save } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { localDb } from '../../lib/localDb';
import { dayCloseDb, drawerCount, zReport, zReportCsv, zReportHtml } from '../../lib/pos';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './pos.module.css';
import { dateLocale, useT } from '../../i18n';
import { posT } from '../../i18n/areas/pos';
import { areaNodes } from '../../i18n/areas/nodes';
import { posReturnsDb } from '../../lib/pos-returns';
import { ZReturnsRows } from '../pos-returns/ZReturnsRows';
import { dayOpeningFloat, shiftsDb } from '../../lib/pos-shifts';
import { RIDERS_TABLE, liveCashWithRiders } from '../../lib/retail/rt-delivery'; // R9 (RT-A3)
import { peekTable } from '../../lib/storage';
import { defineArea } from '../../i18n/area';

const zrT = defineArea({ riders: 'Cash with riders' } as const, { riders: 'राइडरों के पास कैश' });

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

/** Day-end Z report with the cash-drawer count (stored in `pos_day_close`). */
export function ZReportModal({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT(); // re-render on a language switch (5.4)
  const [day, setDay] = useState(todayInput());
  const [tick, setTick] = useState(0);
  const z = useMemo(
    () => zReport(day, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, open, tick],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const closed = useMemo(() => dayCloseDb.forDay(day), [day, tick]);
  // QA-3 F16: an unsaved day starts from the float its first cashier shift opened with, and shows no
  // short / over until the cash is counted (a blank count is not a count of zero).
  const floatFor = (d: string) => closed?.opening_float ?? dayOpeningFloat(shiftsDb.all(), d);
  const [float, setFloat] = useState(() => floatFor(day));
  const [counted, setCountedValue] = useState(closed?.counted_cash ?? 0);
  const [countedTyped, setCountedTyped] = useState(Boolean(closed));
  const setCounted = (n: number) => {
    setCountedValue(n);
    setCountedTyped(true);
  };
  const [note, setNote] = useState(closed?.note ?? '');
  const [shownFor, setShownFor] = useState(day);
  if (shownFor !== day) {
    // Switching day: show that day's saved count (or a blank one).
    setShownFor(day);
    setFloat(floatFor(day));
    setCountedValue(closed?.counted_cash ?? 0);
    setCountedTyped(Boolean(closed));
    setNote(closed?.note ?? '');
  }
  const drawer = drawerCount(z, float, counted);
  const business = localDb.settings.activeProfile()?.companyName;

  const save = () => {
    try {
      dayCloseDb.close(z, float, counted, note);
    } catch (err) {
      notify((err as Error).message, 'error'); // R3-A: open restaurant orders block the day close
      return;
    }
    setTick((t) => t + 1);
    notify(posT('zClosed', { date: formatDate(day) }) + (drawer.difference ? posT(drawer.difference < 0 ? 'zShort' : 'zOver', { amount: formatCurrency(Math.abs(drawer.difference)) }) : ''));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={posT('zTitle')}
      subtitle={posT('zSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`z-report-${day}.csv`, zReportCsv(z, closed), 'text/csv')}>
            <Download size={16} /> CSV
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => printHtml(zReportHtml(z, { business, close: closed }), `z-report-${day}`)}>
            <Printer size={16} /> {posT('zPrint')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={!countedTyped} title={countedTyped ? undefined : posT('zCountFirst')}>
            <Save size={16} /> {closed ? posT('zUpdate') : posT('zClose')}
          </button>
        </>
      }
    >
      <div className={styles.zGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{posT('zDay')}</span>
          <input id="z-day" type="date" className={controls.input} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>

        <table className={cn(surface.table, styles.zTable)} aria-label={posT('zTotals')}>
          <tbody>
            <tr><th scope="row">{posT('zBills')}</th><td className={surface.numeric} data-z="bills">{z.bills}{z.cancelled ? posT('zCancelled', { n: z.cancelled }) : ''}</td></tr>
            {z.firstNumber && <tr><th scope="row">{posT('zNumbers')}</th><td className={surface.numeric}>{z.firstNumber} – {z.lastNumber}</td></tr>}
            <tr><th scope="row">{posT('zGross')}</th><td className={surface.numeric}>{formatCurrency(z.gross)}</td></tr>
            <tr><th scope="row">{posT('zDiscounts')}</th><td className={surface.numeric}>{formatCurrency(-z.discounts)}</td></tr>
            <tr><th scope="row">{posT('zTaxable')}</th><td className={surface.numeric}>{formatCurrency(z.taxable)}</td></tr>
            {z.taxByRate.map((s) => (
              <tr key={s.rate}><th scope="row">{posT('zGstOn', { rate: s.rate, amount: formatCurrency(s.taxable) })}</th><td className={surface.numeric}>{formatCurrency(s.tax)}</td></tr>
            ))}
            {z.cess ? <tr><th scope="row">{posT('cess')}</th><td className={surface.numeric}>{formatCurrency(z.cess)}</td></tr> : null}
            {z.roundOff ? <tr><th scope="row">{posT('roundOff')}</th><td className={surface.numeric}>{formatCurrency(z.roundOff)}</td></tr> : null}
            <tr className={styles.strong}><th scope="row">{posT('zNet')}</th><td className={surface.numeric} data-z="net">{formatCurrency(z.net)}</td></tr>
            <tr><th scope="row">{posT('m.Cash')}</th><td className={surface.numeric} data-z="cash">{formatCurrency(z.tenders.cash)}</td></tr>
            <tr><th scope="row">UPI</th><td className={surface.numeric} data-z="upi">{formatCurrency(z.tenders.upi)}</td></tr>
            <tr><th scope="row">{posT('m.Card')}</th><td className={surface.numeric} data-z="card">{formatCurrency(z.tenders.card)}</td></tr>
            {z.tenders.other ? <tr><th scope="row">{posT('zOther')}</th><td className={surface.numeric}>{formatCurrency(z.tenders.other)}</td></tr> : null}
            {peekTable(RIDERS_TABLE).length > 0 && <tr><th scope="row">{zrT('riders')}</th><td className={surface.numeric} data-z="riders">{formatCurrency(liveCashWithRiders(day))}</td></tr>}
            {z.credit ? <tr><th scope="row">{posT('zOnAccount')}</th><td className={surface.numeric}>{formatCurrency(z.credit)}</td></tr> : null}
            <ZReturnsRows z={z} />
          </tbody>
        </table>

        <fieldset className={styles.drawer}>
          <legend className={controls.label}>{posT('zDrawer')}</legend>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{posT('zFloat')}</span>
              <NumberInput id="z-float" className={cn(controls.input, controls.inputNumeric)} value={float} onChange={setFloat} placeholder="0" />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{posT('zCounted')}</span>
              <NumberInput id="z-counted" className={cn(controls.input, controls.inputNumeric)} value={counted} onChange={setCounted} placeholder="0" />
            </label>
          </div>
          <p className={styles.drawerLine}>
            {areaNodes(posT('zExpected'), { amount: <strong>{formatCurrency(drawer.expected)}</strong> })} ·{' '}
            {countedTyped ? (
              <span className={drawer.difference < 0 ? styles.short : drawer.difference > 0 ? styles.over : undefined} data-z="difference">
                {drawer.difference < 0 ? posT('zShortLbl') : drawer.difference > 0 ? posT('zOverLbl') : posT('zDiff')} {formatCurrency(Math.abs(drawer.difference))}
              </span>
            ) : (
              <span data-z="count-first">{posT('zCountFirst')}</span>
            )}
          </p>
          <label className={controls.field}>
            <span className={controls.label}>{posT('zNote')}</span>
            <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={posT('zNotePh')} />
          </label>
          {closed && <p className={controls.hint}>{posT('zClosedAt', { time: new Date(closed.closed_at).toLocaleString(dateLocale()) })}</p>}
        </fieldset>
      </div>
    </Modal>
  );
}
