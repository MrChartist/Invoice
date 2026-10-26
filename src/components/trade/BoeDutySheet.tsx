/**
 * R4-C3 Bill of Entry duty sheet (lazy inside the bill modal): header (customs rate, FOB / freight / insurance or
 * CIF), per line CTH, AV (allocated by value unless typed), BCD / SWS / IGST / cess %, other duties; live totals;
 * "Apply to bill" hands the snapshot back to the bill form (saved with the bill); "Post duty" posts the journal for
 * a saved sheet. Working paper — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import type { BoeDuty } from '../../types/trade-r4';
import type { PurchaseLine, PurchaseRecord } from '../../types/purchases';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { can } from '../../lib/access';
import { loadRates, rateOn } from '../../lib/currency-rates';
import { formatCurrency } from '../../lib/utils';
import { computeBoe, type BoeLineInput } from '../../lib/trade/boe-duty';
import { postBoeDuty } from '../../lib/trade/boe-post';
import { customsLandingChargePct, customsSwsPct } from '../../lib/trade/trade-rules';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';

interface Props {
  lines: readonly PurchaseLine[];
  /** BOE date, else the bill date (rules are read on it). */
  date: string;
  /** The stored bill (Post duty works on its saved sheet). */
  bill?: PurchaseRecord;
  initial?: BoeDuty;
  onApply: (duty: BoeDuty) => void;
  onClose: () => void;
}

type LineState = Omit<BoeLineInput, 'value'> & { name: string; value: number; avText: number };

