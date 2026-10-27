/** AG-D2 rent: plans (basis, season, charges, class, billing), bills in advance / by period / at season end, rent due and the unbilled memo. */
import { useMemo, useState } from 'react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { loadLots } from '../../lib/agri/ag-cold-lots';
import { deletePlan, loadPlans, raiseRentBill, rentDue, savePlan, suggestClass, unbilledRent } from '../../lib/agri/ag-cold-rent';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';
import { B, Form, Hint, Tbl } from './agd-kit';
import { fmt, useRun, type Done } from './agd-ui';

const o = (xs: readonly string[], p: string) => xs.map((x) => [x, agdT(`${p}${x}` as AgdKey)] as const);
const blank = { name: '', basis: 'bag_season', rate: 0, from: '03-01', to: '11-30', part_month: 'full', class: 'storage_agri', bill_at: 'out', c1: '', c1rate: 0, c1when: 'out' };

export default function RentView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const plans = useMemo(() => { void tick; return loadPlans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState<Record<string, any>>(blank);
  const [b, setB] = useState<Record<string, string>>({});
  const set = (v: typeof f) => setF(v.commodity !== f.commodity || v.space !== f.space ? { ...v, class: suggestClass(v.commodity ?? '', v.space) ?? v.class } : v);
  const save = () => run(() => {
    const p = savePlan({
      name: f.name, basis: f.basis, rate: f.rate, season: { from: f.from, to: f.to }, part_month: f.part_month, class: f.class, bill_at: f.bill_at, min_months: f.min_months || undefined, space: f.space,
      charges: f.c1 ? [{ name: f.c1, basis: 'bag', rate: f.c1rate, when: f.c1when }] : [],
      ...(f.late && f.lateRate > 0 ? { late: { after: f.late, rate_per_bag_month: f.lateRate } } : {}), ...(f.nRate > 0 && f.nRef ? { notified: { rate: f.nRate, order_ref: f.nRef } } : {}),
    });
    setF(blank);
    return agdT('planSaved', { n: p.name });
  });
  const lot = lots.find((l) => l.id === b.lot);
  const invoices = useMemo(() => { void tick; return localDb.invoices.getAll(); }, [tick]);
  const due = rentDue(invoices, lots);
  const bill = (occ: Parameters<typeof raiseRentBill>[1]) => run(() => { const i = raiseRentBill(lot!, occ); return agdT('billRaised', { n: i.invoice_number, total: i.total }); });
  return (
    <>
      <Form v={f} set={set} f={[['name', 'planName'], ['commodity', 'commodity', 't', 140], ['basis', 'basis', o(['bag_season', 'bag_month', 'qtl_season', 'qtl_month', 'flat'], 'b.')], ['rate', 'rate', 'n', 100], ['from', 'seasonFrom', 't', 90], ['to', 'seasonTo', 't', 90], ['min_months', 'minMonths', 'n', 90], ['part_month', 'partMonth', o(['full', 'days'], 'pm.')], ['class', 'class', o(['storage_agri', 'storage_other'], 'c.')], ['bill_at', 'billAt', o(['out', 'in', 'monthly', 'season_end'], 'at.')], ['space', 'space', 'c'],
        ['c1', 'charge', 't', 140], ['c1rate', 'perBag', 'n', 90], ['c1when', 'when', o(['in', 'out'], 'w.')], ['late', 'lateAfter', 't', 110], ['lateRate', 'lateRate', 'n', 110], ['nRate', 'notifiedRate', 'n', 110], ['nRef', 'orderRef', 't', 160]]}>
        <B p k="savePlan" on={save} data-agd-b="save-plan" />
      </Form>
      <Hint k={f.space ? 'spaceNote' : f.class === 'storage_agri' ? 'clsAgri' : 'clsOther'} />
      <Tbl head={['planName', 'basis', 'rate', 'class', '']} rows={plans.map((p) => [p.name, agdT(`b.${p.basis}`), p.rate, agdT(`c.${p.class}`), <B key="d" k="delete" on={() => run(() => { deletePlan(p.id, lots); return agdT('deleted'); })} />])} />
      <h3>{agdT('raiseBill')}</h3>
      <Form v={b} set={setB} f={[['lot', 'lot', lots.map((l) => [l.id, `${l.number} · ${l.depositor_name}`] as const)], ['from', 'from', 'd'], ['to', 'to', 'd']]}>
        <B k="billAdvance" off={!lot} on={() => bill({ kind: 'in' })} />
        <B k="billMonth" off={!lot} on={() => bill({ kind: 'month', from: b.from, to: b.to })} />
        <B k="billSeason" off={!lot} on={() => bill({ kind: 'season_end', date: b.to })} />
      </Form>
      <h3>{agdT('rentDue')}</h3>
      <Tbl head={['depositor', 'season', 'billed', 'due', '']} flag={due.map((r) => r.closedUnpaid)} rows={due.map((r) => [r.depositor, r.season, fmt(r.billed), fmt(r.due), r.closedUnpaid ? agdT('closedUnpaid') : ''])} />
      <h3>{agdT('unbilled')}</h3>
      <Tbl head={['lot', 'depositor', 'amount']} rows={unbilledRent(lots, plans, invoices, todayInput()).map((u) => [u.lot.number, u.lot.depositor_name, fmt(u.amount)])} />
      <Hint k="unbilledNote" />
    </>
  );
}
