import { useState, useEffect } from 'react';
import { Search, X, Package } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency } from '../../lib/utils';

interface ItemSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetItemId: string; // The ID of the line item to update
}

export function ItemSearchModal({ isOpen, onClose, targetItemId }: ItemSearchModalProps) {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const invoice = useInvoiceStore();

  useEffect(() => {
    if (isOpen) {
      setItems(localDb.items.getAll());
      setSearch('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = items.filter(i => 
    i.name?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (item: any) => {
    invoice.updateItem(targetItemId, 'name', item.name || '');
    invoice.updateItem(targetItemId, 'rate', item.rate || 0);
    invoice.updateItem(targetItemId, 'type', item.type || 'Service');
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem'
    }}>
      <div style={{
        background: 'var(--card)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '480px', border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={18} /> Select Service / Item
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--card-inner)' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0 0.75rem' }}>
            <Search size={16} color="var(--muted-foreground)" />
            <input 
              autoFocus
              type="text" 
              placeholder="Search items catalog..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, border: 'none', padding: '0.75rem', background: 'transparent', outline: 'none', color: 'var(--foreground)' }}
            />
          </div>
        </div>

        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              No items found. Type item details directly in the form to save automatically.
            </div>
          ) : (
            filtered.map((item) => (
              <button 
                key={item.id}
                onClick={() => handleSelect(item)}
                style={{
                  width: '100%', textAlign: 'left', padding: '1rem 1.25rem',
                  border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent',
                  cursor: 'pointer', transition: 'background 0.2s ease', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{item.name}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>{item.type || 'Service'}</div>
                </div>
                <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(item.rate, invoice.currency)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
