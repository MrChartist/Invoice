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
  const [day, setDay] = useState(todayInput());
  const [tick, setTick] = useState(0);
  const z = useMemo(
    () => zReport(day, localDb.invoices.getAll(), localDb.payments.getAll()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, open, tick],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const closed = useMemo(() => dayCloseDb.forDay(day), [day, tick]);
  const [float, setFloat] = useState(closed?.opening_float ?? 0);
  const [counted, setCounted] = useState(closed?.counted_cash ?? 0);
  const [note, setNote] = useState(closed?.note ?? '');
  const [shownFor, setShownFor] = useState(day);
  if (shownFor !== day) {
    // Switching day: show that day's saved count (or a blank one).
    setShownFor(day);
    setFloat(closed?.opening_float ?? 0);
    setCounted(closed?.counted_cash ?? 0);
    setNote(closed?.note ?? '');
  }
  const drawer = drawerCount(z, float, counted);
  const business = localDb.settings.activeProfile()?.companyName;

  const save = () => {
    dayCloseDb.close(z, float, counted, note);
    setTick((t) => t + 1);
    notify(`Day ${formatDate(day)} closed${drawer.difference ? ` — ${drawer.difference < 0 ? 'short' : 'over'} by ${formatCurrency(Math.abs(drawer.difference))}` : ''}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Day-end Z report"
      subtitle="POS bills of the day and the money taken for them"
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`z-report-${day}.csv`, zReportCsv(z, closed), 'text/csv')}>
            <Download size={16} /> CSV
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => printHtml(zReportHtml(z, { business, close: closed }), `z-report-${day}`)}>
            <Printer size={16} /> Print 80 mm
          </button>
          <button type="button" className={controls.btnPrimary} onClick={save}>
            <Save size={16} /> {closed ? 'Update day close' : 'Close the day'}
          </button>
        </>
      }
    >
      <div className={styles.zGrid}>
        <label className={controls.field}>
          <span className={controls.label}>Day</span>
          <input id="z-day" type="date" className={controls.input} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>

        <table className={cn(surface.table, styles.zTable)} aria-label="Z report totals">
          <tbody>
            <tr><th scope="row">Bills</th><td className={surface.numeric} data-z="bills">{z.bills}{z.cancelled ? ` (+${z.cancelled} cancelled)` : ''}</td></tr>
            {z.firstNumber && <tr><th scope="row">Numbers</th><td className={surface.numeric}>{z.firstNumber} – {z.lastNumber}</td></tr>}
            <tr><th scope="row">Gross sales</th><td className={surface.numeric}>{formatCurrency(z.gross)}</td></tr>
            <tr><th scope="row">Discounts</th><td className={surface.numeric}>{formatCurrency(-z.discounts)}</td></tr>
            <tr><th scope="row">Taxable value</th><td className={surface.numeric}>{formatCurrency(z.taxable)}</td></tr>
            {z.taxByRate.map((s) => (
              <tr key={s.rate}><th scope="row">GST {s.rate}% on {formatCurrency(s.taxable)}</th><td className={surface.numeric}>{formatCurrency(s.tax)}</td></tr>
            ))}
            {z.cess ? <tr><th scope="row">Cess</th><td className={surface.numeric}>{formatCurrency(z.cess)}</td></tr> : null}
            {z.roundOff ? <tr><th scope="row">Round-off</th><td className={surface.numeric}>{formatCurrency(z.roundOff)}</td></tr> : null}
            <tr className={styles.strong}><th scope="row">Net sales</th><td className={surface.numeric} data-z="net">{formatCurrency(z.net)}</td></tr>
            <tr><th scope="row">Cash</th><td className={surface.numeric} data-z="cash">{formatCurrency(z.tenders.cash)}</td></tr>
            <tr><th scope="row">UPI</th><td className={surface.numeric} data-z="upi">{formatCurrency(z.tenders.upi)}</td></tr>
            <tr><th scope="row">Card</th><td className={surface.numeric} data-z="card">{formatCurrency(z.tenders.card)}</td></tr>
            {z.tenders.other ? <tr><th scope="row">Other</th><td className={surface.numeric}>{formatCurrency(z.tenders.other)}</td></tr> : null}
            {z.credit ? <tr><th scope="row">On account</th><td className={surface.numeric}>{formatCurrency(z.credit)}</td></tr> : null}
          </tbody>
        </table>

        <fieldset className={styles.drawer}>
          <legend className={controls.label}>Cash drawer</legend>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Opening float (₹)</span>
              <NumberInput id="z-float" className={cn(controls.input, controls.inputNumeric)} value={float} onChange={setFloat} placeholder="0" />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Counted cash (₹)</span>
              <NumberInput id="z-counted" className={cn(controls.input, controls.inputNumeric)} value={counted} onChange={setCounted} placeholder="0" />
            </label>
          </div>
          <p className={styles.drawerLine}>
            Expected in drawer: <strong>{formatCurrency(drawer.expected)}</strong> ·{' '}
            <span className={drawer.difference < 0 ? styles.short : drawer.difference > 0 ? styles.over : undefined} data-z="difference">
              {drawer.difference < 0 ? 'Short' : drawer.difference > 0 ? 'Over' : 'Difference'} {formatCurrency(Math.abs(drawer.difference))}
            </span>
          </p>
          <label className={controls.field}>
            <span className={controls.label}>Note</span>
            <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ₹10 coin short" />
          </label>
          {closed && <p className={controls.hint}>Closed {new Date(closed.closed_at).toLocaleString('en-IN')} — saving again updates the count.</p>}
        </fieldset>
      </div>
    </Modal>
  );
}
