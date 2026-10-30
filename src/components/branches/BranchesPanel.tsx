import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { branchesDb, type BranchRow } from '../../lib/branch';
import { priceLevelsDb } from '../../lib/pricing';
import { defineArea } from '../../i18n/area';
import { localDb } from '../../lib/localDb';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { branchT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from '../dashboard/tiles.module.css';
import { SelectField } from '../ui/SelectField';

// R4-B3: each store's price list (one of the price levels). Inline strings: this tile stays light.
const storeT = defineArea(
  { title: 'Store price lists', hint: 'The store’s POS and documents use this price list; a customer’s own price level still wins. Store-wise item rates: Settings → Items → Store prices.', none: 'No price list', saved: 'Price list of {name} saved' } as const,
  { title: 'स्टोर मूल्य सूची', hint: 'इस स्टोर का POS और दस्तावेज़ यही मूल्य सूची लेते हैं; ग्राहक का अपना मूल्य स्तर फिर भी प्राथमिक है। स्टोर-वार आइटम दरें: सेटिंग्स → आइटम → स्टोर मूल्य।', none: 'कोई मूल्य सूची नहीं', saved: '{name} की मूल्य सूची सहेजी गई' },
);

function StorePriceLists({ onChanged, notify }: { onChanged: () => void; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [tick, setTick] = useState(0);
  const branches = useMemo(() => branchesDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = useMemo(() => priceLevelsDb.all(), []);
  if (!branches.length || !levels.length) return null;
  return (
    <details>
      <summary>{storeT('title')}</summary>
      <div className={own.form}>
        {branches.map((b) => (
          <label key={b.id} className={controls.field}>
            <span className={controls.label}>{b.name}</span>
            <SelectField className={controls.select} value={b.price_level_id ?? ''} onChange={(e) => {
              try {
                branchesDb.save({ ...b, price_level_id: e.target.value || undefined });
                notify(storeT('saved', { name: b.name }));
                setTick((x) => x + 1);
                onChanged();
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}>
              <option value="">{storeT('none')}</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectField>
          </label>
        ))}
        <p className={controls.hint}>{storeT('hint')}</p>
      </div>
    </details>
  );
}

/** Branch-wise sales / returns / purchases for the FY, plus the branch master (WP-9, P1-19). */
export function BranchesPanel({ rows, canEdit, onChanged, notify, icon }: {
  rows: BranchRow[];
  canEdit: boolean;
  onChanged: () => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  icon?: ReactNode;
}) {
  useT();
  const profiles = localDb.settings.get().profiles;
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [profile, setProfile] = useState('');

  const add = () => {
    try {
      const b = branchesDb.save({ name, gstin, profile_id: profile || undefined });
      notify(branchT('added', { name: b.name }));
      setName('');
      setGstin('');
      setProfile('');
      onChanged();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card} aria-label={branchT('title')}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{icon} {branchT('title')}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        {rows.length === 0 ? <p className={controls.hint}>{branchT('empty')}</p> : (
          <table className={cn(surface.table, own.table)}>
            <thead>
              <tr><th>{branchT('colBranch')}</th><th className={surface.numeric}>{branchT('colSales')}</th><th className={surface.numeric}>{branchT('colReturns')}</th><th className={surface.numeric}>{branchT('colPurchases')}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id || 'none'}>
                  <td>{r.id ? r.name : branchT('noBranch')}</td>
                  <td className={surface.numeric}>{formatCurrency(r.sales)}</td>
                  <td className={surface.numeric}>{formatCurrency(r.returns)}</td>
                  <td className={surface.numeric}>{formatCurrency(r.purchases)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details>
            <summary>{branchT('add')}</summary>
            <div className={own.form}>
              <input className={controls.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={branchT('name')} aria-label={branchT('name')} />
              <input className={cn(controls.input, controls.inputMono)} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder={branchT('gstin')} aria-label={branchT('gstin')} maxLength={15} />
              <SelectField className={controls.select} value={profile} onChange={(e) => setProfile(e.target.value)} aria-label={branchT('profile')}>
                <option value="">{branchT('profileNone')}</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.companyName || p.id}</option>)}
              </SelectField>
              <p className={controls.hint}>{branchT('hint')}</p>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={add} disabled={!name.trim()}><Plus size={14} /> {branchT('save')}</button>
            </div>
          </details>
        )}
        {canEdit && <StorePriceLists onChanged={onChanged} notify={notify} />}
      </div>
    </section>
  );
}
