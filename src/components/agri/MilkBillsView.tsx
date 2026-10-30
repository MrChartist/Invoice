/**
 * AG-B3 milk bills: "Make bills" for a centre's cycle period (from its closed shifts), close (one pooled exempt purchase;
 * milk stock already came in per shift), print every farmer's bill (A5, from the cycle row) and the cycle summary by
 * farmer / village / route with the farmers who supplied nothing. Paying, the bank file and slips are on Farm → Cycles.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import type { FarmerCycle } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { closeMilkCycle, cycleSummary, makeMilkCycle, milkBillHtml } from '../../lib/agri/ag-milk-cycle';
import { loadCycles } from '../../lib/agri/ag-cycle-post';
import { cyclePeriod, cycleTotals } from '../../lib/agri/ag-cycles';
import { cyclesOf, readAgriSettings } from '../../lib/agri/ag-settings';
import { printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { farmers, milkCentres, sm, useRun, wrap, type Done } from './dairy-kit';
import { CentrePick, F, Sel } from './dairy-ui';
import { DateField } from '../ui/DateField';

export default function MilkBillsView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [centre, setCentre] = useState(() => milkCentres()[0].id);
  const [day, setDay] = useState(todayInput());
  const [by, setBy] = useState<'farmer' | 'village' | 'route'>('farmer');
  const [open, setOpen] = useState('');
  const centreId = centre;
  const per = cyclePeriod(day, cyclesOf(readAgriSettings(), centreId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycles = useMemo(() => loadCycles().filter((c) => c.source === 'milk' && (c.centre_id ?? '') === centreId).sort((a, b) => b.period_to.localeCompare(a.period_to)), [tick, centreId]);
  const name = milkCentres().find((c) => c.id === centreId)?.name;
  const print = (c: FarmerCycle) => printHtmlDocument(milkBillHtml(c, localDb.settings.activeProfile()?.companyName ?? ''), () => onDone(bT('popupBlocked'), true));
  const shown = cycles.find((c) => c.id === open);
  const sum = shown ? cycleSummary(shown, farmers(), by) : undefined;
  return (
    <>
      <div className={controls.row} style={wrap}>
        <CentrePick v={centreId} set={setCentre} />
        <F l={bT('dayInCycle')} w={160}><DateField className={controls.input} value={day} onChange={(e) => setDay(e.target.value)} data-dairy="cycle-day" /></F>
        <span className={controls.hint}>{per.from} → {per.to}</span>
        <button type="button" className={controls.btnPrimary} data-dairy="make-bills" onClick={() => run(() => bT('billsMade', { no: makeMilkCycle(centreId, per.from, per.to, cycles.find((c) => c.period_from === per.from && c.status === 'draft')?.id).number }))}>{bT('makeBills')}</button>
        <Link className={sm} to="/inventory?tab=farm&view=cycles">{bT('payCycles')}</Link>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="cycles">
          <thead><tr><th>{bT('number')}</th><th>{bT('period')}</th><th>{bT('status')}</th><th className={surface.numeric}>{bT('farmers')}</th><th className={surface.numeric}>{bT('amount')}</th><th className={surface.numeric}>{bT('net')}</th><th /></tr></thead>
          <tbody>{cycles.map((c) => {
            const t = cycleTotals(c);
            return (
              <tr key={c.id}>
                <td>{c.number}</td><td>{c.period_from} → {c.period_to}</td><td>{bT(`st.${c.status}`)}</td><td className={surface.numeric}>{c.lines.length}</td>
                <td className={surface.numeric}>{formatCurrency(t.gross)}</td><td className={surface.numeric}>{formatCurrency(t.net)}</td>
                <td>
                  {c.status === 'draft' && <button type="button" className={sm} data-dairy="close-cycle" onClick={() => run(() => bT('cycleClosed', { no: closeMilkCycle(c.id, name).number }))}>{bT('closeCycle')}</button>}
                  <button type="button" className={sm} onClick={() => print(c)}><Printer size={14} aria-hidden="true" /> {bT('printBills')}</button>
                  <button type="button" className={sm} onClick={() => setOpen(open === c.id ? '' : c.id)}>{bT('summary')}</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {sum && (
        <>
          <Sel l={bT('groupBy')} v={by} set={setBy} opts={(['farmer', 'village', 'route'] as const).map((k) => [k, bT(`by.${k}`)] as const)} />
          <table className={surface.table} data-dairy="summary">
            <thead><tr><th /><th className={surface.numeric}>{bT('litres')}</th><th className={surface.numeric}>{bT('kgFat')}</th><th className={surface.numeric}>{bT('avgFat')}</th><th className={surface.numeric}>{bT('amount')}</th></tr></thead>
            <tbody>{sum.rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className={surface.numeric}>{r.litres}</td><td className={surface.numeric}>{r.kgFat}</td><td className={surface.numeric}>{r.avgFat}</td><td className={surface.numeric}>{formatCurrency(r.amount)}</td></tr>)}</tbody>
          </table>
          {sum.noSupply.length > 0 && <p className={surface.sectionNote}>{bT('noSupply')}: {sum.noSupply.map((v) => v.name).join(', ')}</p>}
        </>
      )}
    </>
  );
}
