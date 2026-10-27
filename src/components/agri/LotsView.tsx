/** AG-D1 lots: receive a lot (storage receipt `CSR/FY…`), the list with receipt print, bag transfers, the depositor statement (with print). */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { addLot, deleteLot, loadLots, lotBalance, receiptHtml, transferBags } from '../../lib/agri/ag-cold-lots';
import { depositorStatement, statementHtml } from '../../lib/agri/ag-gatepass';
import { loadLoans } from '../../lib/agri/ag-loans';
import { localDb } from '../../lib/localDb';
import { loadPlans, suggestClass } from '../../lib/agri/ag-cold-rent';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Hint, Tbl } from './agd-kit';
import { clientOpts, company, fmt, printPaper, useRun, type Done } from './agd-ui';

export default function LotsView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const s = readAgriSettings();
  const ch = (s.chambers ?? []).map((c) => [c.id, c.name] as const);
  const plans = useMemo(() => { void tick; return loadPlans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const clients = clientOpts();
  const [f, setF] = useState<Record<string, string | number>>({ date_in: day, depositor_id: '', commodity: '', chamber_id: '', rent_plan_id: '', bags: 0, bag_kg: 50, season: day.slice(0, 4) });
  const name = (id: unknown) => clients.find((c) => c[0] === id)?.[1] ?? '';
  const nm = (o: readonly (readonly [string, string])[], id: string) => o.find((x) => x[0] === id)?.[1] ?? '';
  const cls = suggestClass(String(f.commodity ?? ''));
  const [t, setT] = useState<Record<string, string | number>>({ date: day, tbags: 0 });
  const st = t.who ? depositorStatement(lots, localDb.invoices.getAll(), loadLoans(), String(t.who), day) : undefined;
  return (
    <>
      <Form v={f} set={setF} f={[['date_in', 'dateIn', 'd'], ['depositor_id', 'depositor', clients], ['commodity', 'commodity'], ['variety', 'variety', 't', 140], ['bags', 'bags', 'n', 100], ['bag_kg', 'bagKg', 'n', 90], ['chamber_id', 'chamber', ch], ['location', 'location', 't', 140], ['season', 'season', 't', 100], ['rent_plan_id', 'plan', plans.map((p) => [p.id, p.name] as const)]]}>
        <B p k="receive" on={() => run(() => agdT('lotSaved', { n: addLot({ ...f, depositor_name: name(f.depositor_id) } as never).number }))} data-agd-b="add-lot" />
      </Form>
      {cls && <Hint k={cls === 'storage_agri' ? 'clsAgri' : 'clsOther'} />}
      <Tbl
        head={['receipt', 'dateIn', 'depositor', 'commodity', 'bags', 'balance', 'chamber', '']}
        flag={lots.map((l) => lotBalance(l) <= 0)}
        rows={lots.map((l) => [l.number, l.date_in, l.depositor_name, l.commodity, l.bags, lotBalance(l), nm(ch, l.chamber_id), <span key="a">
          <B k="print" on={() => printPaper(receiptHtml(l, { company: company(), chamber: nm(ch, l.chamber_id), plan: plans.find((p) => p.id === l.rent_plan_id)?.name, terms: s.cold?.receipt_terms }), l.number)} />
          <B k="delete" on={() => run(() => { deleteLot(l.id); return agdT('deleted'); })} />
        </span>])}
      />
      <h3>{agdT('transfer')}</h3>
      <Form v={t} set={setT} f={[['lot', 'lot', lots.filter((l) => lotBalance(l) > 0).map((l) => [l.id, `${l.number} · ${l.depositor_name}`] as const)], ['to', 'toDepositor', clients], ['date', 'date', 'd'], ['tbags', 'bags', 'n', 100], ['note', 'consent']]}>
        <B k="transfer" on={() => run(() => { const c = transferBags(String(t.lot), { date: String(t.date), to_depositor_id: String(t.to ?? ''), to_depositor_name: name(t.to), bags: Number(t.tbags), note: String(t.note ?? '') }); setT({ ...t, tbags: 0, note: '' }); return agdT('lotSaved', { n: c.number }); })} data-agd-b="transfer" />
      </Form>
      <h3>{agdT('statement')}</h3>
      <Form v={t} set={setT} f={[['who', 'depositor', clients]]}>
        {st && <B k="print" on={() => printPaper(statementHtml(st, name(t.who), company(), day), `statement-${name(t.who)}`)} data-agd-b="print-statement" />}
      </Form>
      {st && <p data-agd-statement>{agdT('stLine', { lots: st.lots.length, in: st.in, out: st.out, bal: st.balance })} · {agdT('stRent', { billed: fmt(st.billed), due: fmt(st.due) })} · {agdT('stLoans', { due: fmt(st.loansDue) })}</p>}
    </>
  );
}
