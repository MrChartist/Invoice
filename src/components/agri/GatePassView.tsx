/** AG-D1 gate passes out: the release checks (balance, lien, rent due), the pass with the rent bill at release, the list. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { agdT } from '../../i18n/areas/agri-r12d';
import { can } from '../../lib/access';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadLots, lotBalance } from '../../lib/agri/ag-cold-lots';
import { checkGatePass, gatePassHtml, issueGatePass, undoGatePass } from '../../lib/agri/ag-gatepass';
import { loadLoans } from '../../lib/agri/ag-loans';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Tbl } from './agd-kit';
import { company, printPaper, useRun, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function GatePassView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const [p, setP] = useState<Record<string, string | number>>({ date: todayInput(), bags: 0 });
  const [bill, setBill] = useState('');
  const lot = lots.find((l) => l.id === p.lot);
  const s = readAgriSettings();
  const check = lot && Number(p.bags) > 0 ? checkGatePass(lot, Number(p.bags), String(p.date), { loans: loadLoans(), lots, invoices: localDb.invoices.getAll(), releaseLtv: s.cold?.release_ltv_pct }) : undefined;
  const passes = lots.flatMap((l) => l.outs.map((o) => ({ l, o }))).reverse();
  const issue = () => run(() => {
    const r = issueGatePass(String(p.lot), { ...p, bags: Number(p.bags), date: String(p.date), override_reason: String(p.reason ?? '') } as never, s.chambers?.find((c) => c.id === lot?.chamber_id)?.name);
    setBill(r.bill?.id ?? '');
    setP({ ...p, bags: 0, reason: '' });
    return [agdT('passSaved', { n: r.out.number, bal: lotBalance(r.lot) }), r.bill ? agdT('billRaised', { n: r.bill.invoice_number, total: r.bill.total }) : '', ...r.warnings].join(' ');
  });
  return (
    <>
      <Form v={p} set={setP} f={[['lot', 'lot', lots.filter((l) => lotBalance(l) > 0).map((l) => [l.id, `${l.number} · ${l.depositor_name} (${lotBalance(l)})`] as const)], ['date', 'date', 'd'], ['bags', 'bags', 'n', 100], ['vehicle', 'vehicle', 't', 140], ['to', 'toWhom', 't', 160], ['by', 'takenBy', 't', 140], can('settings.manage') && !!check?.liens.length && ['reason', 'override']]}>
        <B p k="issuePass" off={!lot} on={issue} data-agd-b="issue-pass" />
      </Form>
      {check && [...check.errors, ...check.warnings].map((m) => <p key={m} className={controls.hint} role="alert" data-agd-pass-check>{m}</p>)}
      {bill && <p><Link to={`/invoice/${bill}`}>{agdT('openBill')}</Link></p>}
      <Tbl
        head={['pass', 'date', 'lot', 'depositor', 'bags', 'loanCheck', '']}
        rows={passes.map(({ l, o }) => [o.number, o.date, l.number, l.depositor_name, o.bags, o.loan_check === 'override' ? `${agdT('overridden')}: ${o.override_reason}` : agdT('clear'), <span key="a">
          <B k="print" on={() => printPaper(gatePassHtml(l, o, company()), o.number)} />
          {l.outs[l.outs.length - 1]?.id === o.id && <B k="undo" on={() => run(() => { undoGatePass(l.id); return agdT('deleted'); })} />}
        </span>])}
      />
    </>
  );
}
