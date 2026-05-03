import React from 'react';
import type { TemplateProps } from './registry';
import { TEMPLATES } from './registry';
import { formatCurrency, formatDate, amountInWords } from '../../lib/utils';
import { QRCodeCanvas } from 'qrcode.react';
import styles from '../preview/InvoicePreview.module.css';

export const TemplateEngine: React.FC<TemplateProps & { templateId: string }> = ({ invoice, sender, templateId }) => {
  const templateMeta = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const { layout, accent, fontFamily } = templateMeta;

  const addressLines = sender.companyAddress.split('\n');

  // New Age Header: Corporate - Massive Accent Block
  const HeaderCorporate = () => (
    <div style={{ backgroundColor: accent, color: '#fff', padding: '40px 48px', margin: '-40px -44px 40px -44px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
      <div>
        {sender.logo ? <img src={sender.logo} alt="Logo" style={{ maxHeight: '60px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }} /> : <div style={{ fontSize: '32px', fontWeight: 'bold', fontFamily, letterSpacing: '-0.03em' }}>{sender.companyName}</div>}
        <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{sender.companyTagline}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '2px', opacity: 0.95, lineHeight: 1 }}>INVOICE</div>
        <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '4px', letterSpacing: '0.05em' }}>#{invoice.invoice_number}</div>
      </div>
    </div>
  );

  // New Age Header: Minimal - Swiss Grid
  const HeaderMinimal = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '50px', borderBottom: `2px solid ${accent}`, paddingBottom: '24px' }}>
      <div>
        <div style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.02em', fontFamily, color: accent }}>INVOICE</div>
        <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', letterSpacing: '0.05em' }}>NO. {invoice.invoice_number}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '50px' }} />}
      </div>
      <div style={{ textAlign: 'right', fontSize: '10px', color: '#333', lineHeight: 1.6 }}>
        <strong style={{ fontSize: '14px', fontFamily, color: '#000', letterSpacing: '-0.01em' }}>{sender.companyName}</strong><br />
        {addressLines.map((line: string, i: number) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
        {sender.companyGstin && <><span style={{ color: '#888' }}>GSTIN:</span> {sender.companyGstin}<br/></>}
        {sender.pan && <><span style={{ color: '#888' }}>PAN:</span> {sender.pan}</>}
      </div>
    </div>
  );

  // New Age Header: Centered - Symmetrical
  const HeaderCentered = () => (
    <div style={{ textAlign: 'center', marginBottom: '50px' }}>
      {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '80px', margin: '0 auto 20px' }} />}
      <div style={{ fontSize: '32px', fontWeight: 'bold', fontFamily, color: accent, letterSpacing: '-0.02em' }}>{sender.companyName}</div>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '24px', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{sender.companyTagline}</div>
      <div style={{ display: 'inline-block', fontSize: '16px', fontWeight: '800', letterSpacing: '6px', borderTop: `2px solid ${accent}`, borderBottom: `2px solid ${accent}`, padding: '12px 32px', color: '#111' }}>
        INVOICE #{invoice.invoice_number}
      </div>
    </div>
  );

  // New Age Header: Classic - Elegant Frame
  const HeaderClassic = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
      <div>
        {sender.logo && <img src={sender.logo} alt="Logo" style={{ maxHeight: '64px', marginBottom: '16px' }} />}
        <div style={{ fontSize: '36px', fontWeight: '800', letterSpacing: '-0.04em', color: accent, fontFamily, lineHeight: 1 }}>INVOICE</div>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginTop: '6px', letterSpacing: '0.02em' }}>#{invoice.invoice_number}</div>
      </div>
      <div style={{ textAlign: 'right', maxWidth: '240px' }}>
        <div style={{ fontSize: '18px', fontWeight: '800', fontFamily, color: '#111', letterSpacing: '-0.02em' }}>{sender.companyName}</div>
        <div style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, margin: '4px 0 8px' }}>{sender.companyTagline}</div>
        <div style={{ fontSize: '10px', color: '#444', lineHeight: 1.5 }}>
          {addressLines.map((line: string, i: number) => (
            <span key={i}>{line}{i < addressLines.length - 1 && <br />}</span>
          ))}
          {sender.companyPhone && <><br />M: {sender.companyPhone}</>}
          {sender.companyEmail && <><br />{sender.companyEmail}</>}
          {sender.companyGstin && <><br /><span style={{ color: '#888' }}>GSTIN:</span> {sender.companyGstin}</>}
          {sender.pan && <><br /><span style={{ color: '#888' }}>PAN:</span> {sender.pan}</>}
        </div>
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

  // Determine outer wrap class based on layout
  let outerClass = styles.paper;
  let outerStyle: React.CSSProperties = { fontFamily };
  if (layout === 'classic') {
    outerClass = `${styles.paper} ${styles.paperFrame}`;
    outerStyle.border = `1px solid ${accent}`;
  } else if (layout === 'corporate') {
    outerClass = `${styles.paper} ${styles.paperBordered}`;
    outerStyle.borderColor = accent;
  }

  // Generate UPI QR URI
  const generateUpiUrl = () => {
    if (!sender.upiId) return '';
    return `upi://pay?pa=${sender.upiId}&pn=${encodeURIComponent(sender.accountName || sender.companyName)}&cu=INR`;
  };

  const upiUrl = generateUpiUrl();

  return (
    <div className={outerClass} style={outerStyle}>
      {layout === 'classic' && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '8px', background: accent }} />}
      
      {/* Background Watermark for Corporate/Centered */}
      {(layout === 'corporate' || layout === 'centered') && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '200px', fontWeight: '900', color: accent, opacity: 0.02, pointerEvents: 'none', zIndex: 0, whiteSpace: 'nowrap' }}>
          {sender.companyName.substring(0, 2).toUpperCase()}
        </div>
      )}

      <div className={styles.paperContent} style={{ position: 'relative', zIndex: 1, paddingLeft: layout === 'classic' ? '52px' : '44px', paddingTop: layout === 'corporate' ? '40px' : '44px' }}>
        {renderHeader()}

        {/* Details Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px', marginBottom: '40px', padding: layout === 'minimal' ? '0' : '20px', background: layout === 'minimal' ? 'transparent' : '#f9f9f9', borderRadius: '8px' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent, marginBottom: '8px' }}>Bill To</div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#111', marginBottom: '4px' }}>{invoice.client.name || 'Client Name'}</div>
            <div style={{ fontSize: '10px', color: '#555', lineHeight: 1.5 }}>
              {invoice.client.address || 'Address Line 1'}<br />
              {invoice.client.city || 'City'} {invoice.client.zip || ''}<br />
              {invoice.client.email || ''}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent, marginBottom: '8px' }}>Issue Date</div>
              <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatDate(invoice.issue_date)}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent, marginBottom: '8px' }}>Due Date</div>
              <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatDate(invoice.due_date)}</div>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.5fr 0.75fr 0.75fr', padding: '12px 16px', background: layout === 'corporate' ? `${accent}15` : '#f5f5f5', borderBottom: `2px solid ${accent}`, borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: layout === 'corporate' ? accent : '#333' }}>Description</span>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: layout === 'corporate' ? accent : '#333', textAlign: 'right' }}>Qty</span>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: layout === 'corporate' ? accent : '#333', textAlign: 'right' }}>Rate</span>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: layout === 'corporate' ? accent : '#333', textAlign: 'right' }}>Amount</span>
          </div>
          {invoice.items?.map(item => (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 0.5fr 0.75fr 0.75fr', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontSize: '11px', fontWeight: 500 }}>{item.name || '—'}</span>
              <span style={{ fontSize: '11px', color: '#666', textAlign: 'right' }}>{item.quantity}</span>
              <span style={{ fontSize: '11px', color: '#666', textAlign: 'right' }}>
                {formatCurrency(item.rate, invoice.currency)}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#111', textAlign: 'right' }}>
                {formatCurrency(item.amount, invoice.currency)}
              </span>
            </div>
          ))}
        </div>

        {/* Footer: Bank Details + Notes + Totals */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '40px', marginTop: 'auto' }}>
          
          {/* Left Column: Bank & Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Bank Details (Glassmorphic look) */}
            {(sender.accountNumber || sender.upiId) && (
              <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: '8px', padding: '16px', borderLeft: `4px solid ${accent}`, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent, marginBottom: '12px' }}>Payment Details</div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '9.5px', lineHeight: '1.8', color: '#444' }}>
                    {sender.accountName && <><strong>Account Name:</strong> <span style={{ color: '#111' }}>{sender.accountName}</span><br /></>}
                    {sender.accountNumber && <><strong>A/C No:</strong> <span style={{ color: '#111', fontFamily: 'var(--font-mono)' }}>{sender.accountNumber}</span><br /></>}
                    {sender.ifsc && <><strong>IFSC:</strong> <span style={{ color: '#111', fontFamily: 'var(--font-mono)' }}>{sender.ifsc}</span><br /></>}
                    {sender.bankName && <><strong>Bank:</strong> <span style={{ color: '#111' }}>{sender.bankName}</span><br /></>}
                    {sender.upiId && <><strong>UPI:</strong> <span style={{ color: '#111', fontFamily: 'var(--font-mono)' }}>{sender.upiId}</span></>}
                  </div>
                  
                  {/* QR Code Integration */}
                  {upiUrl && (
                    <div style={{ padding: '6px', background: '#fff', border: '1px dashed #ccc', borderRadius: '6px', textAlign: 'center' }}>
                      <QRCodeCanvas value={upiUrl} size={64} level="M" />
                      <div style={{ fontSize: '7px', marginTop: '4px', color: '#888', fontWeight: 600 }}>SCAN TO PAY</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Notes */}
            <div style={{ padding: '12px 16px', background: '#fcfcfc', borderRadius: '8px', border: '1px dashed #eee' }}>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginBottom: '6px' }}>Notes & Terms</div>
              <div style={{ fontSize: '9px', color: '#666', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {invoice.notes || 'Payment is due within 15 days of receiving this invoice. Thank you for your business.'}
              </div>
            </div>
          </div>

          {/* Right Column: Totals */}
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', background: '#f9f9f9', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#555' }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#16a34a' }}>
                  <span>Discount ({invoice.discount_rate}%)</span>
                  <span style={{ fontWeight: 600 }}>-{formatCurrency(invoice.discount_amount, invoice.currency)}</span>
                </div>
              )}
              {invoice.tax_amount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#555' }}>
                  <span>Tax ({invoice.tax_rate}%)</span>
                  <span style={{ fontWeight: 600, color: '#111' }}>{formatCurrency(invoice.tax_amount, invoice.currency)}</span>
                </div>
              )}
            </div>

            {/* Grand Total Block */}
            <div style={{ background: accent, color: '#fff', padding: '20px 24px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em' }}>TOTAL</span>
              <span style={{ fontSize: '24px', fontWeight: 900 }}>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
            
            <div style={{ textAlign: 'right', fontSize: '9px', fontStyle: 'italic', color: '#888', marginTop: '8px', lineHeight: 1.4 }}>
              Amount in words: <span style={{ fontWeight: 600, color: '#555' }}>{amountInWords(invoice.total, invoice.currency)}</span>
            </div>
            
            {/* Signature */}
            {sender.signature && (
              <div style={{ marginTop: '32px', textAlign: 'right', borderTop: '1px solid #eee', paddingTop: '16px' }}>
                <img src={sender.signature} alt="Signature" style={{ maxHeight: '50px', display: 'inline-block' }} />
                <div style={{ fontSize: '9px', color: '#888', fontWeight: 600, marginTop: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Authorized Signatory</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
