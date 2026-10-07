import type { CSSProperties } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { TemplateProps } from './registry';
import { templateById } from './registry';
import { PaperHeader } from './parts/PaperHeader';
import { PartyPanel } from './parts/PartyPanel';
import { PaperItemsTable } from './parts/PaperItemsTable';
import { cn, formatCurrency } from '../../lib/utils';
import { amountInWords } from '../../lib/amount-in-words';
import styles from './invoice-paper.module.css';

function buildUpiUrl(sender: TemplateProps['sender']): string {
  if (!sender.upiId) return '';
  const payee = encodeURIComponent(sender.accountName || sender.companyName);
  return `upi://pay?pa=${sender.upiId}&pn=${payee}&cu=INR`;
}

/** Renders one invoice/quotation onto an A4 paper, skinned per the chosen template. */
export function TemplateEngine({ invoice, sender, totals, templateId }: TemplateProps & { templateId: string }) {
  const meta = templateById(templateId);
  const { layout, accent, fontFamily } = meta;
  const taxed = invoice.gst_mode !== 'NONE' && invoice.gst_mode !== 'SINGLE' && totals.tax_amount > 0;
  const singleTax = invoice.gst_mode === 'SINGLE' && totals.tax_amount > 0;
  const upiUrl = buildUpiUrl(sender);

  const outerClass = cn(
    styles.paper,
    layout === 'classic' && styles.frameRail,
    layout === 'corporate' && styles.bordered,
  );
  const outerStyle: CSSProperties = { '--tpl-accent': accent, fontFamily } as CSSProperties;

  return (
    <div className={outerClass} style={outerStyle}>
      {(layout === 'corporate' || layout === 'centered') && sender.companyName && (
        <div className={styles.watermark}>{sender.companyName.substring(0, 2).toUpperCase()}</div>
      )}

      <div className={styles.inner}>
        <PaperHeader invoice={invoice} sender={sender} meta={meta} />
        <PartyPanel invoice={invoice} plain={layout === 'minimal'} />
        <PaperItemsTable invoice={invoice} totals={totals} tableStyle={meta.tableStyle} />

        {(taxed || singleTax) && totals.slabs.length > 1 && (
          <table className={styles.summary}>
            <thead>
              <tr>
                <th>GST rate</th>
                <th>Taxable</th>
                {taxed && <th>CGST</th>}
                {taxed && <th>SGST</th>}
                {!taxed && <th>IGST</th>}
                <th>Tax</th>
              </tr>
            </thead>
            <tbody>
              {totals.slabs.map((slab) => (
                <tr key={slab.rate}>
                  <td>{slab.rate}%</td>
                  <td>{formatCurrency(slab.taxable, invoice.currency)}</td>
                  {taxed && <td>{formatCurrency(slab.cgst, invoice.currency)}</td>}
                  {taxed && <td>{formatCurrency(slab.sgst, invoice.currency)}</td>}
                  {!taxed && <td>{formatCurrency(slab.igst, invoice.currency)}</td>}
                  <td>{formatCurrency(slab.tax, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className={styles.footer}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(sender.accountNumber || sender.upiId) && (
              <div className={styles.boxAccent}>
                <div className={styles.eyebrow}>Payment details</div>
                <div className={styles.payGrid} style={{ marginTop: 8 }}>
                  <div className={styles.payLines}>
                    {sender.accountName && <><strong>Account:</strong> {sender.accountName}<br /></>}
                    {sender.accountNumber && <><strong>A/C No:</strong> {sender.accountNumber}<br /></>}
                    {sender.ifsc && <><strong>IFSC:</strong> {sender.ifsc}<br /></>}
                    {sender.bankName && <><strong>Bank:</strong> {sender.bankName}<br /></>}
                    {sender.upiId && <><strong>UPI:</strong> {sender.upiId}</>}
                  </div>
                  {upiUrl && (
                    <div className={styles.qrBox}>
                      <QRCodeCanvas value={upiUrl} size={64} level="M" />
                      <div className={styles.qrCaption}>Scan to pay</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(invoice.notes || invoice.terms) && (
              <div className={styles.boxSoft}>
                <div className={styles.eyebrowMuted}>Notes &amp; terms</div>
                <div className={styles.notesText}>{invoice.notes || invoice.terms}</div>
              </div>
            )}
          </div>

          <div>
            <div className={styles.totals}>
              <div className={styles.totalRow}>
                <span>Subtotal</span>
                <span>{formatCurrency(totals.subtotal, invoice.currency)}</span>
              </div>
              {totals.discount_amount > 0 && (
                <div className={cn(styles.totalRow, styles.totalGreen)}>
                  <span>Discount</span>
                  <span>-{formatCurrency(totals.discount_amount, invoice.currency)}</span>
                </div>
              )}
              {taxed && (
                <>
                  <div className={styles.totalRow}>
                    <span>CGST</span>
                    <span>{formatCurrency(totals.cgst_amount, invoice.currency)}</span>
                  </div>
                  <div className={styles.totalRow}>
                    <span>SGST</span>
                    <span>{formatCurrency(totals.sgst_amount, invoice.currency)}</span>
                  </div>
                </>
              )}
              {!taxed && totals.igst_amount > 0 && (
                <div className={styles.totalRow}>
                  <span>IGST</span>
                  <span>{formatCurrency(totals.igst_amount, invoice.currency)}</span>
                </div>
              )}
              {singleTax && (
                <div className={styles.totalRow}>
                  <span>Tax</span>
                  <span>{formatCurrency(totals.tax_amount, invoice.currency)}</span>
                </div>
              )}
              {/* calc-extensions: cess + TCS lines */}
              {totals.cess_amount > 0 && (
                <div className={styles.totalRow}>
                  <span>Cess</span>
                  <span>{formatCurrency(totals.cess_amount, invoice.currency)}</span>
                </div>
              )}
              {totals.tcs_amount > 0 && (
                <div className={styles.totalRow}>
                  <span>{invoice.tcs_label || 'TCS'}</span>
                  <span>{formatCurrency(totals.tcs_amount, invoice.currency)}</span>
                </div>
              )}
              {totals.shipping > 0 && (
                <div className={styles.totalRow}>
                  <span>Shipping</span>
                  <span>{formatCurrency(totals.shipping, invoice.currency)}</span>
                </div>
              )}
              {totals.other_charges !== 0 && (
                <div className={styles.totalRow}>
                  <span>Other charges</span>
                  <span>{formatCurrency(totals.other_charges, invoice.currency)}</span>
                </div>
              )}
              {totals.round_off !== 0 && (
                <div className={styles.totalRow}>
                  <span>Round off</span>
                  <span>{formatCurrency(totals.round_off, invoice.currency)}</span>
                </div>
              )}
              <div className={styles.totalRowStrong}>
                <span>Total</span>
                <span>{formatCurrency(totals.total, invoice.currency)}</span>
              </div>
            </div>

            <div className={styles.grand}>
              <span className={styles.grandLabel}>Total</span>
              <span className={styles.grandValue}>{formatCurrency(totals.total, invoice.currency)}</span>
            </div>

            <div className={styles.words}>Amount in words: {amountInWords(totals.total, invoice.currency)}</div>

            {/* calc-extensions: LUT declaration + TDS / net payable */}
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
                <span>-{formatCurrency(totals.tds_amount, invoice.currency)}</span>
              </div>
            )}
            {(totals.amount_paid > 0 || totals.tds_amount > 0) && (
              <div className={styles.balance}>
                <span>Balance due</span>
                <span>{formatCurrency(totals.balance_due, invoice.currency)}</span>
              </div>
            )}

            {sender.signature && (
              <div className={styles.signature}>
                <img src={sender.signature} alt="Signature" className={styles.signatureImg} />
                <div className={styles.signatureLine}>Authorized signatory</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
