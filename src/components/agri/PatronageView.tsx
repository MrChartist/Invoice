/** AG-D5 patronage register per FY (members' business; the distribution paper is engine-only for the budget). */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadMembers } from '../../lib/agri/ag-members';
import { fyOf, patronage } from '../../lib/agri/ag-patronage';
import { Form, Tbl } from './agd-kit';
import { fmt, type Done } from './agd-ui';

export default function PatronageView({ onDone }: { onDone: Done }) {
  void onDone;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, setD] = useState<Record<string, any>>({ fy: fyOf(todayInput()) });
  const p = useMemo(() => patronage(d.fy, { members: loadMembers(), cycles: getTable('farmer_cycles'), purchases: getTable('purchases'), invoices: localDb.invoices.getAll(), farmerIds: new Set(getTable<{ id: string; ag?: unknown }>('vendors').filter((v) => v.ag).map((v) => v.id)) }), [d.fy]);
  return (
    <>
      <Form v={d} set={setD} f={[['fy', 'fy', 'n', 120]]} />
      <p>{agdT('memberShare', { m: fmt(p.members), n: fmt(p.nonMembers), pct: p.memberPct })}</p>
      <Tbl head={['member', 'suppliedQty', 'supplied', 'bought', 'business']} rows={p.rows.map((r) => [r.member.name, r.suppliedQty, fmt(r.suppliedValue), fmt(r.boughtValue), `${fmt(r.business)} (${r.share}%)`])} />
    </>
  );
}
