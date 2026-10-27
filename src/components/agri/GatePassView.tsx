/** AG-D1 gate passes out: the release checks (balance, lien, rent due), the pass with the rent bill at release, the list. */
import { useMemo, useState } from 'react';
import { Printer, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { agdT } from '../../i18n/areas/agri-r12d';
import { can } from '../../lib/access';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadLots, lotBalance } from '../../lib/agri/ag-cold-lots';
import { checkGatePass, gatePassHtml, issueGatePass, undoGatePass } from '../../lib/agri/ag-gatepass';
import { loadLoans } from '../../lib/agri/ag-loans';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, company, printPaper, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function GatePassView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const [p, setP] = useState({ lot: '', date: todayInput(), bags: 0, vehicle: '', to: '', by: '', reason: '' });
  const [billId, setBillId] = useState('');
  const lot = lots.find((l) => l.id === p.lot);
  const chambers = readAgriSettings().chambers ?? [];
  const check = lot && p.bags > 0 ? checkGatePass(lot, p.bags, p.date, { loans: loadLoans(), lots, invoices: localDb.invoices.getAll(), releaseLtv: readAgriSettings().release_ltv_pct }) : undefined;
  const owner = can('settings.manage');
  const passes = lots.flatMap((l) => l.outs.map((o) => ({ l, o }))).sort((a, b) => b.o.number.localeCompare(a.o.number));
  const issue = () => run(() => {
    const r = issueGatePass(p.lot, { date: p.date, bags: p.bags, vehicle: p.vehicle, to: p.to, by: p.by, ...(check?.liens.length && p.reason.trim() ? { override_reason: p.reason } : {}) }, chambers.find((c) => c.id === lot?.chamber_id)?.name);
    setBillId(r.bill?.id ?? '');
    setP({ ...p, bags: 0, reason: '' });
    return [agdT('passSaved', { n: r.out.number, bal: lotBalance(r.lot) }), r.bill ? agdT('billRaised', { n: r.bill.invoice_number, total: r.bill.total }) : '', ...r.warnings].filter(Boolean).join(' ');
  });
  return (
    <>
      <div style={wrap}>
        <F label={agdT('lot')}><Sel value={p.lot} onChange={(v) => setP({ ...p, lot: v })} opts={lots.filter((l) => lotBalance(l) > 0).map((l) => [l.id, `${l.number} · ${l.depositor_name} (${lotBalance(l)})`])} blank="—" data-agd="pass-lot" /></F>
        <F label={agdT('date')}><input type="date" className={controls.input} value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></F>
        <F label={agdT('bags')} w={100}><NumberInput className={controls.input} value={p.bags} onChange={(v) => setP({ ...p, bags: v })} data-agd="pass-bags" /></F>
        <F label={agdT('vehicle')} w={140}><input className={controls.input} value={p.vehicle} onChange={(e) => setP({ ...p, vehicle: e.target.value })} /></F>
        <F label={agdT('toWhom')} w={160}><input className={controls.input} value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></F>
        <F label={agdT('takenBy')} w={140}><input className={controls.input} value={p.by} onChange={(e) => setP({ ...p, by: e.target.value })} /></F>
        {owner && !!check?.liens.length && <F label={agdT('override')}><input className={controls.input} value={p.reason} onChange={(e) => setP({ ...p, reason: e.target.value })} data-agd="override" /></F>}
        <button type="button" className={controls.btnPrimary} disabled={!lot} onClick={issue} data-agd-issue-pass>{agdT('issuePass')}</button>
      </div>
      {check && [...check.errors, ...check.warnings].map((m) => <p key={m} className={controls.hint} role="alert" data-agd-pass-check>{m}</p>)}
      {billId && <p><Link to={`/invoice/${billId}`} data-agd-open-bill>{agdT('openBill')}</Link></p>}
      <Tbl
        head={[agdT('pass'), agdT('date'), agdT('lot'), agdT('depositor'), agdT('bags'), agdT('loanCheck'), '']}
        rows={passes.map(({ l, o }) => [o.number, o.date, l.number, l.depositor_name, o.bags, o.loan_check === 'override' ? `${agdT('overridden')}: ${o.override_reason}` : agdT('clear'),
          <span key="a" style={{ display: 'flex', gap: 4 }}>
            <button type="button" className={btn} aria-label={agdT('print')} onClick={() => printPaper(gatePassHtml(l, o, company()), o.number)}><Printer size={14} aria-hidden="true" /></button>
            {l.outs[l.outs.length - 1]?.id === o.id && <button type="button" className={btn} aria-label={agdT('undo')} onClick={() => run(() => { undoGatePass(l.id); return agdT('deleted'); })}><Undo2 size={14} aria-hidden="true" /></button>}
          </span>])}
      />
    </>
  );
}
