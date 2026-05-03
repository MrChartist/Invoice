import { useRef, useMemo } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency, formatDate, amountInWords } from '../../lib/utils';
import styles from './InvoicePreview.module.css';

interface InvoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getSenderProfile(invoiceSender: any) {
  if (invoiceSender) return invoiceSender;

  const defaults = {
    companyName: 'Rohit Singh',
    companyEmail: 'mrchartist@zohomail.in',
    companyAddress: '73 Sagouni Post Chouka Teh Kesli\nSagar, Madhya Pradesh 470235',
    companyPhone: '7581838868',
    companyTagline: 'Financial Consultant',
    bankName: 'ICICI Bank (Savings)',
    accountName: 'ROHIT SINGH',
    accountNumber: '081801505319',
    ifsc: 'ICIC0000949',
    upiId: '8726696911@icici'
  };
  try {
    const stored = localStorage.getItem('mrchartist_inv_settings');
    if (stored) {
      const s = JSON.parse(stored);
      if (s.profiles && s.profiles.length > 0) {
        return s.profiles.find((p: any) => p.id === s.activeProfileId) || s.profiles[0];
      }
      return {
        companyName: s.companyName || defaults.companyName,
        companyEmail: s.companyEmail || defaults.companyEmail,
        companyAddress: s.companyAddress || defaults.companyAddress,
        companyPhone: s.companyPhone || defaults.companyPhone,
        companyTagline: s.companyTagline || defaults.companyTagline,
        bankName: defaults.bankName,
        accountName: defaults.accountName,
        accountNumber: defaults.accountNumber,
        ifsc: defaults.ifsc,
        upiId: defaults.upiId
      };
    }
  } catch {}
  return defaults;
}

