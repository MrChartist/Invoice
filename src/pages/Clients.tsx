import { useState, useEffect } from 'react';
import { localDb, generateId } from '../lib/localDb';
import { formatDate } from '../lib/utils';
import { Users, Search, Trash2, Plus, X, UserPlus, Edit3, Mail, MapPin, Building } from 'lucide-react';
import styles from './InvoiceCreator.module.css';

interface ClientFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
}

const emptyForm: ClientFormData = { name: '', email: '', phone: '', address: '', city: '', state: '', gstin: '' };

export function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientFormData>(emptyForm);

  const reload = () => setClients(localDb.clients.getAll());
  useEffect(() => { reload(); }, []);

  const filtered = clients.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id: string) => {
    const all = localDb.clients.getAll().filter((c: any) => c.id !== id);
    localStorage.setItem('mrchartist_inv_clients', JSON.stringify(all));
    reload();
  };

  const handleEdit = (client: any) => {
    setEditingId(client.id);
    setForm({
      name: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      gstin: client.gstin || '',
    });
    setModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const all = localDb.clients.getAll();
    if (editingId) {
      const idx = all.findIndex((c: any) => c.id === editingId);
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...form, updated_at: new Date().toISOString() };
      }
    } else {
      all.push({ id: generateId(), ...form, created_at: new Date().toISOString() });
    }
    localStorage.setItem('mrchartist_inv_clients', JSON.stringify(all));
    setModalOpen(false);
    reload();
  };

  return (
    <div className={styles.container} style={{ animation: 'fadeInUp 400ms ease' }}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users size={24} /> Client Directory
        </h1>
        <button onClick={handleAddNew} className={`${styles.btn} ${styles.btnPrimary}`} style={{ padding: '0.75rem 1.5rem' }}>
          <Plus size={18} /> Add Client
        </button>
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
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(99,102,241,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <UserPlus size={36} color="#6366f1" />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '0.5rem' }}>
                {clients.length === 0 ? 'No clients yet' : 'No matches found'}
              </h3>
              <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
                {clients.length === 0
                  ? 'Add your first client to build your local CRM. Clients are also saved automatically when you create invoices.'
                  : 'Try adjusting your search terms.'
                }
              </p>
              {clients.length === 0 && (
                <button onClick={handleAddNew} className={`${styles.btn} ${styles.btnPrimary}`} style={{ padding: '0.75rem 2rem' }}>
                  <Plus size={18} /> Add First Client
                </button>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>City</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>GSTIN</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600 }}>Added</th>
                  <th style={{ padding: '1rem 0', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client: any) => (
                  <tr key={client.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                    <td style={{ padding: '1rem 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, rgba(240,112,32,0.15), rgba(240,112,32,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8125rem', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>
                          {(client.name || 'C')[0].toUpperCase()}
                        </div>
                        <div style={{ fontWeight: 600 }}>{client.name}</div>
                      </div>
                    </td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.email || '—'}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.city || '—'}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{client.gstin || '—'}</td>
                    <td style={{ padding: '1rem 0', color: 'var(--muted-foreground)' }}>{client.created_at ? formatDate(client.created_at) : '—'}</td>
                    <td style={{ padding: '1rem 0', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                        <button onClick={() => handleEdit(client)} className={styles.btnGhost} style={{ color: 'var(--primary)', padding: '0.5rem' }} title="Edit client">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => handleDelete(client.id)} className={styles.btnGhost} style={{ color: 'var(--destructive)', padding: '0.5rem' }} title="Delete client">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add/Edit Client Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 200ms ease',
        }} onClick={() => setModalOpen(false)}>
          <div style={{
            background: 'var(--card)', borderRadius: '16px', width: '100%', maxWidth: '520px',
            boxShadow: 'var(--shadow-xl)', animation: 'scaleIn 250ms ease',
            overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ padding: '1.5rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserPlus size={20} /> {editingId ? 'Edit Client' : 'Add New Client'}
              </h2>
              <button onClick={() => setModalOpen(false)} className={styles.btnGhost} style={{ padding: '0.5rem' }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>Client / Company Name *</label>
                <div style={{ position: 'relative' }}>
                  <Building size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
                  <input className={styles.input} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Acme Corp" style={{ paddingLeft: '36px' }} autoFocus />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Email</label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
                    <input className={styles.input} value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="client@company.com" style={{ paddingLeft: '36px' }} />
                  </div>
                </div>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Phone</label>
                  <input className={styles.input} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+91 98765 43210" />
                </div>
              </div>

              <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>Address</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--muted-foreground)' }} />
                  <textarea className={styles.input} value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="123 Main St, Building A" rows={2} style={{ paddingLeft: '36px', resize: 'none' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>City</label>
                  <input className={styles.input} value={form.city} onChange={e => setForm({...form, city: e.target.value})} placeholder="Mumbai" />
                </div>
                <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>State</label>
                  <input className={styles.input} value={form.state} onChange={e => setForm({...form, state: e.target.value})} placeholder="Maharashtra" />
                </div>
              </div>

              <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>GSTIN</label>
                <input className={styles.input} value={form.gstin} onChange={e => setForm({...form, gstin: e.target.value.toUpperCase()})} placeholder="22AAAAA0000A1Z5" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }} />
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setModalOpen(false)} className={`${styles.btn} ${styles.btnGhost}`}>Cancel</button>
              <button onClick={handleSave} className={`${styles.btn} ${styles.btnPrimary}`} disabled={!form.name.trim()}>
                {editingId ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
