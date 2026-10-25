import { useMemo, useState } from 'react';
import { Gift, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { listCatalog } from '../../lib/catalog';
import { priceLevelsDb, schemeLabel, schemesDb, validateLevel, validateScheme, type PriceLevel, type Scheme } from '../../lib/pricing';
import { KEYS, getTable } from '../../lib/storage';
import type { Client } from '../../types/invoice';
import { cn, formatDate } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

const blankScheme = (): Scheme => ({ id: '', item_id: '', item_name: '', buy_qty: 1, free_qty: 1 });

/**
 * Price levels (Retail / Wholesale / Distributor …) and buy-X-get-Y schemes (6.9). Nothing here
 * changes how invoices are priced until a level is given to a client or a scheme is added.
 */
export function PricingPanel({ notify }: { notify: Notify }) {
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const levels = useMemo(() => priceLevelsDb.all(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schemes = useMemo(() => schemesDb.all(), [version]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of getTable<Client>(KEYS.clients)) if (c.price_level) m.set(c.price_level, (m.get(c.price_level) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const catalog = useMemo(() => listCatalog().sort((a, b) => a.name.localeCompare(b.name)), []);

  const [level, setLevel] = useState<PriceLevel | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<{ kind: 'level' | 'scheme'; id: string; name: string } | null>(null);

  const saveLevel = () => {
    if (!level) return;
    const msg = validateLevel(level, levels);
    if (msg) return setError(msg);
    priceLevelsDb.save(level);
    notify(`Price level ${level.name.trim()} saved`);
    setLevel(null);
    reload();
  };
  const saveScheme = () => {
    if (!scheme) return;
    const msg = validateScheme(scheme);
    if (msg) return setError(msg);
    schemesDb.save(scheme);
    notify(`Scheme on ${scheme.item_name} saved`);
    setScheme(null);
    reload();
  };

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Tags size={16} /> Price levels &amp; schemes
        </span>
        <div className={surface.pageActions}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => { setError(''); setLevel({ id: '', name: '', percent_off: 0 }); }}>
            <Plus size={14} /> Add price level
          </button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => { setError(''); setScheme(blankScheme()); }} disabled={catalog.length === 0}>
            <Gift size={14} /> Add scheme
          </button>
        </div>
      </div>
      <p className={cn(surface.sectionNote, styles.note)}>
        Give a client a price level (Clients → edit) and the editor and POS use that level&apos;s rates when you pick an item —
        an item&apos;s own level rate, else the level&apos;s % off its default rate. Quantity slabs are set per item above. Typing a rate on a line always wins.
      </p>

      {levels.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>Price level</th>
                <th className={surface.numeric}>% off default rate</th>
                <th className={surface.numeric}>Item rates</th>
                <th className={surface.numeric}>Clients</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id}>
                  <td className={styles.name}>{l.name}</td>
                  <td className={surface.numeric}>{l.percent_off ? `${l.percent_off}%` : '—'}</td>
                  <td className={surface.numeric}>{Object.keys(l.rates ?? {}).length}</td>
                  <td className={surface.numeric}>{usage.get(l.id) ?? 0}</td>
                  <td>
                    <div className={surface.rowActions}>
                      <button type="button" className={controls.btnIcon} aria-label={`Edit ${l.name}`} onClick={() => { setError(''); setLevel({ ...l }); }}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className={controls.btnDanger} aria-label={`Delete ${l.name}`} onClick={() => setRemoving({ kind: 'level', id: l.id, name: l.name })}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {schemes.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>Scheme</th>
                <th>Valid</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {schemes.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className={styles.name}>{s.item_name}</div>
                    <div className={styles.sub}>{schemeLabel(s)}</div>
                  </td>
                  <td>{s.valid_from || s.valid_to ? `${s.valid_from ? formatDate(s.valid_from) : '…'} – ${s.valid_to ? formatDate(s.valid_to) : '…'}` : 'Always'}</td>
                  <td>
                    <label className={controls.check}>
                      <input
                        type="checkbox"
                        checked={s.active !== false}
                        onChange={(e) => { schemesDb.save({ ...s, active: e.target.checked }); reload(); }}
                      />
                      {s.active === false ? 'Paused' : 'Running'}
                    </label>
                  </td>
                  <td>
                    <div className={surface.rowActions}>
                      <button type="button" className={controls.btnIcon} aria-label={`Edit scheme on ${s.item_name}`} onClick={() => { setError(''); setScheme({ ...s }); }}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className={controls.btnDanger} aria-label={`Delete scheme on ${s.item_name}`} onClick={() => setRemoving({ kind: 'scheme', id: s.id, name: s.item_name })}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {schemes.length > 0 && (
        <p className={cn(surface.sectionNote, styles.note)}>
          Free goods are billed as a separate ₹0 line under the paid line, and leave stock. GST is charged on the price actually paid for the
          bundle (CBIC Circular 92/11/2019-GST: &quot;buy one get one free&quot; is one supply of both items for that price), so the free line carries no
          taxable value. Verify with your CA.
        </p>
      )}

      <Modal
        open={!!level}
        onClose={() => setLevel(null)}
        size="sm"
        title={level?.id ? 'Edit price level' : 'Add price level'}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setLevel(null)}>Cancel</button>
            <button type="button" className={controls.btnPrimary} onClick={saveLevel}>Save level</button>
          </>
        }
      >
        {level && (
          <div className={styles.form}>
            <label className={controls.field}>
              <span className={controls.label}>Name *</span>
              <input className={controls.input} value={level.name} onChange={(e) => setLevel({ ...level, name: e.target.value })} placeholder="Wholesale" autoFocus />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>% off the default rate</span>
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={level.percent_off ?? 0} onChange={(n) => setLevel({ ...level, percent_off: n })} placeholder="0" />
              <span className={controls.hint}>Used for items without their own rate in this level (set those in each item&apos;s form).</span>
            </label>
            {error && <p className={controls.error} role="alert">{error}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!scheme}
        onClose={() => setScheme(null)}
        size="md"
        title={scheme?.id ? 'Edit scheme' : 'Add scheme'}
        subtitle="Buy X, get Y of the same item free"
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setScheme(null)}>Cancel</button>
            <button type="button" className={controls.btnPrimary} onClick={saveScheme}>Save scheme</button>
          </>
        }
      >
        {scheme && (
          <div className={styles.form}>
            <label className={controls.field}>
              <span className={controls.label}>Item *</span>
              <select
                className={controls.select}
                value={scheme.item_id}
                onChange={(e) => {
                  const it = catalog.find((i) => i.id === e.target.value);
                  setScheme({ ...scheme, item_id: e.target.value, item_name: it?.name ?? '' });
                }}
              >
                <option value="">Choose an item…</option>
                {catalog.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>Buy</span>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} value={scheme.buy_qty} onChange={(n) => setScheme({ ...scheme, buy_qty: n })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>Get free</span>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} value={scheme.free_qty} onChange={(n) => setScheme({ ...scheme, free_qty: n })} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>From (optional)</span>
                <input type="date" className={controls.input} value={scheme.valid_from ?? ''} onChange={(e) => setScheme({ ...scheme, valid_from: e.target.value || undefined })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>To (optional)</span>
                <input type="date" className={controls.input} value={scheme.valid_to ?? ''} onChange={(e) => setScheme({ ...scheme, valid_to: e.target.value || undefined })} />
              </label>
            </div>
            {error && <p className={controls.error} role="alert">{error}</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        destructive
        title={removing?.kind === 'level' ? 'Delete this price level?' : 'Delete this scheme?'}
        message={
          removing?.kind === 'level'
            ? `“${removing.name}” is removed and clients on it go back to default rates. Invoices already issued keep their prices.`
            : `The scheme on “${removing?.name ?? ''}” stops. Invoices already issued keep their free lines.`
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (removing?.kind === 'level') priceLevelsDb.remove(removing.id);
          else if (removing) schemesDb.remove(removing.id);
          notify('Deleted');
          reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
