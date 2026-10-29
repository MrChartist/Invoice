import { lazy, Suspense, useMemo, useState } from 'react';
import { Gift, Pencil, Plus, Store, Tags, Trash2 } from 'lucide-react';
import { defineArea } from '../../i18n/area';

// R4-B3: store price grid (own chunk).
const StorePricesGrid = lazy(() => import('../retail/StorePricesGrid'));
const storeBtnT = defineArea({ open: 'Store prices' } as const, { open: 'स्टोर मूल्य' });
// R8-A (TR-A1): trade discounts, minimum margins, party-item special rates (own chunk, opened on demand).
const PartyRatesEditor = lazy(() => import('../trade/PartyRatesEditor'));
const tradeT = defineArea({ open: 'Trade terms & party rates' } as const, { open: 'ट्रेड शर्तें और पार्टी रेट' });
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { listCatalog } from '../../lib/catalog';
import { priceLevelsDb, schemeLabel, schemesDb, validateLevel, validateScheme, type PriceLevel, type Scheme } from '../../lib/pricing';
import { KEYS, getTable } from '../../lib/storage';
import type { Client } from '../../types/invoice';
import { cn, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';
import { libMsg } from '../../i18n/lib-msg';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

const blankScheme = (): Scheme => ({ id: '', item_id: '', item_name: '', buy_qty: 1, free_qty: 1 });

/**
 * Price levels (Retail / Wholesale / Distributor …) and buy-X-get-Y schemes (6.9). Nothing here
 * changes how invoices are priced until a level is given to a client or a scheme is added.
 */
export function PricingPanel({ notify }: { notify: Notify }) {
  useT(); // re-render on a language switch (5.4)
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

  const hasBranches = useMemo(() => getTable('branches').length > 0, []);
  const [tradeOpen, setTradeOpen] = useState(false); // R8-A
  const [gridOpen, setGridOpen] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('storeprices') === '1');
  const [level, setLevel] = useState<PriceLevel | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<{ kind: 'level' | 'scheme'; id: string; name: string } | null>(null);

  const saveLevel = () => {
    if (!level) return;
    const msg = validateLevel(level, levels);
    if (msg) return setError(libMsg(msg));
    priceLevelsDb.save(level);
    notify(setT('levelSaved', { name: level.name.trim() }));
    setLevel(null);
    reload();
  };
  const saveScheme = () => {
    if (!scheme) return;
    const msg = validateScheme(scheme);
    if (msg) return setError(libMsg(msg));
    schemesDb.save(scheme);
    notify(setT('schemeSaved', { name: scheme.item_name }));
    setScheme(null);
    reload();
  };

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Tags size={16} /> {setT('levelsSchemes')}
        </span>
        <div className={surface.pageActions}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => { setError(''); setLevel({ id: '', name: '', percent_off: 0 }); }}>
            <Plus size={14} /> {setT('addLevel')}
          </button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => { setError(''); setScheme(blankScheme()); }} disabled={catalog.length === 0}>
            <Gift size={14} /> {setT('addScheme')}
          </button>
          {/* R4-B3: item × store price grid (lazy), when the business has branches. */}
          {hasBranches && (
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setGridOpen(true)} data-store-prices>
              <Store size={14} /> {storeBtnT('open')}
            </button>
          )}
        </div>
      </div>
      <p className={cn(surface.sectionNote, styles.note)}>
        {setT('pricingNote')}
      </p>

      {levels.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{setT('thLevel')}</th>
                <th className={surface.numeric}>{setT('thPctOff')}</th>
                <th className={surface.numeric}>{setT('thItemRates')}</th>
                <th className={surface.numeric}>{setT('thClients')}</th>
                <th aria-label={setT('thActions')} />
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id}>
                  <td className={styles.name}>{l.name}</td>
                  <td className={surface.numeric}>{l.percent_off ? `${l.percent_off}%${l.basis === 'mrp' ? ` ${retailT('offMrp')}` : ''}` : '—'}</td>
                  <td className={surface.numeric}>{Object.keys(l.rates ?? {}).length}</td>
                  <td className={surface.numeric}>{usage.get(l.id) ?? 0}</td>
                  <td>
                    <div className={surface.rowActions}>
                      <button type="button" className={controls.btnIcon} aria-label={setT('editNamed', { name: l.name })} onClick={() => { setError(''); setLevel({ ...l }); }}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className={controls.btnDanger} aria-label={setT('deleteNamed', { name: l.name })} onClick={() => setRemoving({ kind: 'level', id: l.id, name: l.name })}>
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
                <th>{setT('thScheme')}</th>
                <th>{setT('thValid')}</th>
                <th>{setT('thStatus')}</th>
                <th aria-label={setT('thActions')} />
              </tr>
            </thead>
            <tbody>
              {schemes.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className={styles.name}>{s.item_name}</div>
                    <div className={styles.sub}>{schemeLabel(s)}</div>
                  </td>
                  <td>{s.valid_from || s.valid_to ? `${s.valid_from ? formatDate(s.valid_from) : '…'} – ${s.valid_to ? formatDate(s.valid_to) : '…'}` : setT('always')}</td>
                  <td>
                    <label className={controls.check}>
                      <input
                        type="checkbox"
                        checked={s.active !== false}
                        onChange={(e) => { schemesDb.save({ ...s, active: e.target.checked }); reload(); }}
                      />
                      {s.active === false ? setT('paused') : setT('running')}
                    </label>
                  </td>
                  <td>
                    <div className={surface.rowActions}>
                      <button type="button" className={controls.btnIcon} aria-label={setT('editSchemeOn', { name: s.item_name })} onClick={() => { setError(''); setScheme({ ...s }); }}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className={controls.btnDanger} aria-label={setT('deleteSchemeOn', { name: s.item_name })} onClick={() => setRemoving({ kind: 'scheme', id: s.id, name: s.item_name })}>
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
          {setT('freeGoodsNote')}
        </p>
      )}

      <Modal
        open={!!level}
        onClose={() => setLevel(null)}
        size="sm"
        title={level?.id ? setT('editLevel') : setT('addLevel')}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setLevel(null)}>{setT('cancel')}</button>
            <button type="button" className={controls.btnPrimary} onClick={saveLevel}>{setT('saveLevel')}</button>
          </>
        }
      >
        {level && (
          <div className={styles.form}>
            <label className={controls.field}>
              <span className={controls.label}>{setT('nameReq')}</span>
              <input className={controls.input} value={level.name} onChange={(e) => setLevel({ ...level, name: e.target.value })} placeholder={setT('levelNamePh')} autoFocus />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{setT('pctOffDefault')}</span>
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={level.percent_off ?? 0} onChange={(n) => setLevel({ ...level, percent_off: n })} placeholder="0" />
              <span className={controls.hint}>{setT('pctOffHint')}</span>
            </label>
            {/* 8E (8.145): "MRP less %" levels take the percent off the item's MRP. */}
            <label className={controls.field}>
              <span className={controls.label}>{retailT('levelBasis')}</span>
              <select className={controls.select} value={level.basis ?? 'rate'} onChange={(e) => setLevel({ ...level, basis: e.target.value === 'mrp' ? 'mrp' : undefined })} data-level-basis>
                <option value="rate">{retailT('basisRate')}</option>
                <option value="mrp">{retailT('basisMrp')}</option>
              </select>
            </label>
            {error && <p className={controls.error} role="alert">{error}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!scheme}
        onClose={() => setScheme(null)}
        size="md"
        title={scheme?.id ? setT('editScheme') : setT('addScheme')}
        subtitle={setT('schemeSub')}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setScheme(null)}>{setT('cancel')}</button>
            <button type="button" className={controls.btnPrimary} onClick={saveScheme}>{setT('saveScheme')}</button>
          </>
        }
      >
        {scheme && (
          <div className={styles.form}>
            <label className={controls.field}>
              <span className={controls.label}>{setT('itemReq')}</span>
              <select
                className={controls.select}
                value={scheme.item_id}
                onChange={(e) => {
                  const it = catalog.find((i) => i.id === e.target.value);
                  setScheme({ ...scheme, item_id: e.target.value, item_name: it?.name ?? '' });
                }}
              >
                <option value="">{setT('chooseItem')}</option>
                {catalog.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setT('buy')}</span>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} value={scheme.buy_qty} onChange={(n) => setScheme({ ...scheme, buy_qty: n })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{setT('getFree')}</span>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} value={scheme.free_qty} onChange={(n) => setScheme({ ...scheme, free_qty: n })} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setT('fromOpt')}</span>
                <input type="date" className={controls.input} value={scheme.valid_from ?? ''} onChange={(e) => setScheme({ ...scheme, valid_from: e.target.value || undefined })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{setT('toOpt')}</span>
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
        title={removing?.kind === 'level' ? setT('deleteLevelTitle') : setT('deleteSchemeTitle')}
        message={
          removing?.kind === 'level'
            ? setT('deleteLevelMsg', { name: removing.name })
            : setT('deleteSchemeMsg', { name: removing?.name ?? '' })
        }
        confirmLabel={setT('delete')}
        onConfirm={() => {
          if (removing?.kind === 'level') priceLevelsDb.remove(removing.id);
          else if (removing) schemesDb.remove(removing.id);
          notify(setT('deleted'));
          reload();
        }}
        onClose={() => setRemoving(null)}
      />
      {gridOpen && <Suspense fallback={null}><StorePricesGrid onClose={() => setGridOpen(false)} notify={notify} /></Suspense>}
      <details className={surface.cardBody} onToggle={(e) => setTradeOpen((e.target as HTMLDetailsElement).open)} data-trade-terms><summary>{tradeT('open')}</summary>{tradeOpen && <Suspense fallback={null}><PartyRatesEditor onDone={(m, e) => notify(m, e ? 'error' : 'success')} /></Suspense>}</details>
    </section>
  );
}
