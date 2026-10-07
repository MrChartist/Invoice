import { QRCodeCanvas } from 'qrcode.react';
import { cn, formatQuantity } from '../../../lib/utils';
import { amountInWords } from '../../../lib/amount-in-words';
import type { CalcTotals } from '../../../lib/invoice-calc';
import { DOCUMENT_LABELS, type InvoiceRecord, type SenderProfile } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import { AddressLines, Logo } from './PaperHeader';
import { buildUpiUrl, isTaxed } from '../paper-helpers';
import styles from '../invoice-paper.module.css';

interface Props {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  totals: CalcTotals;
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'green' }) {
  return (
    <div className={cn(styles.rcRow, strong && styles.rcStrong, tone === 'green' && styles.totalGreen)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Narrow single-column receipt. Used by the `compact_receipt` template and
 * forced for every template when the paper is the 80 mm thermal roll.
 */
export function ReceiptBody({ invoice, sender, totals }: Props) {
  const { money, currency, date, col, show, footerText, headerNote } = usePaper();
  const cur = invoice.currency;
  const c = invoice.client;
  const title = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  const cgstSgst = isTaxed(invoice, totals);
  const igst = !cgstSgst && invoice.gst_mode !== 'NONE' && totals.tax_amount > 0;
  const upiUrl = buildUpiUrl(sender);

  return (
    <div className={styles.rcBody}>
      <div className={styles.rcHead}>
        {sender.logo && <Logo src={sender.logo} style={{ margin: '0 auto 6px' }} />}
        <div className={styles.rcName}>{sender.companyName || 'Your business name'}</div>
        {sender.companyTagline && <div className={styles.rcSmall}>{sender.companyTagline}</div>}
        <div className={styles.rcSmall}>
          <AddressLines sender={sender} />
          {sender.companyPhone && <>Ph: {sender.companyPhone}<br /></>}
          {sender.companyGstin && <>GSTIN: {sender.companyGstin}</>}
        </div>
      </div>

      {headerNote && <div className={cn(styles.rcSmall, styles.rcCenter)}>{headerNote}</div>}
      <hr className={styles.rcRule} />
      <div className={cn(styles.rcCenter, styles.rcStrong)}>{title.toUpperCase()}</div>
      <div className={styles.rcRow}>
        <span>No: {invoice.invoice_number || 'DRAFT'}</span>
        <span>{date(invoice.issue_date)}</span>
      </div>
      {(c.name || c.gstin) && (
        <div className={styles.rcSmall} style={{ marginTop: 4 }}>
          To: <b>{c.name}</b>
          {c.gstin && <> · GSTIN {c.gstin}</>}
        </div>
      )}
      <hr className={styles.rcRule} />

      <div className={styles.rcItems}>
        {totals.lines.map((line, i) => {
          const src = invoice.items.find((it) => it.id === line.id);
          return (
            <div key={line.id} className={styles.rcItem}>
              <div className={styles.rcItemName}>
                {i + 1}. {line.name || '—'}
                {col.hsn && line.hsn && <span className={styles.rcSmall}> [{line.hsn}]</span>}
              </div>
              <div className={styles.rcRow}>
                <span>
                  {formatQuantity(line.quantity)}
                  {col.unit && line.unit ? ` ${line.unit}` : ''} × {money(line.rate, cur)}
                  {col.discount && src?.discount_percent ? ` (-${src.discount_percent}%)` : ''}
                </span>
                <span className={styles.rcStrong}>{money(cgstSgst || igst ? line.total : line.taxable, cur)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <hr className={styles.rcRule} />

      <Row label="Subtotal" value={money(totals.subtotal, cur)} />
      {totals.discount_amount > 0 && <Row label="Discount" value={`-${money(totals.discount_amount, cur)}`} tone="green" />}
      {cgstSgst && (
        <>
          <Row label="CGST" value={money(totals.cgst_amount, cur)} />
          <Row label="SGST" value={money(totals.sgst_amount, cur)} />
        </>
      )}
      {igst && <Row label={invoice.gst_mode === 'SINGLE' ? 'Tax' : 'IGST'} value={money(totals.tax_amount, cur)} />}
      {totals.shipping > 0 && <Row label="Shipping" value={money(totals.shipping, cur)} />}
      {totals.other_charges !== 0 && <Row label="Other charges" value={money(totals.other_charges, cur)} />}
      {totals.round_off !== 0 && <Row label="Round off" value={money(totals.round_off, cur)} />}
      <hr className={styles.rcRule} />
      <div className={cn(styles.rcRow, styles.rcGrand)}>
        <span>TOTAL</span>
        <span>{currency(totals.total, cur)}</span>
      </div>
      {show.words && <div className={cn(styles.rcSmall, styles.rcWords)}>{amountInWords(totals.total, cur)}</div>}
      {totals.amount_paid > 0 && (
        <>
          <Row label="Paid" value={money(totals.amount_paid, cur)} />
          <Row label="Balance due" value={money(totals.balance_due, cur)} strong />
        </>
      )}

      {(show.qr && upiUrl) || (show.bank && (sender.upiId || sender.accountNumber)) ? <hr className={styles.rcRule} /> : null}
      {show.qr && upiUrl && (
        <div className={styles.rcCenter}>
          <QRCodeCanvas value={upiUrl} size={92} level="M" />
          <div className={styles.rcSmall}>Scan to pay · {sender.upiId}</div>
        </div>
      )}
      {show.bank && !(show.qr && upiUrl) && sender.upiId && <div className={styles.rcSmall}>UPI: {sender.upiId}</div>}
      {show.bank && sender.accountNumber && (
        <div className={styles.rcSmall}>
          {sender.bankName} · A/c {sender.accountNumber} · {sender.ifsc}
        </div>
      )}
      {show.terms && invoice.terms && <div className={cn(styles.rcSmall, styles.rcTerms)}>{invoice.terms}</div>}
      {show.signature && sender.signature && (
        <div className={styles.rcCenter}>
          <img src={sender.signature} alt="Signature" className={styles.signatureImg} style={{ margin: '8px auto 0' }} />
        </div>
      )}
      <hr className={styles.rcRule} />
      <div className={cn(styles.rcCenter, styles.rcSmall)}>{footerText || 'Thank you — visit again!'}</div>
    </div>
  );
}
