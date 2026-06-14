import { useState, useEffect } from 'react';
import { X, Wallet, Trash2, Plus, CheckCircle } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { formatCurrency, formatDate, currencySymbol, cn } from '../../lib/utils';
import styles from '../../pages/InvoiceCreator.module.css';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any;
  onRecorded: () => void;
}

const METHODS = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card', 'Other'];

const today = () => new Date().toISOString().split('T')[0];

export function PaymentModal({ isOpen, onClose, invoice, onRecorded }: PaymentModalProps) {
  const [payments, setPayments] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('UPI');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');

  const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const balance = Math.max(0, (invoice?.total || 0) - paid);

  const refresh = () => {
    if (invoice?.id) setPayments(localDb.payments.getForInvoice(invoice.id));
  };

  useEffect(() => {
    if (isOpen && invoice?.id) {
      const list = localDb.payments.getForInvoice(invoice.id);
      setPayments(list);
      const alreadyPaid = list.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      setAmount(String(Math.max(0, (invoice.total || 0) - alreadyPaid).toFixed(2)));
      setMethod('UPI');
      setDate(today());
      setNote('');
    }
  }, [isOpen, invoice]);

  if (!isOpen || !invoice) return null;

  const handleRecord = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    localDb.payments.record(invoice.id, { amount: amt, method, date: new Date(date).toISOString(), note });
    refresh();
    setAmount('');
    setNote('');
    onRecorded();
  };

  const handleDelete = (txId: string) => {
    localDb.payments.delete(txId);
    refresh();
    onRecorded();
  };

  const sym = currencySymbol(invoice.currency);
  const fullyPaid = balance <= 0 && paid > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', animation: 'fadeIn 200ms ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: '16px', width: '100%', maxWidth: '520px',
          boxShadow: 'var(--shadow-xl)', animation: 'scaleIn 250ms ease', overflow: 'hidden',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wallet size={20} /> Record Payment
          </h2>
          <button onClick={onClose} className={styles.btnGhost} style={{ padding: '0.5rem' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {[
              { label: 'Invoice Total', value: formatCurrency(invoice.total || 0, invoice.currency), color: 'var(--foreground)' },
              { label: 'Paid', value: formatCurrency(paid, invoice.currency), color: 'var(--profit)' },
              { label: 'Balance', value: formatCurrency(balance, invoice.currency), color: balance > 0 ? 'var(--warning)' : 'var(--profit)' },
            ].map(s => (
              <div key={s.label} style={{ padding: '0.875rem', background: 'var(--card-inner)', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: '0.35rem' }}>{s.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
            <strong style={{ color: 'var(--primary)' }}>{invoice.invoice_number}</strong> · {invoice.client?.name || 'Unknown Client'}
          </div>

          {fullyPaid ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.875rem 1rem', background: 'rgba(37,160,90,0.1)', color: 'var(--profit)', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600 }}>
              <CheckCircle size={18} /> This invoice is fully paid.
            </div>
          ) : (
            <>
              {/* New payment form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Amount</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }}>{sym}</span>
                    <input className={styles.input} type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{ paddingLeft: '28px' }} />
                  </div>
                </div>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Method</label>
                  <select className={styles.input} value={method} onChange={e => setMethod(e.target.value)} style={{ cursor: 'pointer' }}>
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Date</label>
                  <input className={styles.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Note (optional)</label>
                  <input className={styles.input} value={note} onChange={e => setNote(e.target.value)} placeholder="Ref / remark" />
                </div>
              </div>
              <button
                onClick={handleRecord}
                disabled={!parseFloat(amount) || parseFloat(amount) <= 0}
                className={cn(styles.btn, styles.btnPrimary)}
                style={{ width: '100%', padding: '0.875rem', opacity: (!parseFloat(amount) || parseFloat(amount) <= 0) ? 0.6 : 1 }}
              >
                <Plus size={16} /> Record Payment
              </button>
            </>
          )}

          {/* History */}
          {payments.length > 0 && (
            <div>
              <div className={styles.label} style={{ marginBottom: '0.5rem' }}>Payment History</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {payments.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.875rem', background: 'var(--card-inner)', borderRadius: '8px', fontSize: '0.8125rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatCurrency(p.amount, invoice.currency)}</div>
                      <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem' }}>
                        {p.method} · {formatDate(p.date)}{p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(p.id)} className={styles.btnGhost} style={{ color: 'var(--destructive)', padding: '0.35rem' }} title="Delete payment">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
