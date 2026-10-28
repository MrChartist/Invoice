/**
 * R18-A2 units view: every unit with its wing, use, areas, construction cost, member(s), occupancy and parking; filters
 * by wing / use / occupancy; totals of area, cost and slots; the undivided-interest warning; "New unit", a unit's form,
 * and the CSV / XLSX import (owners matched by name + phone; new members created only on confirmation).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { localDb } from '../../lib/localDb';
import { formatCurrency } from '../../lib/utils';
import { filterUnits, memberNames, OCCUPANCIES, sortUnits, UNIT_USES, unitTotals, unitWarnings, wingsOf, type UnitFilter } from '../../lib/society/hs-units';
import { mapUnitsTable, type UnitImport } from '../../lib/society/hs-units-import';
import { applyUnitImport, loadUnits } from '../../lib/society/hs-units-save';
import { readSocietySettings } from '../../lib/society/hs-settings';
import { readFileTables } from '../marketplace/file-read';
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
  const [imp, setImp] = useState<(UnitImport & { file: string }) | null>(null);
  const [createOwners, setCreateOwners] = useState(true);
  const data = useMemo(() => {
    void tick;
    const units = sortUnits(loadUnits());
    const clients = localDb.clients.getAll();
    return { units, clients, byId: new Map(clients.filter((c) => c.id).map((c) => [c.id!, c])), settings: readSocietySettings() };
  }, [tick]);
  const shown = filterUnits(data.units, f);
  const tot = unitTotals(shown);
  const warn = unitWarnings(data.units);
  const au = data.settings.area_unit === 'sqm' ? 'sq m' : 'sq ft';
  const sel = open ? data.units.find((u) => u.id === open) : undefined;
  if (open !== null) {
    return <UnitForm key={open} unit={sel} units={data.units} clients={data.clients} heads={data.settings.heads ?? []} notify={notify} onDone={() => { setTick((t) => t + 1); setOpen(null); }} />;
  }
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const t = (await readFileTables(file))[0]?.table;
      if (!t) throw new Error('No table with a header row was found in the file.');
      setImp({ ...mapUnitsTable(t, data.clients, data.units), file: file.name });
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const confirmImport = () => {
    if (!imp) return;
    try {
      const r = applyUnitImport(imp, { createOwners, fileName: imp.file });
      notify(hsT('imported', { n: r.created, m: r.owners }));
      setImp(null);
      setTick((t) => t + 1);
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const sel3 = (k: keyof UnitFilter, label: string, ids: readonly string[], name: (id: string) => string) => (
    <Field label={label}>
      <select className={controls.select} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value || undefined })} data-hs-filter={k}>
        <option value="">{hsT('all')}</option>
        {ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </select>
    </Field>
  );
  return (
    <>
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={() => setOpen('')} data-hs-new-unit>{hsT('newUnit')}</button>
        {sel3('wing', hsT('wing'), wingsOf(data.units), (w) => w)}
        {sel3('use', hsT('use'), UNIT_USES, (u) => hsList('uses', UNIT_USES, u))}
        {sel3('occupancy', hsT('occupancy'), OCCUPANCIES, (o) => hsList('occs', OCCUPANCIES, o))}
        <Field label={hsT('import')}>
          <input type="file" accept=".csv,.xlsx,.xlsm,text/csv" className={controls.input} onChange={(e) => void onFile(e.target.files?.[0])} data-hs-import />
        </Field>
      </div>
      <p className={controls.hint}>{hsT('importHint')}</p>
      {imp && (
        <fieldset style={row} data-hs-import-preview>
          {imp.unmatched.length > 0 && <p className={controls.hint} data-hs-unmatched>{hsT('unmatched', { c: imp.unmatched.join('; ') })}</p>}
          {imp.skipped.length > 0 && <p className={controls.hint}>{hsT('skipped', { c: imp.skipped.join('; ') })}</p>}
          {imp.unmatched.length > 0 && <label className={controls.check}><input type="checkbox" checked={createOwners} onChange={(e) => setCreateOwners(e.target.checked)} /> {hsT('createOwners', { n: imp.unmatched.length })}</label>}
          <button type="button" className={controls.btnPrimary} disabled={!imp.rows.length} onClick={confirmImport} data-hs-import-confirm>{hsT('importConfirm', { n: imp.rows.length })}</button>
          <button type="button" className={controls.btnGhost} onClick={() => setImp(null)}>{hsT('cancel')}</button>
        </fieldset>
      )}
      {warn.map((w) => <p key={w} className={controls.hint} style={{ color: 'var(--warning)' }}>{w}</p>)}
      {data.units.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-units>
            <thead><tr><th>{hsT('unit')}</th><th>{hsT('wing')}</th><th>{hsT('use')}</th><th className={surface.numeric}>{hsT('carpet')} ({au})</th><th className={surface.numeric}>{hsT('cost')}</th><th>{hsT('member')}</th><th>{hsT('occupancy')}</th><th className={surface.numeric}>{hsT('parking')}</th><th /></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} data-hs-unit={u.code}>
                  <td>{u.code}</td>
                  <td>{u.wing ?? ''}</td>
                  <td>{hsList('uses', UNIT_USES, u.use)}</td>
                  <td className={surface.numeric}>{u.carpet_area ?? ''}</td>
                  <td className={surface.numeric}>{u.construction_cost ? formatCurrency(u.construction_cost) : ''}</td>
                  <td>{memberNames(u, data.byId).join(', ') || '—'}</td>
                  <td>{hsList('occs', OCCUPANCIES, u.occupancy)}</td>
                  <td className={surface.numeric}>{u.parking.length || ''}</td>
                  <td className={surface.rowActions}><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(u.id)} data-hs-open-unit={u.code}>{hsT('open')}</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-hs-units-total><th>{hsT('total')} ({tot.units})</th><td /><td /><td className={surface.numeric} data-hs-total-carpet={tot.carpet}>{tot.carpet}</td><td className={surface.numeric}>{formatCurrency(tot.cost)}</td><td /><td /><td className={surface.numeric}>{tot.slots}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      ) : <p className={controls.hint}>{hsT('none')}</p>}
    </>
  );
}
