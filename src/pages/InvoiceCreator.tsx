import { useState } from 'react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { Download, Send, Plus, Search, Trash2, Library } from 'lucide-react';
import { InvoicePreviewModal } from '../components/preview/InvoicePreview';
import { ClientSearchModal } from '../components/modals/ClientSearchModal';
import { ItemSearchModal } from '../components/modals/ItemSearchModal';
import { Toast } from '../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import styles from './InvoiceCreator.module.css';

export function InvoiceCreator() {
  const invoice = useInvoiceStore();
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [itemSearchTargetId, setItemSearchTargetId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleStatusClass = () => {
    switch (invoice.status) {
      case 'Draft': return styles.badgeDraft;
      case 'Sent': return styles.badgeSent;
      case 'Paid': return styles.badgePaid;
      case 'Overdue': return styles.badgeOverdue;
      default: return '';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          New Invoices: {invoice.invoice_number || 'MGL...'}
          <span className={cn(styles.badge, handleStatusClass())}>{invoice.status}</span>
        </h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {/* Top right actions could go here */}
        </div>
      </div>
      
      <div className={styles.grid}>
        {/* Left Column */}
        <div className={styles.leftColumn}>
          
          {/* Company Card (Dark style) */}
          <div className={cn(styles.card, styles.cardDark)}>
            <div className={styles.cardBody} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, backgroundColor: 'var(--primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.5rem', color: 'white' }}>
                  M
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>MrChartist</h3>
                  <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>billing@mrchartist.com</p>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
                <p>123 Dalal Street</p>
                <p>Mumbai, MH 400001</p>
                <p>India</p>
              </div>
            </div>
          </div>

          {/* Invoice Meta */}
          <div className={styles.card}>
            <div className={styles.cardBody} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Invoice Number</label>
                  <input type="text" className={styles.inputGhost} value={invoice.invoice_number} readOnly placeholder="Auto-generated" />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Issued Date</label>
                  <p style={{ fontWeight: 500, paddingTop: '0.5rem' }}>{formatDate(invoice.issue_date)}</p>
                </div>
              </div>
              <div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Billed To</label>
                  <input 
                    type="text" 
                    className={styles.inputGhost} 
                    placeholder="Select or type client name..."
                    value={invoice.client.name}
                    onChange={(e) => invoice.setClient({ name: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Items Grid */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Item Details</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', fontWeight: 400 }}>Auto-saving to localDb</span>
            </div>
            <div className={styles.cardBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                <div className={styles.label}>ITEM</div>
                <div className={styles.label}>QTY</div>
                <div className={styles.label}>RATE</div>
                <div className={styles.label} style={{ textAlign: 'right' }}>AMOUNT</div>
                <div></div>
              </div>
              
              {invoice.items.map((item) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ position: 'relative' }}>
                    <input 
                      className={cn(styles.input, styles.inputGhost)} 
                      placeholder="Description" 
                      value={item.name}
                      onChange={(e) => invoice.updateItem(item.id, 'name', e.target.value)}
                      style={{ width: '100%', paddingRight: '32px' }}
                    />
                    <button 
                      onClick={() => setItemSearchTargetId(item.id)}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}
                      title="Search Item Catalog"
                    >
                      <Library size={14} />
                    </button>
                  </div>
                  <input 
                    type="number" 
                    className={cn(styles.input, styles.inputGhost)} 
                    placeholder="1" 
                    value={item.quantity || ''}
                    onChange={(e) => invoice.updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ color: 'var(--muted-foreground)' }}>₹</span>
                    <input 
                      type="number" 
                      className={cn(styles.input, styles.inputGhost)} 
                      placeholder="0.00" 
                      value={item.rate || ''}
                      onChange={(e) => invoice.updateItem(item.id, 'rate', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 500 }}>
                    {formatCurrency(item.amount, invoice.currency)}
                  </div>
                  <button className={styles.btnGhost} style={{ padding: '0.5rem', color: 'var(--destructive)' }} onClick={() => invoice.removeItem(item.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <button className={styles.btnGhost} style={{ marginTop: '1rem', color: 'var(--primary)' }} onClick={invoice.addItem}>
                <Plus size={16} /> Add Item
              </button>

              {/* Totals */}
              <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '2rem', alignItems: 'center' }}>
                  <span className={styles.label}>Subtotal</span>
                  <span style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '2rem', alignItems: 'center' }}>
                  <span className={styles.label} style={{ color: 'var(--profit)' }}>Discount (%)</span>
                  <input 
                    type="number" 
                    className={cn(styles.input, styles.inputGhost)} 
                    style={{ textAlign: 'right', padding: 0 }}
                    value={invoice.discount_rate || ''}
                    onChange={(e) => invoice.setRates(parseFloat(e.target.value) || 0, invoice.tax_rate)}
                    placeholder="0"
                  />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '2rem', alignItems: 'center' }}>
                  <span className={styles.label}>Tax (%)</span>
                  <input 
                    type="number" 
                    className={cn(styles.input, styles.inputGhost)} 
                    style={{ textAlign: 'right', padding: 0 }}
                    value={invoice.tax_rate || ''}
                    onChange={(e) => invoice.setRates(invoice.discount_rate, parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '2rem', alignItems: 'center', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '2px solid var(--border)' }}>
                  <span className={styles.label} style={{ fontSize: '1rem', color: 'var(--foreground)' }}>Total</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-display)' }}>
                    {formatCurrency(invoice.total, invoice.currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className={styles.rightColumn}>
          
          {/* Client Details Card */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              Client Details
            </div>
            <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className={styles.avatar} style={{ width: 48, height: 48 }}>
                  <img src={`https://api.dicebear.com/7.x/initials/svg?seed=${invoice.client.name || 'Client'}`} alt="Client" />
                </div>
                <div style={{ flex: 1 }}>
                  <input 
                    className={cn(styles.input, styles.inputGhost)} 
                    style={{ fontSize: '1.125rem', fontWeight: 600, padding: 0, height: 'auto' }}
                    placeholder="Client Name"
                    value={invoice.client.name}
                    onChange={(e) => invoice.setClient({ name: e.target.value })}
                  />
                  <input 
                    className={cn(styles.input, styles.inputGhost)} 
                    style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', padding: 0, height: 'auto', marginTop: '0.25rem' }}
                    placeholder="Email Address"
                    value={invoice.client.email}
                    onChange={(e) => invoice.setClient({ email: e.target.value })}
                  />
                </div>
              </div>
              
              <div className={styles.inputGroup}>
                <input 
                  className={cn(styles.input, styles.inputGhost)} 
                  placeholder="Company Name (Optional)"
                />
                <textarea 
                  className={cn(styles.input, styles.inputGhost)} 
                  placeholder="Full Address"
                  rows={2}
                  value={invoice.client.address}
                  onChange={(e) => invoice.setClient({ address: e.target.value })}
                  style={{ resize: 'none' }}
                />
              </div>

              <button 
                className={cn(styles.btn, styles.btnGhost)} 
                style={{ width: '100%', backgroundColor: 'rgba(37, 160, 90, 0.1)', color: 'var(--profit)' }}
                onClick={() => setIsCrmOpen(true)}
              >
                <Search size={16} /> Search Local CRM
              </button>
            </div>
          </div>

          {/* Basic Info & Actions Card */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              Actions & Info
            </div>
            <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Invoice Date</label>
                <input 
                  type="date" 
                  className={styles.input} 
                  value={invoice.issue_date}
                  onChange={(e) => invoice.setDates(e.target.value, invoice.due_date)}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Due Date</label>
                <input 
                  type="date" 
                  className={styles.input} 
                  value={invoice.due_date}
                  onChange={(e) => invoice.setDates(invoice.issue_date, e.target.value)}
                />
              </div>

              <button 
                className={cn(styles.btn, styles.btnPrimary)} 
                style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
                onClick={() => {
                  invoice.saveInvoice();
                  setToastMessage("Invoice Saved Successfully!");
                  setTimeout(() => {
                    navigate('/transactions');
                  }, 1500);
                }}
              >
                <Send size={18} /> Save Invoice & Close
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <button 
                  className={cn(styles.btn, styles.btnGhost)} 
                  style={{ border: '1px solid var(--border)' }}
                  onClick={() => setIsPreviewOpen(true)}
                >
                  Preview
                </button>
                <button 
                  className={cn(styles.btn, styles.btnOutline)} 
                  style={{ color: 'var(--primary)' }}
                  onClick={() => setIsPreviewOpen(true)} // Can also just open preview which has download button
                >
                  <Download size={16} /> Download
                </button>
              </div>
            </div>
          </div>
          
        </div>
      </div>
      <InvoicePreviewModal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} />
      <ClientSearchModal isOpen={isCrmOpen} onClose={() => setIsCrmOpen(false)} />
      <ItemSearchModal isOpen={!!itemSearchTargetId} onClose={() => setItemSearchTargetId(null)} targetItemId={itemSearchTargetId || ''} />
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
    </div>
  );
}
