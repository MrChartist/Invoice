/**
 * AG-B2 one can at the counter, keyboard-first: code → quantity → fat → SNF → Enter. The can weight comes from the Web
 * Serial scale and fat / SNF / CLR / water from the analyser (both optional: typing always works). Big numerals.
 */
import { useRef, useState } from 'react';
import { Scale } from 'lucide-react';
import type { MilkKind, MilkShiftId, MilkUnit } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { addEntry, type EntryInput } from '../../lib/agri/ag-shifts';
import { readAnalyser } from '../../lib/agri/ag-analyser';
import controls from '../../styles/controls.module.css';
import { farmers, findFarmer, milkOpts, sm, wrap, type Done } from './dairy-kit';
import { F, N, Sel } from './dairy-ui';

const big = { fontSize: '1.4rem', fontWeight: 600 } as const;
const blank = { code: '', milk: 'cow' as MilkKind, qty: 0, unit: 'L' as MilkUnit, fat: 0, snf: 0, clr: 0, water: 0, reject: '' };

export default function CollectionEntry({ k, onAdded, onDone }: { k: { centre_id: string; date: string; shift: MilkShiftId }; onAdded: (e: EntryInput & { amount: number }) => void; onDone: Done }) {
  const [e, setE] = useState(blank);
  const [dup, setDup] = useState(false);
  const code = useRef<HTMLInputElement>(null);
  const set = (p: Partial<typeof e>) => {
    setE({ ...e, ...p });
    setDup(false);
  };
  const f = findFarmer(farmers(), e.code);
  const device = async (kind: 'scale' | 'analyser') => {
    try {
      if (kind === 'scale') {
        const w = await (await import('../../lib/scale-serial')).readScaleWeight();
        if (w) set({ qty: w.weight, unit: 'KG' });
      } else {
        const r = await readAnalyser();
        if (r) set({ fat: r.fat, snf: r.snf, clr: r.clr ?? 0, water: r.water_pct ?? 0 });
      }
    } catch (er) {
      onDone((er as Error).message, true);
    }
  };
  const submit = () => {
    if (!f) return onDone(bT('noFarmer'), true);
    const input: EntryInput = { farmer_id: f.id, name: f.name, code: f.ag?.code, milk: e.milk, qty: e.qty, unit: e.unit, fat: e.fat, snf: e.snf, clr: e.clr, water_pct: e.water, reject: e.reject };
    try {
      const { entry } = addEntry(k, input, { allowDuplicate: dup });
      onAdded({ ...input, amount: entry.amount });
      setE({ ...blank, milk: e.milk, unit: e.unit });
      setDup(false);
      code.current?.focus();
    } catch (er) {
      const m = (er as Error).message;
      if (/already has milk/.test(m)) setDup(true);
      onDone(dup ? m : /already has milk/.test(m) ? bT('dupWarn') : m, true);
    }
  };
  return (
    <form className={controls.row} style={wrap} onSubmit={(ev) => { ev.preventDefault(); submit(); }} data-dairy="entry">
      <F l={bT('farmerCode')} w={150}><input ref={code} autoFocus className={controls.input} style={big} value={e.code} onChange={(x) => set({ code: x.target.value })} data-dairy="code" /></F>
      <span className={controls.hint} data-dairy="farmer">{f ? `${f.ag?.code} · ${f.name}` : e.code ? bT('noFarmer') : ''}</span>
      <Sel l={bT('milk')} v={e.milk} set={(milk) => set({ milk })} opts={milkOpts()} w={110} />
      <N l={bT('qty')} v={e.qty} set={(qty) => set({ qty })} d="qty" />
      <Sel l={bT('unit')} v={e.unit} set={(unit) => set({ unit })} opts={[['L', 'L'], ['KG', 'kg']]} w={70} />
      <button type="button" className={sm} onClick={() => void device('scale')}><Scale size={14} aria-hidden="true" /> {bT('scale')}</button>
      <N l={bT('fat')} v={e.fat} set={(fat) => set({ fat })} w={80} d="fat" />
      <N l={bT('snf')} v={e.snf} set={(snf) => set({ snf })} w={80} d="snf" />
      <N l="CLR" v={e.clr} set={(clr) => set({ clr })} w={70} />
      <button type="button" className={sm} onClick={() => void device('analyser')}>{bT('analyser')}</button>
      <F l={bT('rejectReason')} w={150}><input className={controls.input} value={e.reject} onChange={(x) => set({ reject: x.target.value })} data-dairy="reject" /></F>
      <button type="submit" className={controls.btnPrimary} data-dairy="add">{dup ? bT('addAgain') : bT('add')}</button>
    </form>
  );
}
