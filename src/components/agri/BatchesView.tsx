/**
 * AG-A1 Farm → Batches: flocks, ponds, herds and crops on their own cost centre (bills and sales tagged to it give the
 * batch P&L), events and the memo figures (mortality %, feed, FCR, cost per kg). No posting from events (AG31).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { todayInput } from '../../lib/utils';
import { addBatchEvent, batchMemo, loadBatches, saveBatch } from '../../lib/agri/ag-batches';
import { agriIncomeLedger } from '../../lib/agri/ag-cycle-post';
import type { FarmBatch, FarmBatchEvent } from '../../types/agri-r12';
import controls from '../../styles/controls.module.css';
import { F, Grid, In } from './agri-ui';
import { useRun, wrap, type Done } from './agri-util';

const KINDS: FarmBatch['kind'][] = ['flock', 'pond', 'herd', 'crop'];
const EVENTS: FarmBatchEvent['kind'][] = ['mortality', 'feed', 'weight', 'harvest', 'medicine'];

export default function BatchesView({ onDone }: { onDone: Done }) {
  useT();
  const { tick, run } = useRun(onDone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batches = useMemo(() => loadBatches(), [tick]);
  const [kind, setKind] = useState<FarmBatch['kind']>('flock');
  const [name, setName] = useState('');
  const [start, setStart] = useState(todayInput());
  const [placed, setPlaced] = useState('');
  const [unit, setUnit] = useState('birds');
  const [sw, setSw] = useState('');
  const [ev, setEv] = useState<{ id: string; kind: FarmBatchEvent['kind']; qty: string; date: string }>({ id: '', kind: 'feed', qty: '', date: todayInput() });
  return (
    <div data-ag-batches>
      <div style={wrap}>
        <F label={agT('kind')}><select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as FarmBatch['kind'])}>{KINDS.map((k) => <option key={k} value={k}>{agT(`b.${k}`)}</option>)}</select></F>
        <F label={agT('name')}><In v={name} set={setName} data-ag-b-name /></F>
        <F label={agT('start')}><In v={start} set={setStart} type="date" /></F>
        <F label={agT('placed')}><In v={placed} set={setPlaced} type="number" w={90} data-ag-b-placed /></F>
        <F label={agT('unit')}><In v={unit} set={setUnit} w={80} /></F>
        <F label={agT('startKg')}><In v={sw} set={setSw} type="number" w={90} /></F>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { saveBatch({ kind, name, start, placed: Number(placed), unit, ...(Number(sw) > 0 ? { start_weight_kg: Number(sw) } : {}) }); setName(''); return agT('saved'); })} data-ag-b-save>{agT('addBatch')}</button>
      </div>
      <div style={wrap}>
        <F label={agT('batch')}><select className={controls.select} value={ev.id} onChange={(e) => setEv({ ...ev, id: e.target.value })}><option value="">-</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></F>
        <F label={agT('event')}><select className={controls.select} value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value as FarmBatchEvent['kind'] })}>{EVENTS.map((k) => <option key={k} value={k}>{agT(`e.${k}`)}</option>)}</select></F>
        <F label={agT('date')}><In v={ev.date} set={(v) => setEv({ ...ev, date: v })} type="date" /></F>
        <F label={agT('qtyKg')}><In v={ev.qty} set={(v) => setEv({ ...ev, qty: v })} type="number" w={90} /></F>
        <button type="button" className={controls.btnOutline} disabled={!ev.id} onClick={() => run(() => { addBatchEvent(ev.id, { date: ev.date, kind: ev.kind, qty: Number(ev.qty), unit: ev.kind === 'mortality' ? 'NOS' : 'KG' }); setEv({ ...ev, qty: '' }); return agT('saved'); })}>{agT('addEvent')}</button>
      </div>
      <Grid attr="batches" head={[agT('name'), agT('start'), agT('placed'), agT('mortality'), agT('feedKg'), 'FCR', agT('status')]} rows={batches.map((b) => {
        const m = batchMemo(b);
        return [`${b.name} (${agT(`b.${b.kind}`)})`, b.start, `${b.placed} ${b.unit}`, `${m.dead} (${m.mortalityPct}%)`, m.feedKg, m.fcr ?? '-', b.status === 'active' ? agT('active') : agT('closed')];
      })} />
      <button type="button" className={controls.btnGhost} onClick={() => run(() => { agriIncomeLedger(); return agT('agIncomeOk'); })}>{agT('agIncome')}</button>
    </div>
  );
}
