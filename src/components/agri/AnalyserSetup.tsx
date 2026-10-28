/** AG-B2 milk analyser profile (this device only, `mrchartist_milk_analyser`): on Dairy → Collection and in the POS device settings. */
import { useState } from 'react';
import { bT } from '../../i18n/areas/agri-r12b';
import { cleanAnalyser, loadAnalyser, saveAnalyser, type AnalyserField } from '../../lib/agri/ag-analyser';
import controls from '../../styles/controls.module.css';
import { sm, wrap } from './dairy-kit';
import { F, Sel } from './dairy-ui';

export default function AnalyserSetup({ onSaved }: { onSaved?: () => void }) {
  const [p, setP] = useState(loadAnalyser);
  return (
    <details>
      <summary>{bT('analyserSetup')}</summary>
      <div className={controls.row} style={wrap}>
        <Sel l={bT('preset')} v={p.preset} set={(preset) => setP({ ...p, preset })} opts={[['csv', bT('presetCsv')], ['kv', 'key=value']]} />
        <F l={bT('order')} w={200}><input className={controls.input} value={p.order.join(',')} onChange={(e) => setP(cleanAnalyser({ ...p, order: e.target.value.split(',').map((x) => x.trim() as AnalyserField) }))} /></F>
        <F l={bT('sep')} w={70}><input className={controls.input} value={p.sep} maxLength={1} onChange={(e) => setP({ ...p, sep: e.target.value || ',' })} /></F>
        <Sel l={bT('divide')} v={String(p.div)} set={(v) => setP({ ...p, div: Number(v) })} opts={[['1', '1'], ['10', '10'], ['100', '100']]} w={80} />
        <Sel l={bT('baud')} v={String(p.baud)} set={(v) => setP({ ...p, baud: Number(v) })} opts={['2400', '4800', '9600', '19200'].map((b) => [b, b] as const)} w={100} />
        <button type="button" className={sm} onClick={() => { saveAnalyser(p); onSaved?.(); }}>{bT('save')}</button>
      </div>
    </details>
  );
}
