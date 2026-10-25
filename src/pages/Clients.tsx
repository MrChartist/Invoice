import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BellRing, Download, FileUp, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Scale, Search, Send, Trash2, UserPlus, Users } from 'lucide-react';
import { ImportWizard } from '../components/import/ImportWizard';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { salesT } from '../i18n/areas/sales';
import { khataT } from '../i18n/areas/khata';
import { ClientFormModal } from '../components/modals/ClientFormModal';
import { localDb } from '../lib/localDb';
import { can } from '../lib/access';
import { isRevenueDoc } from '../lib/stats';
import { ADVANCES_TABLE, advanceBalance } from '../lib/advance-tax';
import { getTable } from '../lib/storage';
import type { AdvanceRecord } from '../types/advances';
import { formatCurrency } from '../lib/utils';
import type { Client } from '../types/invoice';
import { loadKhataReport } from '../lib/khata-actions';
import { buildWhatsAppStatement, khataRows, khataTotals, sortKhataRows, type KhataRow, type KhataSort } from '../lib/khata';
import { whatsappLink } from '../lib/share';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Clients.module.css';
import { receivableTotal } from '../lib/rcm';
import { clientsCsv, contactSearchFields } from '../lib/contacts';
import { downloadText } from '../lib/download';
import { s2T } from '../i18n/areas/sales-r2';

// Daily khata loop (8A): the quick ₹ Received / ₹ Given sheet and the reminder queue load on first use.
const QuickEntrySheet = lazy(() => import('../components/khata/QuickEntrySheet'));
const RemindQueue = lazy(() => import('../components/khata/RemindQueue'));
// PWA shortcut "Payment in" (`/clients?pay=1`, 8E wiring): pick the party, then the ₹ Received sheet.
const PartyPicker = lazy(() => import('../components/khata/PartyPicker'));

