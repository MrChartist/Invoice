import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { Client } from '../../types/invoice';
import styles from './PickerList.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientSearchModal({ isOpen, onClose }: Props) {
  const setClient = useInvoiceStore((s) => s.setClient);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    if (isOpen) {
      setClients(localDb.clients.getAll());
      setQuery('');
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? clients.filter((c) => [c.name, c.company, c.email, c.gstin, c.city].some((f) => f?.toLowerCase().includes(q)))
      : clients;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, query]);

  const pick = (c: Client) => {
    setClient({
      name: c.name ?? '',
      company: c.company ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      state_code: c.state_code ?? '',
      zip: c.zip ?? '',
      gstin: c.gstin ?? '',
    });
    onClose();
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Choose a client" subtitle="From your local directory" flush>
      <label className={styles.search}>
        <Search size={16} />
        <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company, city or GSTIN" aria-label="Search clients" />
      </label>
      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {clients.length === 0 ? (
            <>
              No saved clients yet. Type the details on the invoice — they are saved automatically — or{' '}
              <Link to="/clients" onClick={onClose} style={{ color: 'var(--brand-text)', fontWeight: 600 }}>
                add one in the directory
              </Link>
              .
            </>
          ) : (
            'No clients match your search.'
          )}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((c) => (
            <li key={c.id ?? c.name}>
              <button type="button" className={styles.item} onClick={() => pick(c)}>
                <Avatar name={c.name} size={34} square />
                <span className={styles.main}>
                  <span className={styles.title}>{c.name}</span>
                  <span className={styles.sub}>{[c.company, c.city, c.gstin].filter(Boolean).join(' · ') || c.email || '—'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
