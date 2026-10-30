/**
 * R19-A3 rates view: the charge heads grid (name, kind, role, unit, default rate, currency, SAC — the default SAC shown
 * when blank — on) with "Default heads". The lane rate sheets, "Quote from sheet" and quotation → job were cut at the
 * R19-A cap (PRD §3 cut 2): each head's own rate is the default a charge sheet starts from.
 */
import { useState } from 'react';
import { t, useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import { generateId } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { LG_HEAD_KINDS, LG_ROLES, LG_UNITS, sacFor } from '../../lib/logistics/lg-heads';
import { addDefaultHeads, readLogisticsSettings, saveLogisticsSettings } from '../../lib/logistics/lg-settings';
import type { LgHead } from '../../types/logistics-r19';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import type { LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';
import { SelectField } from '../ui/SelectField';

export default function RatesView({ notify }: LgViewProps) {
  useT();
  const [heads, setHeads] = useState<LgHead[]>(() => readLogisticsSettings().heads ?? []);
  const act = (fn: () => LgHead[] | undefined) => { try { setHeads(fn() ?? []); notify(lgT('saved')); } catch (e) { notify((e as Error).message, 'error'); } };
  const setH = (i: number, p: Partial<LgHead>) => setHeads(heads.map((h, k) => (k === i ? { ...h, ...p } : h)));
  const cell = (i: number, k: 'name' | 'currency' | 'sac', w: string) => <input className={controls.input} style={{ width: w }} aria-label={lgT(k)} value={heads[i][k] ?? ''} placeholder={k === 'sac' ? sacFor(heads[i].kind, todayInput()) : undefined} onChange={(e) => setH(i, { [k]: e.target.value })} />;
  const sel = <K extends 'kind' | 'role' | 'unit'>(i: number, k: K, ids: readonly LgHead[K][], list: 'kinds' | 'roles' | 'units') => (
    <SelectField className={controls.select} aria-label={lgT(k)} value={heads[i][k]} onChange={(e) => setH(i, { [k]: e.target.value })}>{ids.map((x) => <option key={x} value={x}>{lgList(list, ids, x)}</option>)}</SelectField>
  );
  return (
    <>
      <div style={row}>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => addDefaultHeads(todayInput()).heads)} data-lg-default-heads>{lgT('defaults')}</button>
        <button type="button" className={controls.btnGhost} onClick={() => setHeads([...heads, { id: generateId(), name: '', kind: 'other', role: 'own', unit: 'per_shipment', active: true }])}>{lgT('addHead')}</button>
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => saveLogisticsSettings({ heads }).heads)} data-lg-save-heads>{t('common.save')}</button>
      </div>
      {heads.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr>{(['name', 'kind', 'role', 'unit', 'rate', 'currency', 'sac', 'active'] as const).map((k) => <th key={k}>{lgT(k)}</th>)}</tr></thead>
            <tbody>
              {heads.map((h, i) => (
                <tr key={h.id}>
                  <td>{cell(i, 'name', '12rem')}</td>
                  <td>{sel(i, 'kind', LG_HEAD_KINDS, 'kinds')}</td>
                  <td>{sel(i, 'role', LG_ROLES, 'roles')}</td>
                  <td>{sel(i, 'unit', LG_UNITS, 'units')}</td>
                  <td><input type="number" min={0} step="any" className={controls.input} style={{ width: '6rem' }} aria-label={lgT('rate')} value={h.rate ?? ''} onChange={(e) => setH(i, { rate: numIn(e.target.value) })} /></td>
                  <td>{cell(i, 'currency', '4rem')}</td>
                  <td>{cell(i, 'sac', '5rem')}</td>
                  <td><input type="checkbox" aria-label={lgT('active')} checked={h.active} onChange={(e) => setH(i, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