export default function BoeDutySheet({ lines, date, bill, initial, onApply, onClose }: Props) {
  useT();
  const goods = lines.filter((l) => l.name?.trim() && l.quantity > 0);
  const [currency, setCurrency] = useState(initial?.currency ?? 'USD');
  const ref = useMemo(() => rateOn(loadRates(), currency, date), [currency, date]);
  const [rate, setRate] = useState(initial?.rate ?? ref?.rate ?? 0);
  const [fob, setFob] = useState(initial?.fob ?? 0);
  const [freight, setFreight] = useState(initial?.freight ?? 0);
  const [insurance, setInsurance] = useState(initial?.insurance ?? 0);
  const [cif, setCif] = useState(initial && !initial.fob ? initial.cif : 0);
  const [rows, setRows] = useState<LineState[]>(() =>
    goods.map((l) => {
      const was = initial?.lines.find((x) => x.line_id === l.id);
      return {
        line_id: l.id, name: l.name, cth: was?.cth ?? l.hsn ?? '', value: l.quantity * l.rate,
        avText: was?.av_typed ? was.av : 0, bcd_pct: was?.bcd_pct ?? 10, sws_pct: was?.sws_pct ?? customsSwsPct(date),
        igst_pct: was?.igst_pct ?? l.tax_rate ?? 18, cess_pct: was?.cess_pct ?? 0, other: was?.other ?? 0,
      };
    }),
  );
  const [error, setError] = useState('');
  const [posted, setPosted] = useState('');
  const result = useMemo(() => {
    try {
      return { duty: computeBoe({ date, rate, currency, fob, freight, insurance, cif: cif || undefined, lines: rows.map((r) => ({ ...r, av: r.avText > 0 ? r.avText : undefined })) }), problem: '' };
    } catch (err) {
      return { duty: null, problem: trErr(err) };
    }
  }, [date, rate, currency, fob, freight, insurance, cif, rows]);
  const duty = result.duty;
  const avOf = (id: string) => duty?.lines.find((l) => l.line_id === id)?.av ?? 0;
  const patch = (i: number, p: Partial<LineState>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const num = (label: string, value: number, set: (n: number) => void) => (
    <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{label}</span><NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={value} onChange={set} /></label>
  );
  const inr = (n: number) => formatCurrency(n);
  const canPost = can('books.edit') && !!bill?.boe_duty && !bill.boe_duty.voucher_id && !posted;

  return (
    <Modal open onClose={onClose} size="xl" title={<><Calculator size={18} aria-hidden="true" /> {trT('boeTitle')}</>}
      footer={<>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{trT('close')}</button>
        {canPost && <button type="button" className={controls.btnOutline} onClick={() => {
          try {
            const v = postBoeDuty(bill!.id);
            setError('');
            setPosted(trT('boePosted', { number: v.number }));
          } catch (err) {
            setError(trErr(err));
          }
        }}>{trT('boePost')}</button>}
        <button type="button" className={controls.btnPrimary} disabled={!duty || !goods.length} data-testid="boe-apply" onClick={() => duty && onApply(duty)}>{trT('boeApply')}</button>
      </>}>
      <div className={styles.stack} data-boe-sheet>
        <p className={styles.muted}>{trT('boeIntro')}</p>
        {!goods.length && <p className={styles.note}>{trT('boeNoLines')}</p>}
        <div className={styles.inline}>
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('boeCurrency')}</span><input className={`${controls.input} ${controls.inputMono}`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
          <label className={`${controls.field} ${styles.grow}`}>
            <span className={controls.label}>{trT('boeRateLabel', { currency })}</span>
            <NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={rate} onChange={setRate} />
            <span className={controls.hint}>{trT('boeRateHint', { rate: ref ? `${ref.rate} (${ref.date})` : '—' })}</span>
          </label>
          {num(trT('boeFob'), fob, setFob)}
          {num(trT('boeFreight'), freight, setFreight)}
          {num(trT('boeInsurance'), insurance, setInsurance)}
          {num(trT('boeCifLabel'), cif, setCif)}
        </div>
        {customsLandingChargePct(date) > 0 && <p className={styles.muted}>{trT('boeLanding', { pct: customsLandingChargePct(date), date })}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>{trT('colLine')}</th><th>{trT('colCth')}</th><th className={styles.num}>{trT('colAv')}</th><th>{trT('colBcd')}</th><th>{trT('colSws')}</th><th>{trT('colIgst')}</th><th>{trT('colCess')}</th><th>{trT('colOther')}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.line_id}>
                  <td>{r.name}</td>
                  <td><input className={`${controls.input} ${styles.cellInput}`} aria-label={`${trT('colCth')} ${r.name}`} value={r.cth ?? ''} onChange={(e) => patch(i, { cth: e.target.value })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colAv')} ${r.name}`} placeholder={inr(avOf(r.line_id))} value={r.avText} onChange={(n) => patch(i, { avText: n })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colBcd')} ${r.name}`} blankZero={false} value={r.bcd_pct} onChange={(n) => patch(i, { bcd_pct: n })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colSws')} ${r.name}`} blankZero={false} value={r.sws_pct ?? 0} onChange={(n) => patch(i, { sws_pct: n })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colIgst')} ${r.name}`} blankZero={false} value={r.igst_pct} onChange={(n) => patch(i, { igst_pct: n })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colCess')} ${r.name}`} value={r.cess_pct ?? 0} onChange={(n) => patch(i, { cess_pct: n })} /></td>
                  <td><NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} aria-label={`${trT('colOther')} ${r.name}`} value={r.other ?? 0} onChange={(n) => patch(i, { other: n })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {duty && (
          <div className={styles.totals} role="status" data-boe-totals>
            <span>{trT('boeTotals', { av: inr(duty.totals.av), bcd: inr(duty.totals.bcd), sws: inr(duty.totals.sws), other: inr(duty.totals.other), igst: inr(duty.totals.igst), cess: inr(duty.totals.cess) })}</span>
            <strong>{trT('boeDutyTotal', { duty: inr(duty.totals.duty), total: inr(duty.totals.total) })}</strong>
          </div>
        )}
        <p className={styles.note} role="note">{trT('boeBooksNote')}</p>
        {posted && <p className={styles.ok} role="status">{posted}</p>}
        {(error || result.problem) && <p className={controls.error} role="alert">{error || result.problem}</p>}
      </div>
    </Modal>
  );
}
