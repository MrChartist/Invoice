/**
 * R18-A3 tariff view: the society's State, cycle, bill day and due days; the charge heads (name, kind, basis, rate, on;
 * the SAC follows the kind); "Apply State defaults" (bases / rates from the State's data rows — a bill not in force
 * applies only after "In force for us"); the State hints (never blocks); and the bill preview of the current period for
 * the first 50 units with totals for all (member charges, statutory dues outside GST, total). B adds the ₹7,500 column.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { INDIAN_STATES } from '../../lib/india-states';
import { localDb } from '../../lib/localDb';
import { generateId } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { applyStateDefaults, BASES, chargeTotals, CYCLES, HEAD_KINDS, newHead, pendingStateRule, periodOf, sacFor, stateRule, tariffHints, unitCharges } from '../../lib/society/hs-tariff';
import { loadUnits } from '../../lib/society/hs-units-save';
import { sortUnits } from '../../lib/society/hs-units';
import { readSocietySettings, saveSocietySettings, societyDefaultsFor } from '../../lib/society/hs-settings';
import type { HsBasis, HsCycle, HsHead, HsHeadKind, SocietySettings } from '../../types/society-r18';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { numIn, row } from './hs-form';

const PREVIEW = 50;

export default function HeadsView({ notify }: HsViewProps) {
  useT();
  const today = todayInput();
  const [s, setS] = useState<SocietySettings>(() => { const p = localDb.settings.activeProfile(); return societyDefaultsFor(p?.companyGstin?.slice(0, 2) || p?.stateCode, readSocietySettings()); });
  const units = useMemo(() => sortUnits(loadUnits().filter((u) => u.status === 'active')), []);
  const heads = s.heads!;
  const set = (p: Partial<SocietySettings>) => setS((x) => ({ ...x, ...p }));
  const head = (i: number, p: Partial<HsHead>) => set({ heads: heads.map((h, k) => (k === i ? { ...h, ...p } : h)) });
  const rule = stateRule(s.state, today, s.confirmed);
  const stName = INDIAN_STATES.find((x) => x.code === s.state)?.name ?? '';
  const period = periodOf(today, s.cycle);
  const rows = units.map((u) => ({ u, t: chargeTotals(unitCharges(u, heads, period, { areaUnit: s.area_unit })) }));
  const all = rows.reduce((a, r) => ({ member: a.member + r.t.member, statutory: a.statutory + r.t.statutory, total: a.total + r.t.total }), { member: 0, statutory: 0, total: 0 });
  const save = () => {
    try {
      setS(saveSocietySettings(s));
      notify(hsT('saved'));
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const money = (n: number) => <td className={surface.numeric}>{formatCurrency(n)}</td>;
  return (
    <section data-hs-heads>
      <div style={row}>
        <F label={hsT('state')}>
          <select className={controls.select} value={s.state ?? ''} onChange={(e) => set({ state: e.target.value || undefined })}>
            <option value="">—</option>
            {INDIAN_STATES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
        </F>
        <F label={hsT('cycle')}>
          <select className={controls.select} value={s.cycle ?? 'monthly'} onChange={(e) => set({ cycle: e.target.value as HsCycle })}>
            {CYCLES.map((c) => <option key={c} value={c}>{hsList('cycles', CYCLES, c)}</option>)}
          </select>
        </F>
        <F label={hsT('dueDays')}><input type="number" min={0} max={120} className={controls.input} value={s.due_days ?? 15} onChange={(e) => set({ due_days: numIn(e.target.value) })} /></F>
      </div>
      {tariffHints(heads, rule, !!pendingStateRule(s.state, today, s.confirmed)).map((h) => (
        <p key={h.code + h.value} className={controls.hint} style={{ color: 'var(--warning)' }} data-hs-hint={h.code}>
          {hsT(h.code, { h: h.head ?? '', v: h.value ?? '', m: h.limit ?? '', s: stName, ca: h.ca })}
          {h.code === 'proposed' && <label className={controls.check}> <input type="checkbox" onChange={(e) => e.target.checked && set({ confirmed: [...(s.confirmed ?? []), s.state!] })} data-hs-confirm /> {hsT('confirm')}</label>}
        </p>
      ))}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{hsT('head')}</th><th>{hsT('kind')}</th><th>{hsT('basis')}</th><th>{hsT('rate')}</th><th>{hsT('active')}</th><th /></tr></thead>
          <tbody>
            {heads.map((h, i) => (
              <tr key={h.id} data-hs-head={h.kind}>
                <td><input className={controls.input} aria-label={hsT('head')} value={h.name} onChange={(e) => head(i, { name: e.target.value })} /></td>
                <td>
                  <select className={controls.select} aria-label={hsT('kind')} value={h.kind} onChange={(e) => head(i, { kind: e.target.value as HsHeadKind, sac: sacFor(e.target.value as HsHeadKind, today) })}>
                    {HEAD_KINDS.map((k) => <option key={k} value={k}>{hsList('kinds', HEAD_KINDS, k)}</option>)}
                  </select>
                </td>
                <td>
                  <select className={controls.select} aria-label={hsT('basis')} value={h.basis} onChange={(e) => head(i, { basis: e.target.value as HsBasis })}>
                    {BASES.map((b) => <option key={b} value={b}>{hsList('bases', BASES, b)}</option>)}
                  </select>
                </td>
                <td><input type="number" min={0} step="any" className={controls.input} aria-label={hsT('rate')} value={h.rate} onChange={(e) => head(i, { rate: numIn(e.target.value) ?? 0 })} data-hs-head-rate /></td>
                <td><input type="checkbox" aria-label={hsT('active')} checked={h.active !== false} onChange={(e) => head(i, { active: e.target.checked })} /></td>
                <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ heads: heads.filter((_, k) => k !== i) })}>{hsT('del')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={row}>
        <button type="button" className={controls.btnOutline} onClick={() => set({ heads: applyStateDefaults(heads, rule, today, generateId) })} data-hs-apply-defaults>{hsT('applyDefaults')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => set({ heads: [...heads, newHead('other', '', rule, today, generateId())] })}>{hsT('addHead')}</button>
        <button type="button" className={controls.btnPrimary} onClick={save} data-hs-save-tariff>{hsT('save')}</button>
      </div>
      {rows.length > 0 && heads.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-preview={period}>
            <caption style={{ textAlign: 'left', fontWeight: 600 }}>{hsT('preview')} · {period} · {Math.min(PREVIEW, rows.length)} / {rows.length}</caption>
            <thead><tr><th>{hsT('unit')}</th><th className={surface.numeric}>{hsT('memberCharges')}</th><th className={surface.numeric}>{hsT('statutory')}</th><th className={surface.numeric}>{hsT('total')}</th></tr></thead>
            <tbody>
              {rows.slice(0, PREVIEW).map(({ u, t }) => <tr key={u.id} data-hs-preview-unit={u.code} data-hs-preview-total={t.total}><td>{u.code}</td>{money(t.member)}{money(t.statutory)}{money(t.total)}</tr>)}
            </tbody>
            <tfoot><tr><th>{hsT('total')}</th>{money(all.member)}{money(all.statutory)}{money(all.total)}</tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
