/**
 * SV-A5 claims desk (mounted by the workshop desk's `claims` view, and by SV-B's in-patient view): claims with the
 * payer's outstanding and age; *Make the two bills* splits a draft job bill (all the lines) into the payer's approved
 * part and the beneficiary's rest (the draft itself becomes the beneficiary's bill, so no number is skipped); a short
 * payment is written off with reason "Claim deduction"; a rejection re-bills the beneficiary and cancels the payer bill.
 * Working papers — verify with your CA (SV9, SV22).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import type { ClaimKind, PayerClaim } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { billClaim, claimOutstanding, loadClaims, markClaimPaid, rejectAndRebill, saveClaim, writeOffShort } from '../../lib/services/sv-claims';
import { useT } from '../../i18n';
import { svT, type SvKey } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './services.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
const KINDS: ClaimKind[] = ['motor', 'health_tpa', 'corporate', 'other'];
const blank = () => ({ kind: 'motor' as ClaimKind, date: todayInput(), payer_id: '', beneficiary_id: '', beneficiary_name: '', policy_no: '', claim_no: '', reference: '', estimate: 0, approved: 0, notes: '' });

export default function ClaimsView({ notify }: { notify: Notify }) {
  useT();
  const [tick, setTick] = useState(0);
  const [f, setF] = useState(blank);
  const [src, setSrc] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  /* eslint-disable react-hooks/exhaustive-deps */
  const claims = useMemo(() => loadClaims().sort((a, b) => b.date.localeCompare(a.date)), [tick]);
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), []);
  const drafts = invoices.filter((i) => i.status === 'Draft' && (i.doc_type === 'INVOICE' || i.doc_type === 'TAX_INVOICE') && !i.sv?.claim);
  const today = todayInput();
  const run = (fn: () => void, ok = svT('saved')) => {
    try {
      fn();
      notify(ok);
      setTick((n) => n + 1);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
  };
  const set = (p: Partial<ReturnType<typeof blank>>) => setF((x) => ({ ...x, ...p }));
  const field = (k: SvKey, node: ReactNode) => <label className={controls.field}><span className={controls.label}>{svT(k)}</span>{node}</label>;
  const create = () => {
    const payer = clients.find((c) => c.id === f.payer_id);
    const ben = clients.find((c) => c.id === f.beneficiary_id);
    return run(() => saveClaim({ ...f, payer_id: payer?.id, payer_name: payer?.name ?? '', beneficiary_id: ben?.id, beneficiary_name: ben?.name ?? f.beneficiary_name }));
  };
  const bill = (c: PayerClaim) => {
    const draft = invoices.find((i) => i.id === src[c.id]);
    if (!draft) return notify(svT('c.source'), 'error');
    run(() => billClaim(c.id, draft.items, { approved: c.approved, total: Number(draft.total) || 0 }, today, draft), svT('c.billed'));
  };

  return (
    <section className={surface.card} data-claims-desk>
      <div className={surface.cardBody}>
        <h3>{svT('c.title')}</h3>
        <p className={controls.hint}>{svT('c.note')}</p>
        <div className={styles.form}>
          {field('c.kind', <select className={controls.select} value={f.kind} onChange={(e) => set({ kind: e.target.value as ClaimKind })}>{KINDS.map((k) => <option key={k} value={k}>{svT(`ck.${k}`)}</option>)}</select>)}
          {field('date', <input className={controls.input} type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />)}
          {field('c.payer', <select className={controls.select} value={f.payer_id} onChange={(e) => set({ payer_id: e.target.value })} data-claim-payer><option value="">-</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {field('c.beneficiary', <select className={controls.select} value={f.beneficiary_id} onChange={(e) => set({ beneficiary_id: e.target.value })} data-claim-beneficiary><option value="">-</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {field('c.policy', <input className={controls.input} value={f.policy_no} onChange={(e) => set({ policy_no: e.target.value })} />)}
          {field('c.claimNo', <input className={controls.input} value={f.claim_no} onChange={(e) => set({ claim_no: e.target.value })} />)}
          {field('c.ref', <input className={controls.input} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />)}
          {field('c.estimate', <input className={controls.input} type="number" min={0} value={f.estimate || ''} onChange={(e) => set({ estimate: Number(e.target.value) })} />)}
          {field('c.approved', <input className={controls.input} type="number" min={0} value={f.approved || ''} onChange={(e) => set({ approved: Number(e.target.value) })} data-claim-approved />)}
        </div>
        <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={() => create() && setF(blank())} data-claim-save>{svT('c.new')}</button></div>
        {!claims.length ? <p className={controls.hint}>{svT('c.none')}</p> : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>#</th><th>{svT('date')}</th><th>{svT('c.payer')}</th><th>{svT('c.beneficiary')}</th><th>{svT('c.approved')}</th><th>{svT('c.status')}</th><th>{svT('c.due')}</th><th /></tr></thead>
              <tbody>
                {claims.map((c) => {
                  const o = claimOutstanding(c, invoices, today);
                  return (
                    <tr key={c.id} data-claim={c.number}>
                      <td>{c.number}</td><td>{formatDate(c.date)}</td><td>{c.payer_name}</td><td>{c.beneficiary_name}</td><td>{formatCurrency(c.approved)}</td><td>{svT(`cs.${c.status}`)}</td>
                      <td>{o.due ? `${formatCurrency(o.due)} · ${o.age} ${svT('c.age')}` : '-'}</td>
                      <td>
                        {!c.payer_invoice_id && !c.beneficiary_invoice_id && (
                          <>
                            <select className={controls.select} value={src[c.id] ?? ''} onChange={(e) => setSrc({ ...src, [c.id]: e.target.value })} aria-label={svT('c.source')} data-claim-source>
                              <option value="">{svT('c.source')}</option>
                              {drafts.map((d) => <option key={d.id} value={d.id}>{`${d.invoice_number || '-'} · ${d.client?.name ?? ''} · ${formatCurrency(Number(d.total) || 0)}`}</option>)}
                            </select>
                            <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => bill(c)} data-claim-bill>{svT('c.bill')}</button>
                          </>
                        )}
                        {c.payer_invoice_id && (c.status === 'billed' || c.status === 'approved') && (
                          <>
                            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => markClaimPaid(c.id))}>{svT('c.paid')}</button>
                            {o.due > 0 && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => writeOffShort(c.id, today))}>{svT('c.writeOff')}</button>}
                            <input className={controls.input} placeholder={svT('reason')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={svT('reason')} />
                            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => rejectAndRebill(c.id, reason, today))}>{svT('c.reject')}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
