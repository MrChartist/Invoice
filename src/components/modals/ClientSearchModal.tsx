import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { patientMatch, uhidOf } from '../../lib/services/sv-find';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { clientToParty } from '../../store/invoice-defaults';
import type { Client } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { areaNodes } from '../../i18n/areas/nodes';
import styles from './PickerList.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientSearchModal({ isOpen, onClose }: Props) {
  useT(); // re-render on a language switch (5.4)
  const setClient = useInvoiceStore((s) => s.setClient);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clinic, setClinic] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClients(localDb.clients.getAll());
      setClinic(isPackOn(localDb.settings.get(), 'clinic'));
      setQuery('');
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? clients.filter((c) => [c.name, c.company, c.email, c.gstin, c.city].some((f) => f?.toLowerCase().includes(q)) || (clinic && patientMatch(c, q))) // SV-B: UHID / phone with the clinic pack
      : clients;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, query, clinic]);

  const pick = (c: Client) => {
    setClient(clientToParty(c));
    onClose();
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={salesT('pick.clientTitle')} subtitle={salesT('pick.clientSub')} flush>
      <label className={styles.search}>
        <Search size={16} />
        <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={salesT(clinic ? 'pick.clientSearchClinic' : 'pick.clientSearch')} aria-label={salesT('cl.searchAria')} />
      </label>
      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {clients.length === 0
            ? areaNodes(salesT('pick.noClients'), {
                link: (
                  <Link to="/clients" onClick={onClose} style={{ color: 'var(--brand-text)', fontWeight: 600 }}>
                    {salesT('pick.addInDirectory')}
                  </Link>
                ),
              })
            : salesT('pick.noClientMatch')}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((c) => (
            <li key={c.id ?? c.name}>
              <button type="button" className={styles.item} onClick={() => pick(c)}>
                <Avatar name={c.name} size={34} square />
                <span className={styles.main}>
                  <span className={styles.title}>{c.name}</span>
                  <span className={styles.sub}>{[clinic && uhidOf(c), c.company, c.city, c.gstin].filter(Boolean).join(' · ') || c.email || '—'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
