import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode } from 'lucide-react';
import { upiLink } from '../../lib/share';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { posT } from '../../i18n/areas/pos';
import controls from '../../styles/controls.module.css';
import styles from './counter.module.css';

export interface PosUpiQrProps {
  /** Payee VPA from the bill's sender profile. */
  vpa?: string;
  payee?: string;
  /** Exact UPI part of the bill (am). */
  amount: number;
  /** The number this bill will get (tr / tn). */
  billNo: string;
  utr: string;
  onUtr: (v: string) => void;
}

/**
 * Customer-facing UPI QR for the exact UPI amount (8.22): `upi://pay?pa…&am=…&tr=<bill no>`, built by
 * the validating `upiLink` (a doctored VPA gives no QR). "Show to customer" fills the screen so the
 * customer can scan from across the counter; the UTR box records the reference on the payment.
 * Nothing is checked online — the cashier confirms the money arrived in their UPI app.
 */
export function PosUpiQr({ vpa, payee, amount, billNo, utr, onUtr }: PosUpiQrProps) {
  useT();
  const [full, setFull] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!full) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const link = vpa ? upiLink({ pa: vpa, pn: payee, amount, note: billNo ? `Bill ${billNo}` : undefined, tr: billNo }) : null;
  const money = formatCurrency(amount);
  const utrInput = (id: string) => (
    <label className={`${controls.field} ${styles.utr}`} htmlFor={id}>
      <span className={controls.label}>{posT('upiPaid')}</span>
      <input id={id} className={controls.input} value={utr} onChange={(e) => onUtr(e.target.value)} inputMode="text" autoComplete="off" placeholder={posT('upiPh')} />
    </label>
  );
  if (!link) {
    return (
      <>
        <p className={styles.upiSmall} data-pos-upi-missing>{posT('upiNoVpa')}</p>
        {utrInput('pos-utr')}
      </>
    );
  }

  return (
    <div className={styles.upi} data-pos-upi-qr={amount.toFixed(2)}>
      <span className={styles.upiSmall}><QrCode size={14} aria-hidden="true" /> {posT('upiTitle')}</span>
      <div className={styles.qrBox}>
        <QRCodeSVG value={link} size={176} level="M" marginSize={1} role="img" aria-label={posT('upiQrAria', { amount: money })} />
      </div>
      <span className={styles.upiAmount}>{money}</span>
      {billNo && <span className={styles.upiSmall}>{posT('upiBill', { number: billNo })}</span>}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setFull(true)}>
        <QrCode size={14} aria-hidden="true" /> {posT('upiShow')}
      </button>
      {utrInput('pos-utr')}
      {full && (
        <div className={styles.upiFull} role="dialog" aria-modal="true" aria-label={posT('upiTitle')}>
          <p className={styles.upiSmall}>{posT('upiScan', { amount: money })}</p>
          <div className={styles.qrBox}>
            <QRCodeSVG value={link} size={320} level="M" marginSize={2} role="img" aria-label={posT('upiQrAria', { amount: money })} />
          </div>
          <span className={styles.upiAmount}>{money}</span>
          {payee && <span className={styles.upiSmall}>{payee} · {vpa}</span>}
          {billNo && <span className={styles.upiSmall}>{posT('upiBill', { number: billNo })}</span>}
          {utrInput('pos-utr-full')}
          <button ref={closeRef} type="button" className={controls.btnPrimary} onClick={() => setFull(false)}>{posT('upiDone')}</button>
        </div>
      )}
    </div>
  );
}
