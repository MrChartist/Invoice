import type { Invoice, LineItem } from '../../types/invoice';
import { Plus, Trash2, FileText, Users, Calculator, StickyNote, Building } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { formatCurrency } from '../../lib/utils';
import { useInvoiceStore } from '../../store/InvoiceContext';
import styles from './InvoiceForm.module.css';

interface InvoiceFormProps {
  invoice: Partial<Invoice>;
  onChange: (invoice: Partial<Invoice>) => void;
}

export const InvoiceForm = ({ invoice, onChange }: InvoiceFormProps) => {
  const { state } = useInvoiceStore();
  const profiles = state.profiles;

  const handleItemChange = (id: string, field: keyof LineItem, value: string | number) => {
    const newItems = invoice.items?.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ) || [];
    onChange({ ...invoice, items: newItems });
  };

  const addItem = () => {
    const newItem: LineItem = {
      id: uuidv4(),
      description: '',
      quantity: 1,
      rate: 0,
      taxRate: 18,
    };
    onChange({ ...invoice, items: [...(invoice.items || []), newItem] });
  };

  const removeItem = (id: string) => {
    onChange({ ...invoice, items: invoice.items?.filter(item => item.id !== id) || [] });
  };

  return (
    <div className={styles.formRoot}>
      {/* Page Header */}
      <div>
        <h2 className={styles.pageTitle}>Create Invoice</h2>
        <p className={styles.pageSubtitle}>Fill in details below — preview updates in real time.</p>
      </div>

      {/* Sender Profile */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><Building size={14} /></span>
          Sender Profile
        </h3>
        <div className={styles.fieldGrid}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Select Company Profile</label>
            <select
              className={styles.select}
              value={invoice.senderId || profiles[0]?.id || ''}
              onChange={e => onChange({ ...invoice, senderId: e.target.value })}
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.gstin ? `(GST: ${p.gstin})` : ''}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Basic Info Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><FileText size={14} /></span>
          Basic Information
        </h3>
        <div className={styles.fieldGrid}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Invoice Number</label>
            <input
              className={styles.input}
              value={invoice.invoiceNumber || ''}
              onChange={e => onChange({ ...invoice, invoiceNumber: e.target.value })}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Currency</label>
            <select
              className={styles.select}
              value={invoice.currency || 'INR'}
              onChange={e => onChange({ ...invoice, currency: e.target.value })}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Issue Date</label>
            <input
              className={styles.input}
              type="date"
              value={invoice.issueDate || ''}
              onChange={e => onChange({ ...invoice, issueDate: e.target.value })}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Due Date</label>
            <input
              className={styles.input}
              type="date"
              value={invoice.dueDate || ''}
              onChange={e => onChange({ ...invoice, dueDate: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Bill To Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><Users size={14} /></span>
          Bill To
        </h3>
        <div className={styles.fieldGrid}>
          <div className={`${styles.fieldGroup} ${styles.fieldFull}`}>
            <label className={styles.label}>Client Name</label>
            <input
              className={styles.input}
              placeholder="e.g. SAHI Capital"
              value={invoice.clientName || ''}
              onChange={e => onChange({ ...invoice, clientName: e.target.value })}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Client Email</label>
            <input
              className={styles.input}
              placeholder="client@example.com"
              type="email"
              value={invoice.clientEmail || ''}
              onChange={e => onChange({ ...invoice, clientEmail: e.target.value })}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Client GSTIN (Optional)</label>
            <input
              className={styles.input}
              placeholder="27XXXXX..."
              value={invoice.clientGstin || ''}
              onChange={e => onChange({ ...invoice, clientGstin: e.target.value })}
            />
          </div>
          <div className={`${styles.fieldGroup} ${styles.fieldFull}`}>
            <label className={styles.label}>Client Address</label>
            <input
              className={styles.input}
              placeholder="Mumbai, Maharashtra, India"
              value={invoice.clientAddress || ''}
              onChange={e => onChange({ ...invoice, clientAddress: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Line Items Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><Calculator size={14} /></span>
          Line Items
        </h3>

        {invoice.items?.map((item, index) => (
          <div key={item.id} className={styles.lineItemPanel}>
            <div className={styles.lineItemHeader}>
              <span className={styles.lineItemNumber}>Item {index + 1}</span>
              <button
                className={styles.deleteBtn}
                onClick={() => removeItem(item.id)}
                aria-label="Delete item"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className={styles.lineItemGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Description</label>
                <input
                  className={styles.input}
                  placeholder="Service description"
                  value={item.description}
                  onChange={e => handleItemChange(item.id, 'description', e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Qty</label>
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  step="1"
                  value={item.quantity}
                  onChange={e => handleItemChange(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Rate</label>
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  step="100"
                  value={item.rate}
                  onChange={e => handleItemChange(item.id, 'rate', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className={styles.lineItemAmount}>
              {formatCurrency(item.quantity * item.rate, invoice.currency)}
            </div>
          </div>
        ))}

        <button className={styles.addItemBtn} onClick={addItem}>
          <Plus size={16} /> Add Line Item
        </button>
      </div>

      {/* Tax & Discount Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><Calculator size={14} /></span>
          Tax & Discount
        </h3>
        <div className={styles.fieldGrid}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Tax Type</label>
            <select
              className={styles.select}
              value={invoice.taxConfig?.type || 'IGST'}
              onChange={e => onChange({ ...invoice, taxConfig: { ...invoice.taxConfig!, type: e.target.value as 'IGST' | 'CGST_SGST' } })}
            >
              <option value="IGST">IGST (Inter-state)</option>
              <option value="CGST_SGST">CGST + SGST (Intra-state)</option>
              <option value="NONE">No Tax</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Discount ({invoice.currency === 'INR' ? '₹' : '$'})</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="100"
              value={invoice.discount || 0}
              onChange={e => onChange({ ...invoice, discount: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>

      {/* Notes Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.cardTitleIcon}><StickyNote size={14} /></span>
          Notes & Terms
        </h3>
        <div className={styles.fieldGroup}>
          <textarea
            className={styles.textarea}
            placeholder="Payment terms, bank details, or thank you note..."
            value={invoice.notes || ''}
            onChange={e => onChange({ ...invoice, notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
};
