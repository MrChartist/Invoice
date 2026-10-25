import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency } from '../../lib/utils';
import { pickCatalogItem } from '../creator/pricing-actions';
import type { InvoiceItem } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import styles from './PickerList.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The line item that receives the chosen catalogue entry. */
  targetItemId: string;
}

export function ItemSearchModal({ isOpen, onClose, targetItemId }: Props) {
  useT(); // re-render on a language switch (5.4)
  const currency = useInvoiceStore((s) => s.currency);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([]);

  useEffect(() => {
    if (isOpen) {
      setItems(localDb.items.getAll());
      setQuery('');
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name?.toLowerCase().includes(q) || i.hsn?.toLowerCase().includes(q) || i.barcode?.toLowerCase() === q || i.sku?.toLowerCase().includes(q)) : items;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [items, query]);

  return (
    <Modal open={isOpen} onClose={onClose} title={salesT('pick.itemTitle')} subtitle={salesT('pick.itemSub')} flush>
      <label className={styles.search}>
        <Search size={16} />
        <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={salesT('pick.itemSearch')} aria-label={salesT('pick.itemSearchAria')} />
      </label>
      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {items.length === 0 ? salesT('pick.noItems') : salesT('pick.noItemMatch')}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  pickCatalogItem(targetItemId, item);
                  onClose();
                }}
              >
                <span className={styles.main}>
                  <span className={styles.title}>{item.name}</span>
                  <span className={styles.sub}>
                    {[item.hsn && `HSN/SAC ${item.hsn}`, typeof item.tax_rate === 'number' && `GST ${item.tax_rate}%`, item.unit].filter(Boolean).join(' · ') || item.type || salesT('pick.service')}
                  </span>
                </span>
                <span className={styles.price}>{formatCurrency(item.rate, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
