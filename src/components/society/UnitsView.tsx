/**
 * R18-A2 units view: every unit with its wing, use, carpet area, construction cost, member(s), occupancy and parking;
 * filters by wing / use / occupancy; totals of area, cost and slots; the undivided-interest warning; "New unit" and a
 * unit's form; a CSV / XLSX import (preview, all or nothing, one undo copy first; the file reader, header scoring and
 * backup load only when a file is chosen).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { localDb } from '../../lib/localDb';
import { formatCurrency } from '../../lib/utils';
import { filterUnits, memberNames, OCCUPANCIES, sortUnits, unitTotals, unitWarnings, wingsOf, type UnitFilter } from '../../lib/society/hs-units';
import { applyUnitsImport, loadUnits } from '../../lib/society/hs-units-save';
import { guessUnitColumns, planUnitsImport, UNIT_IMPORT_TEMPLATE, type UnitColumns, type UnitImportPlan, type UnitTable } from '../../lib/society/hs-units-import';
import { reloadAfterFlush } from '../../lib/storage';
import { readSocietySettings } from '../../lib/society/hs-settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import UnitForm from './UnitForm';
import { Field, type HsViewProps } from './hs-ui';
import { row } from './hs-form';

export default function UnitsView({ notify }: HsViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<UnitFilter>({});
  const [imp, setImp] = useState<{ t: UnitTable; cols: UnitColumns; plan: UnitImportPlan; name: string } | null>(null);
  const [undo, setUndo] = useState(false);
  const data = useMemo(() => {
    void tick;
    const clients = localDb.clients.getAll();
    return { units: sortUnits(loadUnits()), clients, byId: new Map(clients.map((c) => [c.id ?? '', c])), heads: readSocietySettings().heads ?? [] };
  }, [tick]);
  const err = (e: unknown) => notify((e as Error).message, 'error');
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const [{ readFileTables }, { scoreHeader }] = await Promise.all([import('../marketplace/file-read'), import('../../lib/import-mapping')]);
      const t = (await readFileTables(file))[0]?.table;
      if (!t) throw new Error(hsT('impNoCode'));
      const cols = guessUnitColumns(t.headers, scoreHeader);
      setImp({ t, cols, name: file.name, plan: planUnitsImport(t, cols, data.units, data.clients) });
    } catch (e) { err(e); }
  };
  const runImport = async () => {
    if (!imp) return;
    try {
      const b = await import('../../lib/backup');
      const copy = await b.saveSafetySnapshot('import').catch(() => false);
      if (!copy && !window.confirm(hsT('impNoCopy'))) return;
      const r = applyUnitsImport(imp.t, imp.cols, imp.name);
      notify(hsT('impDone', { c: r.created, u: r.updated, m: r.members }), 'success');
      setUndo(copy); setImp(null); setTick((x) => x + 1);
    } catch (e) { err(e); }
  };
  const undoImport = async () => {
    try {
      const b = await import('../../lib/backup');
      const snap = await b.getSafetySnapshot();
      if (snap) { b.restoreBackup(snap.data); await b.clearSafetySnapshot(); }
      notify(hsT('impUndone')); setUndo(false); setTimeout(reloadAfterFlush, 600);
    } catch (e) { err(e); }
  };
  const template = async () => (await import('../../lib/download')).downloadText('society-units-template.csv', `${UNIT_IMPORT_TEMPLATE}\nA-101,A,residential,650,,,2400000,Asha Rao,9820012345,,owner,,1,,\n`, 'text/csv');
  if (imp) {
    const p = imp.plan;
    return (
      <section data-hs-import>
        <p className={controls.hint} data-hs-import-sum>{hsT('impSum', { c: p.create, u: p.update, e: p.errors, m: p.newMembers.join(', ') || '0' })}</p>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{hsT('row')}</th><th>{hsT('unit')}</th><th>{hsT('member')}</th><th>{hsT('error')}</th></tr></thead>
            <tbody>{p.rows.slice(0, 50).map((r) => <tr key={r.line} data-hs-import-row={r.code}><td>{r.line}</td><td>{r.code}</td><td>{r.owner?.name}</td><td style={{ color: r.error ? 'var(--danger)' : 'var(--sys-orange-ink)' }}>{r.error ?? r.warning}</td></tr>)}</tbody>
          </table>
        </div>
        {p.errors > 0 && <p className={controls.hint}>{hsT('impFix')}</p>}
        <div style={row}>
          <button type="button" className={controls.btnPrimary} disabled={p.errors > 0 || !p.rows.length} onClick={() => void runImport()} data-hs-import-go>{hsT('impGo')}</button>
          <button type="button" className={controls.btnGhost} onClick={() => setImp(null)}>{hsT('cancel')}</button>
        </div>
      </section>
    );
  }
  if (open !== null) return <UnitForm key={open} unit={data.units.find((u) => u.id === open)} units={data.units} clients={data.clients} heads={data.heads} notify={notify} onDone={() => { setTick((t) => t + 1); setOpen(null); }} />;
  const shown = filterUnits(data.units, f);
  const tot = unitTotals(shown);
  const pick = (k: keyof UnitFilter, ids: readonly string[], name: (id: string) => string) => (
    <Field label={hsT(k)}>
      <select className={controls.select} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value || undefined })}>
        <option value="">{hsT('all')}</option>
        {ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </select>
    </Field>
  );
  return (
    <>
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={() => setOpen('')} data-hs-new-unit>{hsT('newUnit')}</button>
        <label className={controls.btnOutline}>{hsT('imp')}<input type="file" accept=".csv,.xlsx" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} data-hs-import-file /></label>
        <button type="button" className={controls.btnGhost} onClick={() => void template()}>{hsT('impTpl')}</button>
        {undo && <button type="button" className={controls.btnOutline} onClick={() => void undoImport()} data-hs-import-undo>{hsT('impUndo')}</button>}
        {pick('wing', wingsOf(data.units), (w) => w)}
        {pick('occupancy', OCCUPANCIES, (o) => hsList('occs', OCCUPANCIES, o))}
      </div>
      {unitWarnings(data.units).map((w) => <p key={w} className={controls.hint} style={{ color: 'var(--sys-orange-ink)' }}>{w}</p>)}
      {data.units.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-units>
            <thead><tr><th>{hsT('unit')}</th><th className={surface.numeric}>{hsT('carpet')}</th><th className={surface.numeric}>{hsT('cost')}</th><th>{hsT('member')}</th><th>{hsT('occupancy')}</th><th className={surface.numeric}>{hsT('parking')}</th><th /></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} data-hs-unit={u.code}>
                  <td>{u.code}</td>
                  <td className={surface.numeric}>{u.carpet_area}</td>
                  <td className={surface.numeric}>{u.construction_cost ? formatCurrency(u.construction_cost) : ''}</td>
                  <td>{memberNames(u, data.byId).join(', ')}</td>
                  <td>{hsList('occs', OCCUPANCIES, u.occupancy)}</td>
                  <td className={surface.numeric}>{u.parking.length || ''}</td>
                  <td><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(u.id)} data-hs-open-unit={u.code}>{hsT('open')}</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>{hsT('total')} ({shown.length})</th><td className={surface.numeric}>{tot.carpet}</td><td className={surface.numeric}>{formatCurrency(tot.cost)}</td><td /><td /><td className={surface.numeric}>{tot.slots}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      ) : <p className={controls.hint}>{hsT('none')}</p>}
    </>
  );
}