export const InvoicePreviewModal = ({ isOpen, onClose }: InvoicePreviewModalProps) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const invoice = useInvoiceStore();
  const sender = useMemo(() => getSenderProfile(invoice.sender), [isOpen, invoice.sender]);
  
  if (!isOpen) return null;

  const handleExportPDF = async () => {
    if (!previewRef.current) return;
    try {
      const dataUrl = await toPng(previewRef.current, { quality: 1, pixelRatio: 3, cacheBust: true });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Invoice_${invoice.invoice_number || 'draft'}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    }
  };

  const addressLines = sender.companyAddress.split('\n');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, 
      backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: 'auto', padding: '2rem 1rem'
    }}>
      {/* Toolbar */}
      <div className={`${styles.toolbar} no-print`} style={{ marginBottom: '1rem', position: 'sticky', top: 0, zIndex: 10 }}>
        <span className={styles.toolbarLabel}>Preview (A4)</span>
        <div className={styles.toolbarActions}>
          <button className={styles.toolBtn} onClick={() => window.print()}>
            <Printer size={13} /> Print
          </button>
          <button className={styles.toolBtnPrimary} onClick={handleExportPDF}>
            <Download size={13} /> Download PDF
          </button>
          <button className={styles.toolBtn} onClick={onClose} style={{ marginLeft: '1rem', color: 'var(--destructive)' }}>
            <X size={13} /> Close
          </button>
        </div>
      </div>

      {/* Paper */}
      <div className={styles.paperShadow}>
        <div ref={previewRef} className={styles.paper}>
          {/* Orange Accent */}
          <div className={styles.accentStrip} />

          <div className={styles.paperContent}>
            {/* Header */}
            <div className={styles.invoiceHeader}>
              <div>
                <div className={styles.invoiceTitle}>INVOICE</div>
                <div className={styles.invoiceNumber}>#{invoice.invoice_number}</div>
              </div>
              <div className={styles.senderBlock}>
                <div className={styles.senderName}>{sender.companyName}</div>
                <div className={styles.senderTagline}>{sender.companyTagline}</div>
                <div className={styles.senderMeta}>
                  {addressLines.map((line: string, i: number) => (
                    <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
                  ))}
                  {sender.companyPhone && <><br />Mobile: {sender.companyPhone}</>}
                  {sender.companyEmail && <><br />{sender.companyEmail}</>}
                </div>
              </div>
            </div>

            {/* Details Row */}
            <div className={styles.detailsRow}>
              <div className={styles.detailBlock}>
                <span className={styles.detailLabel}>Bill To</span>
                <span className={styles.detailValue}>{invoice.client.name || 'Client Name'}</span>
                <span className={styles.detailSubtext}>
                  {invoice.client.address || 'Address Line 1'}<br />
                  {invoice.client.city || 'City'} {invoice.client.zip || ''}<br />
                  {invoice.client.email || ''}
                </span>
              </div>
              <div className={styles.datesRow}>
                <div className={styles.detailBlock}>
                  <span className={styles.detailLabel}>Issue Date</span>
                  <span className={styles.detailValueMono}>{formatDate(invoice.issue_date)}</span>
                </div>
                <div className={styles.detailBlock}>
                  <span className={styles.detailLabel}>Due Date</span>
                  <span className={styles.detailValueMono}>{formatDate(invoice.due_date)}</span>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className={styles.tableSection}>
              <div className={styles.tableHeader}>
                <span className={styles.tableHeaderCell}>Description</span>
                <span className={styles.tableHeaderCellRight}>Qty</span>
                <span className={styles.tableHeaderCellRight}>Rate</span>
                <span className={styles.tableHeaderCellRight}>Amount</span>
              </div>
              {invoice.items?.map(item => (
                <div key={item.id} className={styles.tableRow}>
                  <span className={styles.tableCell}>{item.name || '—'}</span>
                  <span className={styles.tableCellMuted}>{item.quantity}</span>
                  <span className={styles.tableCellMuted}>
                    {formatCurrency(item.rate, invoice.currency)}
                  </span>
                  <span className={styles.tableCellBold}>
                    {formatCurrency(item.amount, invoice.currency)}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer: Bank Details + Notes + Totals */}
            <div className={styles.footerSection}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Bank Details */}
                {(sender.accountNumber || sender.upiId) && (
                  <div className={styles.notesBox} style={{ background: '#fdf8f4', borderColor: '#f0e8e0' }}>
                    <div className={styles.notesLabel} style={{ color: '#f07020' }}>Bank Details for Payment</div>
                    <div className={styles.notesText} style={{ fontSize: '8.5px', lineHeight: '1.7' }}>
                      {sender.accountName && <><strong>Name:</strong> {sender.accountName}<br /></>}
                      {sender.accountNumber && <><strong>A/C No:</strong> {sender.accountNumber}<br /></>}
                      {sender.ifsc && <><strong>IFSC:</strong> {sender.ifsc}<br /></>}
                      {sender.bankName && <><strong>Bank:</strong> {sender.bankName}<br /></>}
                      {sender.upiId && <><strong>UPI:</strong> {sender.upiId}</>}
                    </div>
                  </div>
                )}
                {/* Notes */}
                <div className={styles.notesBox}>
                  <div className={styles.notesLabel}>Notes & Terms</div>
                  <div className={styles.notesText}>
                    Please make payment within 15 days of receiving this invoice.
                    <br />Thank you for your business.
                  </div>
                </div>
              </div>

              <div className={styles.totals}>
                <div className={styles.totalRow}>
                  <span className={styles.totalLabel}>Subtotal</span>
                  <span className={styles.totalValue}>
                    {formatCurrency(invoice.subtotal, invoice.currency)}
                  </span>
                </div>
                {invoice.discount_amount > 0 && (
                  <div className={styles.totalRowDiscount}>
                    <span className={styles.totalLabel}>Discount ({invoice.discount_rate}%)</span>
                    <span className={styles.totalValue}>
                      -{formatCurrency(invoice.discount_amount, invoice.currency)}
                    </span>
                  </div>
                )}
                
                {invoice.tax_amount > 0 && (
                  <div className={styles.totalRow}>
                    <span className={styles.totalLabel}>Tax ({invoice.tax_rate}%)</span>
                    <span className={styles.totalValue}>
                      {formatCurrency(invoice.tax_amount, invoice.currency)}
                    </span>
                  </div>
                )}

                <div className={styles.totalRowGrand}>
                  <span>Total</span>
                  <span className={styles.totalValue}>
                    {formatCurrency(invoice.total, invoice.currency)}
                  </span>
                </div>
                <div style={{ textAlign: 'right', fontSize: '8px', fontStyle: 'italic', color: '#8a8580', marginTop: '6px', lineHeight: 1.4 }}>
                  {amountInWords(invoice.total, invoice.currency)}
                </div>
              </div>
            </div>

            {/* Watermark */}
            <div className={styles.watermark}>
              Generated with MrChartist Invoice Creator
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
