import { useState, useEffect } from 'react';
import { Search, X, User } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';

interface ClientSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientSearchModal({ isOpen, onClose }: ClientSearchModalProps) {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const invoice = useInvoiceStore();

  useEffect(() => {
    if (isOpen) {
      setClients(localDb.clients.getAll());
      setSearch('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = clients.filter(c => 
    c.name?.toLowerCase().includes(search.toLowerCase()) || 
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (client: any) => {
    invoice.setClient({
      name: client.name || '',
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      zip: client.zip || ''
    });
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
            <User size={18} /> Select Client
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
              placeholder="Search by name or email..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, border: 'none', padding: '0.75rem', background: 'transparent', outline: 'none', color: 'var(--foreground)' }}
            />
          </div>
        </div>

        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              No clients found. Type client details directly in the form to save a new one automatically.
            </div>
          ) : (
            filtered.map((client) => (
              <button 
                key={client.id}
                onClick={() => handleSelect(client)}
                style={{
                  width: '100%', textAlign: 'left', padding: '1rem 1.25rem',
                  border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent',
                  cursor: 'pointer', transition: 'background 0.2s ease', display: 'flex', flexDirection: 'column', gap: '0.25rem'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{client.name}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                  {client.email || 'No email provided'} • {client.city || 'No city provided'}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
