/** AG-D5 register of members as at a date and the share entries: allot (from application money / bank / cash), transfer, surrender, forfeit; certificate print. */
import { useMemo, useState } from 'react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { allotShares, applicationMoney, certificateHtml, deleteShareRow, loadMembers, loadShares, registerAt, transferShares } from '../../lib/agri/ag-members';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, Form, Tbl } from './agd-kit';
import { company, fmt, printPaper, useRun, type Done } from './agd-ui';

const sk = (k: string) => agdT(`sk.${k.replace(/_(in|out)$/, '')}` as AgdKey);

export default function ShareRegisterView({ onDone, mode }: { onDone: Done; mode: 'register' | 'shares' }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const members = useMemo(() => { void tick; return loadMembers(); }, [tick]);
  const rows = useMemo(() => { void tick; return loadShares(); }, [tick]);
  const s = readAgriSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState<Record<string, any>>({ kind: 'allot', face: s.coop?.face_value ?? 100, date: day, paid: 'application', asOf: day });
  const opts = members.map((m) => [m.id, `${m.member_no ?? m.code ?? ''} ${m.name}`.trim()] as const);
  const m = members.find((x) => x.id === f.member);
  if (mode === 'register') {
    return (
      <>
        <Form v={f} set={setF} f={[['asOf', 'asOf', 'd']]}>
          <label><input type="checkbox" checked={!!s.coop?.primary_producers} onChange={(e) => run(() => { saveAgriSettings({ coop: { ...s.coop, primary_producers: e.target.checked } }); })} /> {agdT('primaryProducers')}</label>
        </Form>
        <Tbl head={['folio', 'member', 'shares', 'paidUp', 'since', 'ceased', 'certificates']} rows={registerAt(members, rows, f.asOf).map((r) => [r.folio, r.member.name, r.shares, fmt(r.paid), r.joined, r.ceased ?? '', r.certificates.join(', ')])} />
      </>
    );
  }
  const save = () => run(() => {
    if (!m) throw new Error(agdT('memberNeed'));
    const base = { date: f.date, shares: f.shares, face_value: f.face, approved_on: f.approved || undefined };
    const r = f.kind === 'allot' ? allotShares(m, { ...base, paid_from: f.paid }) : transferShares(m, members.find((x) => x.id === f.to)!, base);
    return agdT('shareSaved', { n: r.certificate_no ?? r.kind });
  });
  return (
    <>
      <Form v={f} set={setF} f={[['kind', 'entry', ['allot', 'transfer'].map((k) => [k, sk(k)] as const)], ['member', 'member', opts], f.kind === 'transfer' && ['to', 'toMember', opts], ['shares', 'shares', 'n', 90], ['face', 'faceValue', 'n', 100], ['date', 'date', 'd'],
        f.kind === 'allot' && ['paid', 'paidFrom', [['application', agdT('application')], ['bank', agdT('bank')], ['cash', agdT('cash')]]], ['approved', 'approvedOn', 'd']]}>
        <B p k="save" on={save} data-agd-b="save-share" />
      </Form>
      {m && <p>{agdT('appMoney', { amount: fmt(applicationMoney([m.id, m.other_id ?? ''], getTable('farmer_cycles'), rows)) })}</p>}
      <Tbl
        head={['date', 'member', 'entry', 'shares', 'amount', 'certificate', '']}
        rows={[...rows].reverse().map((r) => [r.date, r.member_name, sk(r.kind), r.shares, fmt(r.amount), r.certificate_no ?? '', <span key="a">
          {r.certificate_no && <B k="print" on={() => { const mm = members.find((x) => x.id === r.member_id); printPaper(certificateHtml(r, { company: company(), folio: mm?.member_no ?? mm?.code }), r.certificate_no!); }} />}
          <B k="delete" on={() => run(() => { deleteShareRow(r.id); return agdT('deleted'); })} />
        </span>])}
      />
    </>
  );
}
