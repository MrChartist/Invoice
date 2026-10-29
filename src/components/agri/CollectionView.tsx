/**
 * AG-B2 shift collection sheet: one row per centre per date per shift. Entry line (CollectionEntry), the shift's cans,
 * summary (morning vs evening), close / reopen, a 58 / 80 mm slip per can and an optional WhatsApp message; the
 * analyser profile (device-local) is set here too.
 */
import { useMemo, useState } from 'react';
import { Lock, Printer, RotateCcw, Trash2 } from 'lucide-react';
import type { MilkEntry, MilkShift, MilkShiftId } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { closeShift, loadShifts, removeEntry, reopenShift, shiftsOn, shiftTotals } from '../../lib/agri/ag-shifts';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { esc, printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import CollectionEntry from './CollectionEntry';
import AnalyserSetup from './AnalyserSetup';
import { farmers, milkCentres, sm, useRun, wrap, type Done } from './dairy-kit';
import { CentrePick, F, Sel } from './dairy-ui';
import { PRINT_FONT, PRINT_FONT_FACE } from '../../lib/print-fonts';

const SHIFT_OPTS = [['M', 'M'], ['E', 'E']] as const;

const slipHtml = (e: MilkEntry, s: Pick<MilkShift, 'date' | 'shift'>, mm: number) => `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_FONT_FACE}@page{size:${mm}mm auto;margin:2mm}body{font:12px ${PRINT_FONT};width:${mm - 4}mm}</style></head><body>
<b>${esc(localDb.settings.activeProfile()?.companyName ?? '')}</b><br>${esc(s.date)} ${s.shift}<br>${esc(e.code ?? '')} ${esc(e.name ?? '')}<br>${e.qty} ${e.unit} · Fat ${e.fat} · SNF ${e.snf}<br>${e.rejected ? `Rejected: ${esc(e.reason ?? '')}` : `Rate ${e.rate} · ₹${e.amount.toFixed(2)}`}</body></html>`;
const waText = (e: MilkEntry, s: Pick<MilkShift, 'date' | 'shift'>, hi: boolean) => hi
  ? `${e.code ?? ''} ${e.name ?? ''}: ${s.date} ${s.shift === 'M' ? 'सुबह' : 'शाम'} · दूध ${e.qty} ${e.unit} · फैट ${e.fat} · एसएनएफ ${e.snf} · ₹${e.amount.toFixed(2)}`
  : `${e.code ?? ''} ${e.name ?? ''}: ${s.date} ${s.shift} · ${e.qty} ${e.unit} · Fat ${e.fat} · SNF ${e.snf} · ₹${e.amount.toFixed(2)}`;

export default function CollectionView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [centre, setCentre] = useState(() => milkCentres()[0].id);
  const [date, setDate] = useState(todayInput());
  const [shift, setShift] = useState<MilkShiftId>(() => (new Date().getHours() < 13 ? 'M' : 'E'));
  const [mm, setMm] = useState(58);
  const centreId = centre;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const day = useMemo(() => shiftsOn(loadShifts(), date, centreId), [tick, date, centreId]);
  const s = day.find((x) => x.shift === shift);
  const ms = readAgriSettings().milk;
  const print = (e: MilkEntry) => printHtmlDocument(slipHtml(e, { date, shift }, mm), () => onDone(bT('popupBlocked'), true));
  const wa = (e: MilkEntry) => {
    const f = farmers().find((v) => v.id === e.farmer_id);
    const phone = (f?.ag?.phone || f?.phone || '').replace(/\D/g, '');
    return `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(waText(e, { date, shift }, f?.ag?.language === 'hi'))}`;
  };
  return (
    <>
      <div className={controls.row} style={wrap}>
        <CentrePick v={centreId} set={setCentre} />
        <F l={bT('date')} w={160}><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} data-dairy="date" /></F>
        <Sel l={bT('shift')} v={shift} set={setShift} opts={SHIFT_OPTS} w={70} d="shift" />
        <Sel l={bT('slip')} v={String(mm)} set={(v) => setMm(Number(v))} opts={[['58', '58 mm'], ['80', '80 mm']]} w={90} />
      </div>
      {centreId && !s?.closed_at && <CollectionEntry k={{ centre_id: centreId, date, shift }} onAdded={() => run(() => undefined)} onDone={onDone} />}
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="sheet">
          <thead><tr><th>{bT('farmer')}</th><th className={surface.numeric}>{bT('qty')}</th><th className={surface.numeric}>{bT('fat')}</th><th className={surface.numeric}>{bT('snf')}</th><th className={surface.numeric}>{bT('rate')}</th><th className={surface.numeric}>{bT('amount')}</th><th /></tr></thead>
          <tbody>{(s?.entries ?? []).map((e) => (
            <tr key={e.id}>
              <td>{e.code} {e.name}{e.rejected ? ` · ${bT('rejected')}: ${e.reason ?? ''}` : ''}</td><td className={surface.numeric}>{e.qty} {e.unit}</td><td className={surface.numeric}>{e.fat}</td><td className={surface.numeric}>{e.snf}</td>
              <td className={surface.numeric}>{e.rate}</td><td className={surface.numeric}>{formatCurrency(e.amount)}</td>
              <td>
                <button type="button" className={sm} aria-label={bT('printSlip')} onClick={() => print(e)}><Printer size={14} aria-hidden="true" /></button>
                {ms?.slip_wa && <a className={sm} href={wa(e)} target="_blank" rel="noreferrer">WhatsApp</a>}
                {!s?.closed_at && <button type="button" className={sm} aria-label={bT('delete')} onClick={() => run(() => { removeEntry(s!.id, e.id); })}><Trash2 size={14} aria-hidden="true" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {day.map((x) => {
        const t = shiftTotals(x, ms);
        return <p key={x.id} className={surface.sectionNote} data-dairy={`total-${x.shift}`}>{bT(`shift.${x.shift}`)}: {bT('totals', { farmers: t.farmers, litres: t.litres, fat: t.kgFat, snf: t.kgSnf, afat: t.avgFat, asnf: t.avgSnf, amount: formatCurrency(t.amount), rej: t.rejected })}{x.closed_at ? ` · ${bT('closed')}` : ''}</p>;
      })}
      {s && (s.closed_at
        ? <button type="button" className={sm} onClick={() => run(() => { reopenShift(s.id); return bT('reopened'); })}><RotateCcw size={14} aria-hidden="true" /> {bT('reopen')}</button>
        : <button type="button" className={controls.btnPrimary} data-dairy="close-shift" onClick={() => run(() => { closeShift(s.id); return bT('shiftClosed'); })}><Lock size={14} aria-hidden="true" /> {bT('closeShift')}</button>)}
      <AnalyserSetup onSaved={() => onDone(bT('saved'))} />
    </>
  );
}
