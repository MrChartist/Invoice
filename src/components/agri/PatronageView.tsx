/** AG-D5 patronage register per FY and the year-end distribution paper (reserve, limited dividend, patronage bonus) with a draft journal. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadMembers, loadShares, paidUp } from '../../lib/agri/ag-members';
import { distribution, fyOf, fyRange, patronage } from '../../lib/agri/ag-patronage';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { Form, Tbl } from './agd-kit';
import { fmt, type Done } from './agd-ui';

export default function PatronageView({ onDone }: { onDone: Done }) {
  void onDone;
  const c = readAgriSettings().coop;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, setD] = useState<Record<string, any>>({ fy: fyOf(todayInput()), reservePct: c?.reserve_pct ?? 0, capPct: c?.dividend_cap_pct ?? 0 });
  const p = useMemo(() => patronage(d.fy, { members: loadMembers(), cycles: getTable('farmer_cycles'), purchases: getTable('purchases'), invoices: localDb.invoices.getAll(), farmerIds: new Set(getTable<{ id: string; ag?: unknown }>('vendors').filter((v) => v.ag).map((v) => v.id)) }), [d.fy]);
  const { to } = fyRange(d.fy);
  const dist = distribution({ pat: d.pat, reservePct: d.reservePct, dividendPct: d.dividendPct, dividendCapPct: d.capPct, paidUp: paidUp(loadShares(), to), patronagePool: d.pool, rows: p.rows });
  const bonus = new Map(dist.bonus.map((b) => [b.member.id, b.amount]));
  return (
    <>
      <Form v={d} set={setD} f={[['fy', 'fy', 'n', 120], ['pat', 'pat', 'n', 140], ['reservePct', 'reservePct', 'n', 110], ['dividendPct', 'dividendPct', 'n', 110], ['capPct', 'capPct', 'n', 110], ['pool', 'pool', 'n', 140]]} />
      <p>{agdT('memberShare', { m: fmt(p.members), n: fmt(p.nonMembers), pct: p.memberPct })}</p>
      <Tbl head={['member', 'suppliedQty', 'supplied', 'bought', 'business', 'bonus']} rows={p.rows.map((r) => [r.member.name, r.suppliedQty, fmt(r.suppliedValue), fmt(r.boughtValue), `${fmt(r.business)} (${r.share}%)`, fmt(bonus.get(r.member.id) ?? 0)])} />
      <h3>{agdT('distribution')}</h3>
      <Tbl head={['reserve', 'dividend', 'bonus', 'retained']} rows={[[fmt(dist.reserve), fmt(dist.dividend), fmt(dist.patronage), fmt(dist.retained)]]} />
    </>
  );
}