export function Clients() {
  const { notify, toastNode } = useToast();
  const { t } = useT();
  // Local roles (6.21): a viewer can look clients up but not change them.
  const edit = can('master.edit');
  const canReceive = can('payment.record');
  const canGive = can('doc.create');
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<KhataSort>('balance');
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [entry, setEntry] = useState<{ mode: 'received' | 'given'; row: KhataRow } | null>(null);
  const [queue, setQueue] = useState<'overdue' | 'balance' | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [picking, setPicking] = useState(() => searchParams.get('pay') === '1' && canReceive);
  useEffect(() => {
    if (searchParams.get('pay') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('pay');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // `/clients?new=1` (from the command palette) opens the add dialog directly;
  // `/clients?edit=<id>` (from the TDS register) opens that client's editor.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (edit && (searchParams.get('new') === '1' || editId)) {
      setEditing(editId ? localDb.clients.getById(editId) ?? null : null);
      setFormOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, edit]);

  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clients = useMemo(() => localDb.clients.getAll(), [version]);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);

  // Balance per party (8.1): the receivables ledger incl. opening bills, credit notes and advances.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const report = useMemo(() => loadKhataReport().report, [version]);
  const rows = useMemo(() => khataRows(clients, report), [clients, report]);
  const totals = useMemo(() => khataTotals(rows), [rows]);

  // Billed per client, keyed by lower-cased name (invoices snapshot the client).
  const billed = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const inv of localDb.invoices.getAll()) {
      const key = inv.client?.name?.trim().toLowerCase();
      if (!key || !isRevenueDoc(inv)) continue;
      const row = map.get(key) ?? { total: 0, count: 0 };
      row.total += receivableTotal(inv);
      row.count += 1;
      map.set(key, row);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Unadjusted advances (5.3) per client id and lower-cased name.
  const advanceOpen = useMemo(() => {
    const map = new Map<string, number>();
    const advances = getTable<AdvanceRecord>(ADVANCES_TABLE);
    if (!advances.length) return map;
    const payments = localDb.payments.getAll();
    const invoices = localDb.invoices.getAll();
    for (const a of advances) {
      const open = advanceBalance(a, payments, invoices).open;
      if (open <= 0.004) continue;
      const key = a.client?.id || `name:${(a.client?.name ?? '').trim().toLowerCase()}`;
      map.set(key, (map.get(key) ?? 0) + open);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? rows.filter(({ client: c }) => c && [c.name, c.company, c.email, c.phone, c.city, c.gstin, c.pan, c.tan, ...contactSearchFields(c)].some((f) => f?.toLowerCase().includes(q)))
      : rows;
    if (overdueOnly) list = list.filter((r) => r.overdue > 0.004);
    return sortKhataRows(list, sort);
  }, [rows, query, overdueOnly, sort]);

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
        title={salesT('cl.title')}
        subtitle={salesT('cl.subtitle', { n: clients.length })}
        actions={
          edit ? (
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setImportOpen(true)}>
                <FileUp size={16} /> {salesT('cl.import')}
              </button>
              {/* R2-B4: client list with the first contact / address columns (the import reads them back). */}
              <button type="button" className={controls.btnOutline} disabled={!clients.length} onClick={() => downloadText('clients.csv', clientsCsv(clients), 'text/csv')} data-clients-csv>
                <Download size={16} /> {s2T('exportCsv')}
              </button>
              <button type="button" className={controls.btnPrimary} onClick={openAdd}>
                <Plus size={16} /> {salesT('cl.add')}
              </button>
            </>
          ) : undefined
        }
      />

      {clients.length > 0 && (
        <section className={`${surface.card} ${styles.khata}`} aria-label={khataT('colBalance')}>
          <div className={styles.totals}>
            <div className={styles.total}>
              <span className={styles.totalLabel}>{khataT('youGet')}</span>
              <strong className={styles.get} data-you-get>{formatCurrency(totals.youGet, 'INR')}</strong>
            </div>
            <div className={styles.total}>
              <span className={styles.totalLabel}>{khataT('youGive')}</span>
              <strong className={styles.give}>{formatCurrency(totals.youGive, 'INR')}</strong>
            </div>
          </div>
          <div className={styles.khataActions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setQueue('overdue')} disabled={totals.overdueParties === 0}
              title={totals.overdueParties ? khataT('overdueParties', { n: totals.overdueParties, amount: formatCurrency(totals.overdue, 'INR') }) : khataT('noOverdue')}>
              <BellRing size={14} /> {khataT('remindAll')}
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setQueue('balance')} disabled={totals.youGet <= 0}>
              <Send size={14} /> {khataT('sendBalances')}
            </button>
          </div>
        </section>
      )}

      <section className={surface.card}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={salesT('cl.searchPh')}
              aria-label={salesT('cl.searchAria')}
            />
          </label>
          <div className={styles.filters}>
            <button type="button" className={overdueOnly ? styles.chipOn : styles.chip} aria-pressed={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
              {khataT('overdueOnly')}{totals.overdueParties > 0 ? ` · ${totals.overdueParties}` : ''}
            </button>
            <label className={styles.sort}>
              <span className={surface.srOnly}>{khataT('sort')}</span>
              <select className={controls.select} value={sort} onChange={(e) => setSort(e.target.value as KhataSort)} aria-label={khataT('sort')}>
                <option value="balance">{khataT('sortBalance')}</option>
                <option value="overdue">{khataT('sortOverdue')}</option>
                <option value="name">{khataT('sortName')}</option>
              </select>
            </label>
          </div>
        </div>

        {clients.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title={t('list.clientsEmptyTitle')}
            text={t('list.clientsEmptyText')}
            action={
              edit ? (
                <button type="button" className={controls.btnPrimary} onClick={openAdd}>
                  <Plus size={16} /> {t('list.clientsAddFirst')}
                </button>
              ) : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title={t('common.noMatches')} text={t('common.tryOtherSearch')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={`${surface.table} ${styles.directory}`}>
              <thead>
                <tr>
                  <th>{salesT('cl.colClient')}</th>
                  <th>{salesT('cl.colContact')}</th>
                  <th>{salesT('cl.colLocation')}</th>
                  <th>{salesT('cl.colGstin')}</th>
                  <th className={surface.numeric}>{khataT('colBalance')}</th>
                  <th aria-label={salesT('actions')} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const c = row.client!;
                  const b = billed.get(c.name?.trim().toLowerCase() ?? '');
                  const adv = (c.id ? advanceOpen.get(c.id) : 0) || advanceOpen.get(`name:${c.name.trim().toLowerCase()}`) || 0;
                  const waHref = row.party ? whatsappLink(c.phone, buildWhatsAppStatement({ sender, party: row.party })) : null;
                  return (
                    <tr key={c.id ?? c.name} data-client-row={c.name}>
                      <td className={styles.cWho}>
                        <div className={styles.who}>
                          <Avatar name={c.name} size={34} square />
                          <div>
                            <div className={styles.name}>{c.name}</div>
                            {c.company && <div className={styles.sub}>{c.company}</div>}
                          </div>
                        </div>
                      </td>
                      <td className={styles.cContact} data-empty={!c.email && !c.phone ? 'true' : undefined}>
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
                          {!c.email && !c.phone && !c.contacts?.length && <span className={styles.sub}>—</span>}
                          {c.contacts?.length ? <span className={styles.sub}>{s2T('c.nContacts', { n: c.contacts.length })}</span> : null}
                        </div>
                      </td>
                      <td className={styles.cLoc} data-empty={!c.city && !c.state ? 'true' : undefined}>
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
                      <td className={`${surface.mono} ${styles.cGst}`} data-empty={!c.gstin && !c.pan && !c.tan ? 'true' : undefined}>
                        {c.gstin || (!c.pan && !c.tan && <span className={styles.sub}>—</span>)}
                        {(c.pan || c.tan) && (
                          <div className={styles.sub}>{[c.pan && `PAN ${c.pan}`, c.tan && `TAN ${c.tan}`].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td className={`${surface.numeric} ${styles.cBilled}`}>
                        <span className={row.kind === 'collect' ? styles.collect : row.kind === 'advance' ? styles.advance : styles.settled} data-balance={row.net}>
                          {row.kind === 'collect'
                            ? khataT('toCollect', { amount: formatCurrency(row.net, 'INR') })
                            : row.kind === 'advance'
                              ? khataT('advance', { amount: formatCurrency(-row.net, 'INR') })
                              : khataT('settled')}
                        </span>
                        {row.overdue > 0.004 && (
                          <div className={styles.overdue}>{khataT('overdueLine', { amount: formatCurrency(row.overdue, 'INR'), n: row.oldestOverdueDays })}</div>
                        )}
                        {b && (
                          <div className={styles.sub}>
                            {formatCurrency(b.total)} · {b.count === 1 ? salesT('cl.invoicesOne') : salesT('cl.invoicesMany', { n: b.count })}
                          </div>
                        )}
                        {adv > 0 && (
                          <div className={styles.sub}>
                            <Link to={`/receivables?tab=advances&party=${encodeURIComponent(c.id ?? `name:${c.name.trim().toLowerCase()}`)}`}>{salesT('cl.advance', { amount: formatCurrency(adv) })}</Link>
                          </div>
                        )}
                      </td>
                      <td className={styles.cAct}>
                        <div className={`${surface.rowActions} ${styles.acts}`}>
                          {canReceive && (
                            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm} ${styles.money}`}
                              onClick={() => setEntry({ mode: 'received', row })} aria-label={khataT('receivedFrom', { name: c.name })} title={khataT('receivedFrom', { name: c.name })}>
                              {khataT('received')}
                            </button>
                          )}
                          {canGive && (
                            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm} ${styles.money}`}
                              onClick={() => setEntry({ mode: 'given', row })} aria-label={khataT('givenTo', { name: c.name })} title={khataT('givenTo', { name: c.name })}>
                              {khataT('given')}
                            </button>
                          )}
                          {waHref && (
                            <a href={waHref} target="_blank" rel="noopener noreferrer" className={controls.btnIcon} data-wa-statement
                              aria-label={khataT('waStatementFor', { name: c.name })} title={khataT('waStatement')}>
                              <MessageCircle size={16} />
                            </a>
                          )}
                          <Link to={`/receivables?tab=statements&party=${encodeURIComponent(row.key)}`} className={controls.btnIcon} aria-label={salesT('cl.statementFor', { name: c.name })} title={salesT('cl.statement')}>
                            <Scale size={16} />
                          </Link>
                          {edit && (
                            <>
                              <button type="button" className={controls.btnIcon} onClick={() => openEdit(c)} aria-label={salesT('cl.editOf', { name: c.name })} title={salesT('edit')}>
                                <Pencil size={16} />
                              </button>
                              <button type="button" className={controls.btnDanger} onClick={() => setDeleting(c)} aria-label={salesT('cl.deleteOf', { name: c.name })} title={salesT('delete')}>
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
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

      {entry && entry.row.client && (
        <Suspense fallback={null}>
          <QuickEntrySheet
            mode={entry.mode}
            client={entry.row.client}
            party={entry.row.party}
            onClose={() => setEntry(null)}
            onSaved={(message) => {
              setVersion((v) => v + 1);
              notify(message);
            }}
          />
        </Suspense>
      )}
      {picking && (
        <Suspense fallback={null}>
          <PartyPicker
            rows={rows}
            onClose={() => setPicking(false)}
            onPick={(row) => {
              setPicking(false);
              setEntry({ mode: 'received', row });
            }}
          />
        </Suspense>
      )}
      {queue && (
        <Suspense fallback={null}>
          <RemindQueue kind={queue} onClose={() => setQueue(null)} onChanged={() => setVersion((v) => v + 1)} />
        </Suspense>
      )}
      <ImportWizard
        open={importOpen}
        kind="clients"
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setVersion((v) => v + 1);
          notify(salesT('cl.imported'));
        }}
      />
      <ClientFormModal
        open={formOpen}
        client={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(c, isNew) => {
          setVersion((v) => v + 1);
          notify(salesT(isNew ? 'cl.added' : 'cl.updated', { name: c.name }));
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={salesT('cl.deleteTitle')}
        message={salesT('cl.deleteMsg', { name: deleting?.name ?? '' })}
        confirmLabel={salesT('cl.deleteConfirm')}
        onConfirm={() => {
          if (deleting?.id) localDb.clients.remove(deleting.id);
          setVersion((v) => v + 1);
          notify(salesT('cl.deleted'));
        }}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
