import { useMemo, useState } from 'react';
import { Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { ClientFormModal } from '../components/modals/ClientFormModal';
import { localDb } from '../lib/localDb';
import { isRevenueDoc } from '../lib/stats';
import { formatCurrency } from '../lib/utils';
import type { Client } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Clients.module.css';

export function Clients() {
  const { notify, toastNode } = useToast();
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clients = useMemo(() => localDb.clients.getAll(), [version]);

  // Billed per client, keyed by lower-cased name (invoices snapshot the client).
  const billed = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const inv of localDb.invoices.getAll()) {
      const key = inv.client?.name?.trim().toLowerCase();
      if (!key || !isRevenueDoc(inv)) continue;
      const row = map.get(key) ?? { total: 0, count: 0 };
      row.total += inv.total ?? 0;
      row.count += 1;
      map.set(key, row);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? clients.filter((c) => [c.name, c.company, c.email, c.phone, c.city, c.gstin].some((f) => f?.toLowerCase().includes(q)))
      : clients;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, query]);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditing(c);
    setFormOpen(true);
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} saved · clients are also added automatically when you save an invoice`}
        actions={
          <button type="button" className={controls.btnPrimary} onClick={openAdd}>
            <Plus size={16} /> Add client
          </button>
        }
      />

      <section className={surface.card}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, city or GSTIN"
              aria-label="Search clients"
            />
          </label>
        </div>

        {clients.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No clients yet"
            text="Add a client once and pick them in a click on every future invoice."
            action={
              <button type="button" className={controls.btnPrimary} onClick={openAdd}>
                <Plus size={16} /> Add your first client
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No matches" text="Try a different search." />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>GSTIN</th>
                  <th className={surface.numeric}>Billed</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const b = billed.get(c.name?.trim().toLowerCase() ?? '');
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className={styles.who}>
                          <Avatar name={c.name} size={34} square />
                          <div>
                            <div className={styles.name}>{c.name}</div>
                            {c.company && <div className={styles.sub}>{c.company}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.contact}>
                          {c.email ? (
                            <span>
                              <Mail size={12} /> {c.email}
                            </span>
                          ) : null}
                          {c.phone ? (
                            <span>
                              <Phone size={12} /> {c.phone}
                            </span>
                          ) : null}
                          {!c.email && !c.phone && <span className={styles.sub}>—</span>}
                        </div>
                      </td>
                      <td>
                        {c.city || c.state ? (
                          <span className={styles.contact}>
                            <span>
                              <MapPin size={12} /> {[c.city, c.state].filter(Boolean).join(', ')}
                            </span>
                          </span>
                        ) : (
                          <span className={styles.sub}>—</span>
                        )}
                      </td>
                      <td className={surface.mono}>{c.gstin || <span className={styles.sub}>—</span>}</td>
                      <td className={surface.numeric}>
                        {b ? (
                          <>
                            {formatCurrency(b.total)}
                            <div className={styles.sub}>
                              {b.count} invoice{b.count === 1 ? '' : 's'}
                            </div>
                          </>
                        ) : (
                          <span className={styles.sub}>—</span>
                        )}
                      </td>
                      <td>
                        <div className={surface.rowActions}>
                          <button type="button" className={controls.btnIcon} onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`} title="Edit">
                            <Pencil size={16} />
                          </button>
                          <button type="button" className={controls.btnDanger} onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`} title="Delete">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ClientFormModal
        open={formOpen}
        client={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(c, isNew) => {
          setVersion((v) => v + 1);
          notify(isNew ? `${c.name} added` : `${c.name} updated`);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete this client?"
        message={`${deleting?.name ?? ''} will be removed from your directory. Invoices already issued keep their own copy of the client details.`}
        confirmLabel="Delete client"
        onConfirm={() => {
          if (deleting?.id) localDb.clients.remove(deleting.id);
          setVersion((v) => v + 1);
          notify('Client deleted');
        }}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
