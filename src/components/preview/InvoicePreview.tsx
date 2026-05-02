import { useRef } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency, formatDate } from '../../lib/utils';
import styles from './InvoicePreview.module.css';

interface InvoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InvoicePreviewModal = ({ isOpen, onClose }: InvoicePreviewModalProps) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const invoice = useInvoiceStore();
  
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
                <div className={styles.senderName}>MrChartist</div>
                <div className={styles.senderTagline}>Premium Financial Research</div>
                <div className={styles.senderMeta}>
                  123 Dalal Street<br />Mumbai, MH 400001<br />billing@mrchartist.com
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
                  {invoice.client.email || 'email@example.com'}
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

            {/* Footer: Notes + Totals */}
            <div className={styles.footerSection}>
              <div>
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
