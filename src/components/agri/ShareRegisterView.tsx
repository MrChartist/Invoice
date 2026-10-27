/** AG-D5 register of members as at a date (CSV) and the share entries: allot (from application money / bank / cash), transfer, surrender, forfeit; certificate print. */
import { useMemo, useState } from 'react';
import { Download, Printer, Trash2 } from 'lucide-react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { toCsv } from '../../lib/csv';
import { allotShares, applicationMoney, certificateHtml, deleteShareRow, distinctive, loadMembers, loadShares, reduceShares, registerAt, transferShares } from '../../lib/agri/ag-members';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, company, fmt, printPaper, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

const KINDS = ['allot', 'transfer', 'surrender', 'forfeit'] as const;

export default function ShareRegisterView({ onDone, mode }: { onDone: Done; mode: 'register' | 'shares' }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const members = useMemo(() => { void tick; return loadMembers(); }, [tick]);
  const rows = useMemo(() => { void tick; return loadShares(); }, [tick]);
  const s = readAgriSettings();
  const [asOf, setAsOf] = useState(day);
  const [f, setF] = useState({ kind: 'allot' as (typeof KINDS)[number], member: '', to: '', shares: 0, face: s.coop?.face_value ?? 100, date: day, paid: 'application', approved: '' });
  const opts = members.map((m) => [m.id, `${m.member_no ?? m.code ?? ''} ${m.name}`.trim()] as const);
  const m = members.find((x) => x.id === f.member);
  const reg = registerAt(members, rows, asOf);
  const save = () => run(() => {
    if (!m) throw new Error(agdT('memberNeed'));
    const base = { date: f.date, shares: f.shares, face_value: f.face, ...(f.approved ? { approved_on: f.approved } : {}) };
    const r = f.kind === 'allot' ? allotShares(m, { ...base, paid_from: f.paid as 'application' }) : f.kind === 'transfer' ? transferShares(m, members.find((x) => x.id === f.to)!, base) : reduceShares(m, f.kind, { ...base, ...(f.paid !== 'application' && f.kind === 'surrender' ? { refund_by: f.paid as 'bank' } : {}) });
    return agdT('shareSaved', { n: r.certificate_no ?? r.kind });
  });
  if (mode === 'register') {
    const csv = () => downloadText(`members-${asOf}.csv`, toCsv([['Folio', 'Member', 'Shares', 'Paid up', 'Member since', 'Ceased', 'Certificates'], ...reg.map((r) => [r.folio, r.member.name, r.shares, r.paid, r.joined, r.ceased ?? '', r.certificates.join(' ')])]), 'text/csv');
    return (
      <>
        <div style={wrap}>
          <F label={agdT('asOf')}><input type="date" className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></F>
          <button type="button" className={btn} onClick={csv}><Download size={14} aria-hidden="true" /> CSV</button>
          <label><input type="checkbox" checked={!!s.coop?.primary_producers} onChange={(e) => run(() => { saveAgriSettings({ coop: { ...s.coop, primary_producers: e.target.checked } }); })} /> {agdT('primaryProducers')}</label>
        </div>
        <Tbl head={[agdT('folio'), agdT('member'), agdT('shares'), agdT('paidUp'), agdT('since'), agdT('ceased'), agdT('certificates')]} rows={reg.map((r) => [r.folio, r.member.name, r.shares, fmt(r.paid), r.joined, r.ceased ?? '', r.certificates.join(', ')])} />
        <p className={controls.hint}>{agdT('registerNote')}</p>
      </>
    );
  }
  return (
    <>
      <div style={wrap}>
        <F label={agdT('entry')}><Sel value={f.kind} onChange={(v) => setF({ ...f, kind: v as typeof f.kind })} opts={KINDS.map((k) => [k, agdT(`sk.${k}` as AgdKey)] as const)} /></F>
        <F label={agdT('member')}><Sel value={f.member} onChange={(v) => setF({ ...f, member: v })} opts={opts} blank="—" data-agd="share-member" /></F>
        {f.kind === 'transfer' && <F label={agdT('toMember')}><Sel value={f.to} onChange={(v) => setF({ ...f, to: v })} opts={opts} blank="—" /></F>}
        <F label={agdT('shares')} w={90}><NumberInput className={controls.input} value={f.shares} onChange={(v) => setF({ ...f, shares: v })} data-agd="share-count" /></F>
        <F label={agdT('faceValue')} w={100}><NumberInput className={controls.input} value={f.face} onChange={(v) => setF({ ...f, face: v })} /></F>
        <F label={agdT('date')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></F>
        {(f.kind === 'allot' || f.kind === 'surrender') && <F label={agdT('paidFrom')}><Sel value={f.paid} onChange={(v) => setF({ ...f, paid: v })} opts={[['application', agdT(f.kind === 'allot' ? 'application' : 'noRefund')], ['bank', agdT('bank')], ['cash', agdT('cash')]]} /></F>}
        <F label={agdT('approvedOn')}><input type="date" className={controls.input} value={f.approved} onChange={(e) => setF({ ...f, approved: e.target.value })} /></F>
        <button type="button" className={controls.btnPrimary} onClick={save} data-agd-save-share>{agdT('save')}</button>
      </div>
      {m && <p className={controls.hint}>{agdT('appMoney', { amount: fmt(applicationMoney([m.id, m.other_id ?? ''], getTable('farmer_cycles'), rows)) })}</p>}
      <Tbl
        head={[agdT('date'), agdT('member'), agdT('entry'), agdT('shares'), agdT('amount'), agdT('certificate'), '']}
        rows={[...rows].reverse().map((r) => [r.date, r.member_name, agdT(`sk.${r.kind === 'transfer_in' || r.kind === 'transfer_out' ? 'transfer' : r.kind}` as AgdKey), r.kind === 'transfer_out' || r.kind === 'surrender' || r.kind === 'forfeit' ? -r.shares : r.shares, fmt(r.amount), r.certificate_no ?? '',
          <span key="a" style={{ display: 'flex', gap: 4 }}>
            {r.certificate_no && <button type="button" className={btn} aria-label={agdT('print')} onClick={() => { const mm = members.find((x) => x.id === r.member_id); printPaper(certificateHtml(r, { company: company(), folio: mm?.member_no ?? mm?.code, ...distinctive(rows, r.id) }), r.certificate_no!); }} data-agd-print-cert><Printer size={14} aria-hidden="true" /></button>}
            <button type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { deleteShareRow(r.id); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>
          </span>])}
      />
    </>
  );
}
