/** AG-D5 patronage register per FY and the year-end distribution paper (reserve, limited dividend, patronage bonus) with a draft journal. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadMembers, loadShares, paidUp } from '../../lib/agri/ag-members';
import { distribution, draftAppropriation, fyOf, fyRange, patronage } from '../../lib/agri/ag-patronage';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Tbl } from './agd-kit';
import { btn, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function PatronageView({ onDone }: { onDone: Done }) {
  const { run } = useRun(onDone);
  const [fy, setFy] = useState(fyOf(todayInput()));
  const s = readAgriSettings();
  const [d, setD] = useState({ pat: 0, reservePct: s.coop?.reserve_pct ?? 0, dividendPct: 0, dividendCapPct: s.coop?.dividend_cap_pct ?? 0, pool: 0 });
  const p = useMemo(() => {
    const vendors = getTable<{ id: string; ag?: unknown; principal_kind?: string }>('vendors');
    return patronage(fy, { members: loadMembers(), cycles: getTable('farmer_cycles'), purchases: getTable('purchases'), invoices: localDb.invoices.getAll(), farmerIds: new Set(vendors.filter((v) => v.ag || v.principal_kind === 'agriculturist').map((v) => v.id)) });
  }, [fy]);
  const { to } = fyRange(fy);
  const dist = distribution({ pat: d.pat, reservePct: d.reservePct, dividendPct: d.dividendPct, dividendCapPct: d.dividendCapPct, paidUp: paidUp(loadShares(), to), patronagePool: d.pool, rows: p.rows });
  const bonus = new Map(dist.bonus.map((b) => [b.member.id, b.amount]));
  return (
    <>
      <div style={wrap}>
        <F label={agdT('fy')} w={120}><NumberInput className={controls.input} value={fy} onChange={(v) => setFy(Math.round(v))} calculator={false} /></F>
        <span className={controls.hint}>{agdT('memberShare', { m: fmt(p.members), n: fmt(p.nonMembers), pct: p.memberPct })}</span>
      </div>
      <Tbl head={[agdT('member'), agdT('suppliedQty'), agdT('supplied'), agdT('bought'), agdT('business'), '%', agdT('bonus')]} rows={p.rows.map((r) => [r.member.name, r.suppliedQty, fmt(r.suppliedValue), fmt(r.boughtValue), fmt(r.business), r.share, fmt(bonus.get(r.member.id) ?? 0)])} />
      <h3>{agdT('distribution')}</h3>
      <div style={wrap}>
        <F label={agdT('pat')} w={140}><NumberInput className={controls.input} value={d.pat} onChange={(v) => setD({ ...d, pat: v })} /></F>
        <F label={agdT('reservePct')} w={110}><NumberInput className={controls.input} value={d.reservePct} onChange={(v) => setD({ ...d, reservePct: v })} /></F>
        <F label={agdT('dividendPct')} w={110}><NumberInput className={controls.input} value={d.dividendPct} onChange={(v) => setD({ ...d, dividendPct: v })} /></F>
        <F label={agdT('capPct')} w={110}><NumberInput className={controls.input} value={d.dividendCapPct} onChange={(v) => setD({ ...d, dividendCapPct: v })} /></F>
        <F label={agdT('pool')} w={140}><NumberInput className={controls.input} value={d.pool} onChange={(v) => setD({ ...d, pool: v })} /></F>
      </div>
      <Tbl head={[agdT('reserve'), agdT('dividend'), agdT('bonus'), agdT('retained')]} rows={[[fmt(dist.reserve), fmt(dist.dividend), fmt(dist.patronage), fmt(dist.retained)]]} />
      <button type="button" className={btn} disabled={!(dist.pat > 0)} onClick={() => run(() => agdT('draftPosted', { n: draftAppropriation(dist, to).number }))}>{agdT('postDraft')}</button>
      <p className={controls.hint}>{agdT('patronageNote')}</p>
    </>
  );
}
