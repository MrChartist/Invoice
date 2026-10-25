import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { branchesDb, type BranchRow } from '../../lib/branch';
import { localDb } from '../../lib/localDb';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { branchT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from '../dashboard/tiles.module.css';

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
              <select className={controls.select} value={profile} onChange={(e) => setProfile(e.target.value)} aria-label={branchT('profile')}>
                <option value="">{branchT('profileNone')}</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.companyName || p.id}</option>)}
              </select>
              <p className={controls.hint}>{branchT('hint')}</p>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={add} disabled={!name.trim()}><Plus size={14} /> {branchT('save')}</button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
