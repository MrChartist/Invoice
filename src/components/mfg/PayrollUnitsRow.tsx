/**
 * MF-A3 payroll attendance row (lazy; with the `shopfloor` pack): "Import production units from job cards" — the good
 * units each employee operator reported in the month go into the chosen production type's column (unsaved until the
 * user saves the attendance). Karigars are vendors and stay out of payroll (C4).
 */
import { useState } from 'react';
import { loadCards, unitsByEmployee } from '../../lib/mfg/mf-jobcards';
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';
import controls from '../../styles/controls.module.css';

const uT = defineArea(
  { import: 'Import production units from job cards', into: 'Into column', done: '{n} employee(s) filled from job cards: check and save.' } as const,
  { import: 'जॉब कार्ड से उत्पादन इकाइयाँ लाएँ', into: 'किस कॉलम में', done: '{n} कर्मचारियों की इकाइयाँ जॉब कार्ड से भरीं: जाँचें और सहेजें।' },
);

export default function PayrollUnitsRow({ month, cols, onUnits }: { month: string; cols: { id: string; label: string }[]; onUnits: (col: string, units: Record<string, number>, note: string) => void }) {
  useT();
  const [col, setCol] = useState(cols[0]?.id ?? '');
  if (!cols.length) return null;
  const run = () => {
    const units = unitsByEmployee(loadCards(), month);
    onUnits(col, units, uT('done', { n: Object.keys(units).length }));
  };
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', padding: '0 1rem' }} data-mf-payroll-units>
      <label className={controls.field}>
        <span className={controls.label}>{uT('into')}</span>
        <select className={controls.select} value={col} onChange={(e) => setCol(e.target.value)}>{cols.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      </label>
      <button type="button" className={controls.btnOutline} onClick={run}>{uT('import')}</button>
    </div>
  );
}
