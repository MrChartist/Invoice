/**
 * AG-A4 Farm → Cycles: pooled farmer cycle bills (`CYB/FY…`). Draft the period's farmer lines (deductions from unpaid
 * feed / input invoices, advances, share money …), close (one purchase, set-off receipts, one journal), the NEFT file,
 * pay (one payment per mode), slips (print / WhatsApp, one tap each), reopen a closed unpaid cycle, the bonus run.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import { buildUploadFile, cycleUploadRows, UPLOAD_PRESETS, type UploadPreset } from '../../lib/bank-upload';
import { loadFarmers } from '../../lib/agri/ag-farmers';
import { cyclesOf, readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { bonusRun, carriedIn, cyclePeriod, cycleTotals, inputDeductions, settleLines } from '../../lib/agri/ag-cycles';
import { closeCycle, deleteCycle, loadCycles, payCycle, reopenCycle, saveCycleDraft } from '../../lib/agri/ag-cycle-post';
import { slipHtml } from '../../lib/agri/ag-print';
import { slipText, slipWaLink } from '../../lib/agri/ag-slips';
import type { AgCycleSettings, AgDeduction, FarmerCycle, FarmerCycleLine } from '../../types/agri-r12';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, money, useRun, wrap, type Done } from './agri-ui';

const KINDS: AgDeduction['kind'][] = ['advance', 'loan', 'share', 'insurance', 'union', 'other'];

export default function CyclesView({ onDone }: { onDone: Done }) {
  useT();
  const { tick, run } = useRun(onDone);
  /* eslint-disable react-hooks/exhaustive-deps */
  const farmers = useMemo(() => loadFarmers(), [tick]);
  const cycles = useMemo(() => loadCycles().sort((a, b) => b.period_to.localeCompare(a.period_to)), [tick]);
  const s = useMemo(() => readAgriSettings(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [centre, setCentre] = useState('');
  const [day, setDay] = useState(todayInput());
  const cs = cyclesOf(s, centre);
  const per = cyclePeriod(day, cs);
  const [lines, setLines] = useState<FarmerCycleLine[]>([]);
  const [add, setAdd] = useState({ fid: '', qty: '', amount: '', unit: 'KG' });
  const [ded, setDed] = useState({ fid: '', kind: 'advance' as AgDeduction['kind'], amount: '' });
  const [preset, setPreset] = useState<UploadPreset>('generic');
  const [debit, setDebit] = useState('');
  const [bonus, setBonus] = useState('');
  const business = localDb.settings.activeProfile()?.companyName ?? '';
  const centreName = s.centres?.find((c) => c.id === centre)?.name;
  const farmer = (id: string) => farmers.find((f) => f.id === id);

  const addLine = () => {
    const f = farmer(add.fid);
    if (!f) return;
    const carried = carriedIn(cycles, centre || undefined, per.from).get(f.id);
    const amount = Number(add.amount) || 0;
    const auto = inputDeductions(f.ag.code, getTable('clients'), getTable('invoices'), getTable('transactions'), amount + (carried ?? 0));
    setLines(settleLines([...lines.filter((l) => l.farmer_id !== f.id), { farmer_id: f.id, name: f.name, qty: Number(add.qty) || 0, unit: add.unit, amount, ...(carried ? { carried } : {}), deductions: auto, net: 0, mode: f.ag.bank?.account ? 'bank' : 'cash' }]));
    setAdd({ ...add, fid: '', qty: '', amount: '' });
  };
  const addDed = () => setLines(settleLines(lines.map((l) => (l.farmer_id === ded.fid ? { ...l, deductions: [...l.deductions, { kind: ded.kind, amount: Number(ded.amount) || 0 }] } : l))));
  const bankFile = (c: FarmerCycle) => {
    const rows = cycleUploadRows(c.lines.map((l) => ({ ...l, bank: farmer(l.farmer_id)?.ag.bank })), c.number);
    const f = buildUploadFile({ preset, date: todayInput(), debitAccountNo: debit, rows });
    downloadText(f.filename, f.text, 'text/csv');
    return agT('bankFileOk', { n: f.count, total: money(f.total) });
  };
  const slip = (c: FarmerCycle, l: FarmerCycleLine) => printHtmlDocument(slipHtml(c, l, business, farmer(l.farmer_id)?.ag.code), (h) => downloadText(`${c.number.replace(/\W+/g, '-')}-${l.name ?? ''}.html`, h, 'text/html'));
  const t = cycleTotals({ lines });
  return (
    <div data-ag-cycles>
      <div style={wrap}>
        <F label={agT('cycleLength')}><select className={controls.select} value={cs.length} onChange={(e) => run(() => { saveAgriSettings({ cycles: { ...cs, length: e.target.value as AgCycleSettings['length'] } }); })}>{(['weekly', '10day', 'fortnight', 'monthly'] as const).map((k) => <option key={k} value={k}>{agT(`len.${k}`)}</option>)}</select></F>
        <F label={agT('centre')}><select className={controls.select} value={centre} onChange={(e) => setCentre(e.target.value)}><option value="">—</option>{s.centres?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <F label={agT('dayInCycle')}><In v={day} set={setDay} type="date" /></F>
        <span>{agT('period', { from: per.from, to: per.to })}</span>
      </div>
      <div style={wrap}>
        <F label={agT('farmer')}><select className={controls.select} value={add.fid} onChange={(e) => setAdd({ ...add, fid: e.target.value })} data-ag-c-farmer><option value="">—</option>{farmers.map((f) => <option key={f.id} value={f.id}>{f.ag.code} · {f.name}</option>)}</select></F>
        <F label={agT('qty')}><In v={add.qty} set={(v) => setAdd({ ...add, qty: v })} type="number" w={80} /></F>
        <F label={agT('unit')}><In v={add.unit} set={(v) => setAdd({ ...add, unit: v })} w={60} /></F>
        <F label={agT('amount')}><In v={add.amount} set={(v) => setAdd({ ...add, amount: v })} type="number" w={100} data-ag-c-amount /></F>
        <button type="button" className={controls.btnOutline} onClick={addLine} data-ag-c-add>{agT('addLine')}</button>
        <F label={agT('deduction')}><select className={controls.select} value={ded.fid} onChange={(e) => setDed({ ...ded, fid: e.target.value })}><option value="">—</option>{lines.map((l) => <option key={l.farmer_id} value={l.farmer_id}>{l.name}</option>)}</select></F>
        <select className={controls.select} value={ded.kind} onChange={(e) => setDed({ ...ded, kind: e.target.value as AgDeduction['kind'] })}>{KINDS.map((k) => <option key={k} value={k}>{agT(`d.${k}`)}</option>)}</select>
        <In v={ded.amount} set={(v) => setDed({ ...ded, amount: v })} type="number" w={80} />
        <button type="button" className={controls.btnOutline} disabled={!ded.fid} onClick={addDed}>{agT('addDeduction')}</button>
      </div>
      <Grid attr="cycle-lines" head={[agT('farmer'), agT('qty'), agT('amount'), agT('deductions'), agT('net'), agT('mode')]} rows={lines.map((l) => [l.name, `${l.qty} ${l.unit}`, money(l.amount), l.deductions.map((d) => `${agT(`d.${d.kind}`)} ${money(d.amount)}`).join(', '), `${money(l.net)}${l.carry_out ? ` (${agT('carry')} ${money(l.carry_out)})` : ''}`, agT(l.mode === 'bank' ? 'bank' : 'cash')])} />
      {lines.length > 0 && <p>{agT('totals', { gross: money(t.gross), ded: money(t.deductions), net: money(t.net) })}</p>}
      <button type="button" className={controls.btnPrimary} disabled={!lines.length} onClick={() => run(() => { const c = saveCycleDraft({ centre_id: centre || undefined, period_from: per.from, period_to: per.to, source: 'produce', lines }); setLines([]); return agT('draftSaved', { no: c.number }); })} data-ag-c-save>{agT('saveDraft')}</button>
      <div style={wrap}>
        <F label={agT('bankPreset')}><select className={controls.select} value={preset} onChange={(e) => setPreset(e.target.value as UploadPreset)}>{UPLOAD_PRESETS.map((p) => <option key={p}>{p}</option>)}</select></F>
        <F label={agT('debitAccount')}><In v={debit} set={setDebit} /></F>
      </div>
      <Grid attr="cycles" head={[agT('number'), agT('periodCol'), agT('farmers'), agT('net'), agT('status'), '']} rows={cycles.map((c) => [c.number, `${c.period_from} – ${c.period_to}`, c.lines.length, money(cycleTotals(c).net), agT(`st.${c.status}`), (
        <span key="a" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {c.status === 'draft' && <><button type="button" className={controls.btnGhost} onClick={() => run(() => { closeCycle(c.id, s.centres?.find((x) => x.id === c.centre_id)?.name ?? centreName); return agT('closedOk'); })} data-ag-c-close>{agT('close')}</button><button type="button" className={controls.btnGhost} onClick={() => run(() => { deleteCycle(c.id); return agT('deleted'); })}>{agT('delete')}</button></>}
          {c.status === 'closed' && <><button type="button" className={controls.btnGhost} onClick={() => run(() => bankFile(c))}>{agT('bankFile')}</button><button type="button" className={controls.btnGhost} onClick={() => run(() => { payCycle(c.id, todayInput()); return agT('paidOk'); })}>{agT('pay')}</button><button type="button" className={controls.btnGhost} onClick={() => run(() => { reopenCycle(c.id); return agT('reopened'); })}>{agT('reopen')}</button></>}
          {c.status !== 'draft' && c.lines.map((l) => (
            <span key={l.farmer_id}>
              <button type="button" className={controls.btnGhost} onClick={() => slip(c, l)}>{agT('slip')} {l.name}</button>
              <a className={controls.btnGhost} href={slipWaLink(farmer(l.farmer_id)?.ag.phone, slipText(c, l, business, farmer(l.farmer_id)?.ag.language))} target="_blank" rel="noreferrer">WhatsApp</a>
            </span>
          ))}
        </span>
      )])} />
      <div style={wrap}>
        <F label={agT('bonusPerUnit')}><In v={bonus} set={setBonus} type="number" w={90} /></F>
        <button type="button" className={controls.btnOutline} disabled={!(Number(bonus) > 0)} onClick={() => downloadText('bonus-run.csv', ['Farmer,Qty,Amount', ...bonusRun(cycles, Number(bonus)).map((r) => `"${r.name ?? ''}",${r.qty},${r.amount}`)].join('\r\n'), 'text/csv')}>{agT('bonusRun')}</button>
      </div>
    </div>
  );
}
