/**
 * R18-A3 tariff view: the society's State, cycle, bill day, due days and area unit; the charge heads (name, kind, basis,
 * rate, SAC, on); "Apply State defaults" (bases / rates from the State's data rows — a bill not in force applies only
 * after "They are in force for us"); the State hints (never blocks); and the monthly bill preview of the first 50 units
 * with totals for all (member charges, statutory dues outside GST, total). B adds the ₹7,500 test column.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { INDIAN_STATES } from '../../lib/india-states';
import { localDb } from '../../lib/localDb';
import { generateId } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { applyStateDefaults, BASES, chargeTotals, CYCLES, HEAD_KINDS, newHead, pendingStateRule, periodOf, sacFor, stateRule, tariffHints, unitCharges } from '../../lib/society/hs-tariff';
import { sortUnits } from '../../lib/society/hs-units';
import { loadUnits } from '../../lib/society/hs-units-save';
import { readSocietySettings, saveSocietySettings } from '../../lib/society/hs-settings';
import type { HsBasis, HsCycle, HsHead, HsHeadKind, SocietySettings } from '../../types/society-r18';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { numIn, row } from './hs-form';

const PREVIEW = 50;

export default function HeadsView({ notify }: HsViewProps) {
  useT();
  const today = todayInput();
  const [s, setS] = useState<SocietySettings>(() => {
    const cur = readSocietySettings();
    return { ...cur, state: cur.state ?? localDb.settings.activeProfile()?.companyGstin?.slice(0, 2) ?? undefined, heads: cur.heads ?? [] };
  });
  const units = useMemo(() => sortUnits(loadUnits()).filter((u) => u.status === 'active'), []);
  const heads = s.heads ?? [];
  const set = (p: Partial<SocietySettings>) => setS((x) => ({ ...x, ...p }));
  const head = (i: number, p: Partial<HsHead>) => set({ heads: heads.map((h, k) => (k === i ? { ...h, ...p } : h)) });
  const rule = stateRule(s.state, today, s.confirmed);
  const pending = pendingStateRule(s.state, today, s.confirmed);
  const stName = INDIAN_STATES.find((x) => x.code === s.state)?.name ?? s.state ?? '';
  const hints = tariffHints(heads, rule, !!pending);
  const period = periodOf(today, s.cycle ?? 'monthly');
  const previewRows = units.map((u) => ({ u, t: chargeTotals(unitCharges(u, heads, period, { areaUnit: s.area_unit })) }));
  const preview = { rows: previewRows.slice(0, PREVIEW), all: previewRows.reduce((a, r) => ({ member: a.member + r.t.member, statutory: a.statutory + r.t.statutory, total: a.total + r.t.total }), { member: 0, statutory: 0, total: 0 }) };
  const run = (fn: () => void) => { try { fn(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => { setS(saveSocietySettings({ state: s.state, cycle: s.cycle ?? 'monthly', bill_day: s.bill_day ?? 1, due_days: s.due_days ?? 15, area_unit: s.area_unit ?? 'sqft', heads, confirmed: s.confirmed })); notify(hsT('savedTariff')); });
  return (
    <section data-hs-heads>
      <div style={row}>
        <F label={hsT('state')}>
          <select className={controls.select} value={s.state ?? ''} onChange={(e) => set({ state: e.target.value || undefined })} data-hs-state>
            <option value="">{hsT('pick')}</option>
            {INDIAN_STATES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
        </F>
        <F label={hsT('cycle')}>
          <select className={controls.select} value={s.cycle ?? 'monthly'} onChange={(e) => set({ cycle: e.target.value as HsCycle })} data-hs-cycle>
            {CYCLES.map((c) => <option key={c} value={c}>{hsList('cycles', CYCLES, c)}</option>)}
          </select>
        </F>
        <F label={hsT('billDay')}><input type="number" min={1} max={28} className={controls.input} value={s.bill_day ?? 1} onChange={(e) => set({ bill_day: numIn(e.target.value) })} /></F>
        <F label={hsT('dueDays')}><input type="number" min={0} max={120} className={controls.input} value={s.due_days ?? 15} onChange={(e) => set({ due_days: numIn(e.target.value) })} /></F>
        <F label={hsT('areaUnit')}>
          <select className={controls.select} value={s.area_unit ?? 'sqft'} onChange={(e) => set({ area_unit: e.target.value as 'sqft' | 'sqm' })}>
            <option value="sqft">sq ft</option>
            <option value="sqm">sq m</option>
          </select>
        </F>
      </div>
      {hints.map((h) => (
        <p key={h.code} className={controls.hint} style={{ color: 'var(--warning)' }} data-hs-hint={h.code}>
          {hsT(h.code, { v: h.value ?? '', m: h.limit ?? '', s: stName, ca: h.ca })}
          {h.code === 'proposed' && s.state && <label className={controls.check}> <input type="checkbox" onChange={(e) => e.target.checked && set({ confirmed: [...(s.confirmed ?? []), s.state!] })} data-hs-confirm /> {hsT('confirm')}</label>}
        </p>
      ))}
      {!rule && !pending && <p className={controls.hint}>{hsT('noState')}</p>}
      <div className={surface.tableWrap}>
        <table className={surface.table} data-hs-head-grid>
          <thead><tr><th>{hsT('head')}</th><th>{hsT('kind')}</th><th>{hsT('basis')}</th><th>{hsT('rate')}</th><th>{hsT('sac')}</th><th>{hsT('active')}</th><th /></tr></thead>
          <tbody>
            {heads.map((h, i) => (
              <tr key={h.id} data-hs-head={h.kind}>
                <td><input className={controls.input} aria-label={hsT('head')} value={h.name} onChange={(e) => head(i, { name: e.target.value })} /></td>
                <td>
                  <select className={controls.select} aria-label={hsT('kind')} value={h.kind} onChange={(e) => head(i, { kind: e.target.value as HsHeadKind, sac: sacFor(e.target.value as HsHeadKind, today) || undefined })}>
                    {HEAD_KINDS.map((k) => <option key={k} value={k}>{hsList('kinds', HEAD_KINDS, k)}</option>)}
                  </select>
                </td>
                <td>
                  <select className={controls.select} aria-label={hsT('basis')} value={h.basis} onChange={(e) => head(i, { basis: e.target.value as HsBasis })} data-hs-head-basis>
                    {BASES.map((b) => <option key={b} value={b}>{hsList('bases', BASES, b)}</option>)}
                  </select>
                </td>
                <td><input type="number" min={0} step="any" className={controls.input} aria-label={hsT('rate')} value={h.rate} onChange={(e) => head(i, { rate: numIn(e.target.value) ?? 0 })} data-hs-head-rate /></td>
                <td><input className={controls.input} aria-label={hsT('sac')} value={h.sac ?? ''} maxLength={6} onChange={(e) => head(i, { sac: e.target.value || undefined })} style={{ width: '6rem' }} /></td>
                <td><input type="checkbox" aria-label={hsT('active')} checked={h.active !== false} onChange={(e) => head(i, { active: e.target.checked })} /></td>
                <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ heads: heads.filter((_, k) => k !== i) })}>{hsT('remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={row}>
        <button type="button" className={controls.btnOutline} onClick={() => set({ heads: applyStateDefaults(heads, rule, today, generateId) })} data-hs-apply-defaults>{hsT('applyDefaults')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => set({ heads: [...heads, newHead('other', '', rule, today, generateId())] })} data-hs-add-head>{hsT('addHead')}</button>
        <button type="button" className={controls.btnPrimary} onClick={save} data-hs-save-tariff>{hsT('saveTariff')}</button>
      </div>
      {units.length > 0 && heads.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-preview={period}>
            <caption style={{ textAlign: 'left', fontWeight: 600 }}>{hsT('preview')} · {period}</caption>
            <thead><tr><th>{hsT('unit')}</th><th className={surface.numeric}>{hsT('memberCharges')}</th><th className={surface.numeric}>{hsT('statutory')}</th><th className={surface.numeric}>{hsT('total')}</th></tr></thead>
            <tbody>
              {preview.rows.map(({ u, t }) => (
                <tr key={u.id} data-hs-preview-unit={u.code} data-hs-preview-member={t.member} data-hs-preview-total={t.total}>
                  <td>{u.code}</td><td className={surface.numeric}>{formatCurrency(t.member)}</td><td className={surface.numeric}>{formatCurrency(t.statutory)}</td><td className={surface.numeric}>{formatCurrency(t.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th>{hsT('total')}</th><td className={surface.numeric}>{formatCurrency(preview.all.member)}</td><td className={surface.numeric}>{formatCurrency(preview.all.statutory)}</td><td className={surface.numeric}>{formatCurrency(preview.all.total)}</td></tr></tfoot>
          </table>
          {units.length > PREVIEW && <p className={controls.hint}>{hsT('firstN', { n: PREVIEW, m: units.length })}</p>}
        </div>
      )}
    </section>
  );
}
