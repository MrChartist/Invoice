import { useState, useEffect } from 'react';
import { localDb } from '../lib/localDb';
import { formatDate } from '../lib/utils';
import { Users, Search, Trash2 } from 'lucide-react';
import styles from './InvoiceCreator.module.css';

export function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setClients(localDb.clients.getAll());
  }, []);

  const filtered = clients.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id: string) => {
    const all = localDb.clients.getAll().filter((c: any) => c.id !== id);
    localStorage.setItem('mrchartist_inv_clients', JSON.stringify(all));
    setClients(all);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users size={24} /> Client Directory
        </h1>
      </div>

      {/* Search Bar */}
      <div className={styles.card} style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Search size={18} color="var(--muted-foreground)" />
          <input
            type="text"
            className={styles.inputGhost}
            placeholder="Search clients by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, fontSize: '0.9375rem' }}
          />
        </div>
      </div>

      {/* Clients Table */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)' }}>
          <span>All Clients ({filtered.length})</span>
        </div>
        <div style={{ padding: '0 1.5rem' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              {clients.length === 0
                ? 'No clients saved yet. Clients are automatically saved when you create invoices.'
                : 'No clients match your search.'
              }
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>City</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Added</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client: any) => (
                  <tr key={client.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                    <td style={{ padding: '1rem 0', fontWeight: 600 }}>{client.name}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.email || '—'}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.city || '—'}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.created_at ? formatDate(client.created_at) : '—'}</td>
                    <td style={{ padding: '1rem 0', textAlign: 'right' }}>
                      <button
                        onClick={() => handleDelete(client.id)}
                        className={styles.btnGhost}
                        style={{ color: 'var(--destructive)', padding: '0.5rem' }}
                        title="Delete client"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
