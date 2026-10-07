import { QRCodeCanvas } from 'qrcode.react';
import { cn } from '../../../lib/utils';
import { amountInWords } from '../../../lib/amount-in-words';
import type { CalcTotals } from '../../../lib/invoice-calc';
import type { InvoiceRecord, SenderProfile } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import { buildUpiUrl, isSingleTax, isTaxed } from '../paper-helpers';
import styles from '../invoice-paper.module.css';

interface BlockProps {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  totals: CalcTotals;
}

/** Bank details + UPI QR. Renders nothing when both are switched off / empty. */
export function PaymentBlock({ sender, qrSize = 64 }: { sender: SenderProfile; qrSize?: number }) {
  const { t, show } = usePaper();
  const upiUrl = buildUpiUrl(sender);
  const showQr = show.qr && !!upiUrl;
  const showBank = show.bank && !!(sender.accountNumber || sender.upiId);
  const showUpiOnly = !showBank && showQr;
  if (!showBank && !showQr) return null;
  if (!(sender.accountNumber || sender.upiId)) return null;
  return (
    <div className={styles.boxAccent}>
      <div className={styles.eyebrow}>{t('payDetails')}</div>
      <div className={styles.payGrid} style={{ marginTop: 8 }}>
        <div className={styles.payLines}>
          {showBank && (
            <>
              {sender.accountName && (
                <>
                  <strong>{t('account')}:</strong> {sender.accountName}
                  <br />
                </>
              )}
              {sender.accountNumber && (
                <>
                  <strong>{t('acNo')}:</strong> {sender.accountNumber}
                  <br />
                </>
              )}
              {sender.ifsc && (
                <>
                  <strong>{t('ifsc')}:</strong> {sender.ifsc}
                  <br />
                </>
              )}
              {sender.bankName && (
                <>
                  <strong>{t('bank')}:</strong> {sender.bankName}
                  <br />
                </>
              )}
            </>
          )}
          {(showBank || showUpiOnly) && sender.upiId && (
            <>
              <strong>{t('upi')}:</strong> {sender.upiId}
            </>
          )}
        </div>
        {showQr && (
          <div className={styles.qrBox}>
            <QRCodeCanvas value={upiUrl} size={qrSize} level="M" />
            <div className={styles.qrCaption}>{t('scanToPay')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Notes (and, when enabled, terms). Legacy behaviour (no design): notes OR terms. */
export function NotesBlock({ invoice }: { invoice: InvoiceRecord }) {
  const { t, design, show } = usePaper();
  if (!design) {
    const body = invoice.notes || invoice.terms;
    if (!body) return null;
    return (
      <div className={styles.boxSoft}>
        <div className={styles.eyebrowMuted}>{t('notesTerms')}</div>
        <div className={styles.notesText}>{body}</div>
      </div>
    );
  }
  const terms = show.terms ? invoice.terms : '';
  if (!invoice.notes && !terms) return null;
  return (
    <div className={styles.boxSoft}>
      {invoice.notes && (
        <>
          <div className={styles.eyebrowMuted}>{terms ? t('notes') : t('notesTerms')}</div>
          <div className={styles.notesText}>{invoice.notes}</div>
        </>
      )}
      {terms && (
        <div style={invoice.notes ? { marginTop: 10 } : undefined}>
          <div className={styles.eyebrowMuted}>{invoice.notes ? t('terms') : t('notesTerms')}</div>
          <div className={styles.notesText}>{terms}</div>
        </div>
      )}
    </div>
  );
}

/** Per-slab tax breakup shown when an invoice mixes GST rates. */
export function TaxSummary({ invoice, totals }: Omit<BlockProps, 'sender'>) {
  const { t, currency } = usePaper();
  const taxed = isTaxed(invoice, totals);
  const singleTax = isSingleTax(invoice, totals);
  if (!(taxed || singleTax) || totals.slabs.length <= 1) return null;
  return (
    <table className={styles.summary}>
      <thead>
        <tr>
          <th>{t('gstRate')}</th>
          <th>{t('taxable')}</th>
          {taxed && <th>{t('cgst')}</th>}
          {taxed && <th>{t('sgst')}</th>}
          {!taxed && <th>{t('igst')}</th>}
          <th>{t('tax')}</th>
        </tr>
      </thead>
      <tbody>
        {totals.slabs.map((slab) => (
          <tr key={slab.rate}>
            <td>{slab.rate}%</td>
            <td>{currency(slab.taxable, invoice.currency)}</td>
            {taxed && <td>{currency(slab.cgst, invoice.currency)}</td>}
            {taxed && <td>{currency(slab.sgst, invoice.currency)}</td>}
            {!taxed && <td>{currency(slab.igst, invoice.currency)}</td>}
            <td>{currency(slab.tax, invoice.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Totals ledger, grand total, amount in words, balance due and signature. */
export function TotalsBlock({ invoice, sender, totals }: BlockProps) {
  const { t, currency: money, show, bilingual } = usePaper();
  const taxed = isTaxed(invoice, totals);
  const singleTax = isSingleTax(invoice, totals);
  const cur = invoice.currency;
  return (
    <div className={styles.keepTogether}>
      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>{t('subtotal')}</span>
          <span>{money(totals.subtotal, cur)}</span>
        </div>
        {totals.discount_amount > 0 && (
          <div className={cn(styles.totalRow, styles.totalGreen)}>
            <span>{t('discount')}</span>
            <span>-{money(totals.discount_amount, cur)}</span>
          </div>
        )}
        {taxed && (
          <>
            <div className={styles.totalRow}>
              <span>{t('cgst')}</span>
              <span>{money(totals.cgst_amount, cur)}</span>
            </div>
            <div className={styles.totalRow}>
              <span>{t('sgst')}</span>
              <span>{money(totals.sgst_amount, cur)}</span>
            </div>
          </>
        )}
        {!taxed && totals.igst_amount > 0 && !singleTax && (
          <div className={styles.totalRow}>
            <span>{t('igst')}</span>
            <span>{money(totals.igst_amount, cur)}</span>
          </div>
        )}
        {singleTax && (
          <div className={styles.totalRow}>
            <span>{t('tax')}</span>
            <span>{money(totals.tax_amount, cur)}</span>
          </div>
        )}
        {totals.cess_amount > 0 && (
          <div className={styles.totalRow}>
            <span>Cess</span>
            <span>{money(totals.cess_amount, cur)}</span>
          </div>
        )}
        {totals.tcs_amount > 0 && (
          <div className={styles.totalRow}>
            <span>{invoice.tcs_label || 'TCS'}</span>
            <span>{money(totals.tcs_amount, cur)}</span>
          </div>
        )}
        {totals.shipping > 0 && (
          <div className={styles.totalRow}>
            <span>{t('shipping')}</span>
            <span>{money(totals.shipping, cur)}</span>
          </div>
        )}
        {totals.other_charges !== 0 && (
          <div className={styles.totalRow}>
            <span>{t('other')}</span>
            <span>{money(totals.other_charges, cur)}</span>
          </div>
        )}
        {totals.round_off !== 0 && (
          <div className={styles.totalRow}>
            <span>{t('roundOff')}</span>
            <span>{money(totals.round_off, cur)}</span>
          </div>
        )}
        <div className={styles.totalRowStrong}>
          <span>{t('total')}</span>
          <span>{money(totals.total, cur)}</span>
        </div>
      </div>

      <div className={styles.grand}>
        <span className={styles.grandLabel}>{t('total')}</span>
        <span className={styles.grandValue}>{money(totals.total, cur)}</span>
      </div>

      {show.words && (
        <div className={styles.words}>
          {bilingual ? (
            <>
              {t('words')}: {amountInWords(totals.total, cur)}
            </>
          ) : (
            `Amount in words: ${amountInWords(totals.total, cur)}`
          )}
        </div>
      )}

      {(invoice.supply_type === 'EXPORT_LUT' || invoice.supply_type === 'SEZ_WITHOUT_PAYMENT') && (
        <div className={styles.words}>
          Supply meant for export/SEZ under LUT/bond without payment of IGST
          {invoice.lut_number ? ` — LUT No. ${invoice.lut_number}` : ''}
          {invoice.lut_date ? ` dated ${invoice.lut_date}` : ''}.
        </div>
      )}
      {totals.tds_amount > 0 && (
        <div className={styles.totalRow}>
          <span>Less: TDS{invoice.tds_section && invoice.tds_section !== 'CUSTOM' ? ` (${invoice.tds_section})` : ''}</span>
          <span>-{money(totals.tds_amount, cur)}</span>
        </div>
      )}
      {(totals.amount_paid > 0 || totals.tds_amount > 0) && (
        <div className={styles.balance}>
          <span>{t('balanceDue')}</span>
          <span>{money(totals.balance_due, cur)}</span>
        </div>
      )}

      {show.signature && sender.signature && (
        <div className={styles.signature}>
          <img src={sender.signature} alt="Signature" className={styles.signatureImg} />
          <div className={styles.signatureLine}>{t('signatory')}</div>
        </div>
      )}
    </div>
  );
}
