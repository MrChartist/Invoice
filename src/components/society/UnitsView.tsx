/**
 * R18-A2 units view: every unit with its wing, use, carpet area, construction cost, member(s), occupancy and parking;
 * filters by wing / use / occupancy; totals of area, cost and slots; the undivided-interest warning; "New unit" and a
 * unit's form. (The CSV / XLSX import was cut at the R18-A cap, PRD §3 cut 3.)
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { localDb } from '../../lib/localDb';
import { formatCurrency } from '../../lib/utils';
import { filterUnits, memberNames, OCCUPANCIES, sortUnits, unitTotals, unitWarnings, wingsOf, type UnitFilter } from '../../lib/society/hs-units';
import { loadUnits } from '../../lib/society/hs-units-save';
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
  const data = useMemo(() => {
    void tick;
    const clients = localDb.clients.getAll();
    return { units: sortUnits(loadUnits()), clients, byId: new Map(clients.map((c) => [c.id ?? '', c])), heads: readSocietySettings().heads ?? [] };
  }, [tick]);
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
        {pick('wing', wingsOf(data.units), (w) => w)}
        {pick('occupancy', OCCUPANCIES, (o) => hsList('occs', OCCUPANCIES, o))}
      </div>
      {unitWarnings(data.units).map((w) => <p key={w} className={controls.hint} style={{ color: 'var(--warning)' }}>{w}</p>)}
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
