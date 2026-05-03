import React from 'react';
import type { TemplateProps } from './registry';
import { TEMPLATES } from './registry';
import { formatCurrency, formatDate, amountInWords } from '../../lib/utils';
import styles from '../preview/InvoicePreview.module.css'; // Reuse CSS for now

export const TemplateEngine: React.FC<TemplateProps & { templateId: string }> = ({ invoice, sender, templateId }) => {
  const templateMeta = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const { layout, accent, fontFamily } = templateMeta;

  const addressLines = sender.companyAddress.split('\n');

  // Common header component
  const HeaderClassic = () => (
    <div className={styles.invoiceHeader}>
      <div>
        {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '60px', marginBottom: '12px' }} />}
        <div className={styles.invoiceTitle} style={{ color: accent, fontFamily }}>INVOICE</div>
        <div className={styles.invoiceNumber}>#{invoice.invoice_number}</div>
      </div>
      <div className={styles.senderBlock}>
        <div className={styles.senderName} style={{ fontFamily }}>{sender.companyName}</div>
        <div className={styles.senderTagline} style={{ color: accent }}>{sender.companyTagline}</div>
        <div className={styles.senderMeta}>
          {addressLines.map((line: string, i: number) => (
            <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
          ))}
          {sender.companyPhone && <><br />Mobile: {sender.companyPhone}</>}
          {sender.companyEmail && <><br />{sender.companyEmail}</>}
          {sender.companyGstin && <><br />GSTIN: {sender.companyGstin}</>}
          {sender.pan && <><br />PAN: {sender.pan}</>}
        </div>
      </div>
    </div>
  );

  const HeaderCorporate = () => (
    <div style={{ backgroundColor: accent, color: '#fff', padding: '30px 40px', margin: '-40px -44px 36px -44px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        {sender.logo ? <img src={sender.logo} alt="Logo" style={{ maxHeight: '50px' }} /> : <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily }}>{sender.companyName}</div>}
        <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px' }}>{sender.companyTagline}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '28px', fontWeight: 'bold', letterSpacing: '2px' }}>INVOICE</div>
        <div style={{ fontSize: '12px', opacity: 0.9 }}>#{invoice.invoice_number}</div>
      </div>
    </div>
  );

  const HeaderMinimal = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px', borderBottom: `1px solid ${accent}`, paddingBottom: '20px' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '1px', fontFamily, color: accent }}>INVOICE</div>
        <div style={{ fontSize: '10px', color: '#666' }}>#{invoice.invoice_number}</div>
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '40px', margin: '0 auto' }} />}
      </div>
      <div style={{ flex: 1, textAlign: 'right', fontSize: '9px', color: '#333' }}>
        <strong style={{ fontSize: '12px', fontFamily }}>{sender.companyName}</strong><br />
        {addressLines.map((line: string, i: number) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
        {sender.companyGstin && <>GSTIN: {sender.companyGstin}<br/></>}
      </div>
    </div>
  );

  const HeaderCentered = () => (
    <div style={{ textAlign: 'center', marginBottom: '40px' }}>
      {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '60px', margin: '0 auto 16px' }} />}
      <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily, color: accent }}>{sender.companyName}</div>
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '16px' }}>{sender.companyTagline}</div>
      <div style={{ fontSize: '14px', fontWeight: 'bold', letterSpacing: '4px', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', padding: '8px 0', margin: '0 100px' }}>
        INVOICE #{invoice.invoice_number}
      </div>
    </div>
  );

  const renderHeader = () => {
    switch (layout) {
      case 'corporate': return <HeaderCorporate />;
      case 'minimal': return <HeaderMinimal />;
      case 'centered': return <HeaderCentered />;
      case 'classic':
      default: return <HeaderClassic />;
    }
  };

  return (
    <div className={styles.paper} style={{ fontFamily }}>
      {layout === 'classic' && <div className={styles.accentStrip} style={{ background: accent }} />}
      
      <div className={styles.paperContent} style={{ paddingTop: layout === 'corporate' ? '40px' : '40px' }}>
        {renderHeader()}

        {/* Details Row */}
        <div className={styles.detailsRow} style={{ borderColor: layout === 'minimal' ? 'transparent' : '#e8e5e2' }}>
          <div className={styles.detailBlock}>
            <span className={styles.detailLabel} style={{ color: accent }}>Bill To</span>
            <span className={styles.detailValue}>{invoice.client.name || 'Client Name'}</span>
            <span className={styles.detailSubtext}>
              {invoice.client.address || 'Address Line 1'}<br />
              {invoice.client.city || 'City'} {invoice.client.zip || ''}<br />
              {invoice.client.email || ''}
            </span>
          </div>
          <div className={styles.datesRow}>
            <div className={styles.detailBlock}>
              <span className={styles.detailLabel} style={{ color: accent }}>Issue Date</span>
              <span className={styles.detailValueMono}>{formatDate(invoice.issue_date)}</span>
            </div>
            <div className={styles.detailBlock}>
              <span className={styles.detailLabel} style={{ color: accent }}>Due Date</span>
              <span className={styles.detailValueMono}>{formatDate(invoice.due_date)}</span>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className={styles.tableSection}>
          <div className={styles.tableHeader} style={{ borderBottomColor: accent }}>
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
              <div className={styles.notesBox} style={{ background: layout === 'minimal' ? '#fff' : '#f8f7f5', borderColor: layout === 'minimal' ? '#eee' : '#f0eeeb' }}>
                <div className={styles.notesLabel} style={{ color: accent }}>Bank Details for Payment</div>
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
            <div className={styles.notesBox} style={{ background: layout === 'minimal' ? '#fff' : '#f8f7f5', borderColor: layout === 'minimal' ? '#eee' : '#f0eeeb' }}>
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

            <div className={styles.totalRowGrand} style={{ borderTopColor: accent, color: accent }}>
              <span>Total</span>
              <span className={styles.totalValue} style={{ color: accent }}>
                {formatCurrency(invoice.total, invoice.currency)}
              </span>
            </div>
            <div style={{ textAlign: 'right', fontSize: '8px', fontStyle: 'italic', color: '#8a8580', marginTop: '6px', lineHeight: 1.4 }}>
              {amountInWords(invoice.total, invoice.currency)}
            </div>
            
            {sender.signature && (
              <div style={{ marginTop: '20px', textAlign: 'right' }}>
                <img src={sender.signature} alt="Signature" style={{ maxHeight: '40px', display: 'inline-block' }} />
                <div style={{ fontSize: '8px', color: '#8a8580', marginTop: '4px' }}>Authorized Signatory</div>
              </div>
            )}
          </div>
        </div>

        {/* Watermark */}
        <div className={styles.watermark}>
          Generated with MrChartist Invoice Creator
        </div>
      </div>
    </div>
  );
};
