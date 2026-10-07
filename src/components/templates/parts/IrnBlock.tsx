import { QRCodeSVG } from 'qrcode.react';
import { cn } from '../../../lib/utils';
import { irnQrSize, type IrnPrintModel } from '../../../lib/einvoice-print';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

/**
 * IRN, acknowledgement and the IRP-signed QR. Rendered once at the foot of
 * every template (all layouts and papers) and only when the invoice has
 * e-Invoice details. The UPI "scan to pay" QR lives in the payment block above.
 */
export function IrnBlock({ model }: { model: IrnPrintModel }) {
  const { paper, layout } = usePaper();
  const compact = paper === 'thermal80' || layout === 'receipt';
  const hasIrnPart = !!(model.irn || model.ackNo || model.ackDate || model.qr);
  return (
    <div className={cn(styles.irn, compact && styles.irnCompact)} data-irn-block>
      {model.qr && (
        <div className={styles.irnQr}>
          <QRCodeSVG value={model.qr} size={irnQrSize(paper)} level="L" marginSize={1} title="e-Invoice signed QR code" />
        </div>
      )}
      <div className={styles.irnText}>
        {hasIrnPart && <div className={styles.irnTitle}>e-Invoice details (GST IRP)</div>}
        {model.irn && (
          <div className={styles.irnLine}>
            <b>IRN:</b> <span className={styles.irnMono}>{model.irn}</span>
          </div>
        )}
        {(model.ackNo || model.ackDate) && (
          <div className={styles.irnLine}>
            {model.ackNo && (
              <>
                <b>Ack No:</b> {model.ackNo}
              </>
            )}
            {model.ackNo && model.ackDate && '  ·  '}
            {model.ackDate && (
              <>
                <b>Ack Date:</b> {model.ackDate}
              </>
            )}
          </div>
        )}
        {model.ewayNo && (
          <div className={styles.irnLine}>
            <b>e-Way Bill No:</b> {model.ewayNo}
            {model.ewayValidUpto && <> · valid upto {model.ewayValidUpto}</>}
          </div>
        )}
      </div>
    </div>
  );
}
