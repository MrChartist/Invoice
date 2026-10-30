/**
 * R16-B1 WIP → Disbursements: unrecovered disbursements by client / matter with ageing, write-off (memo, no journal;
 * period lock) and the owner's reverse, and a fee note's disbursement schedule printed through the print window.
 * Working paper — verify with your CA (PS3, PS56).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { r16bT } from '../../i18n/areas/prof-r16b';
import { psbT } from '../../i18n/areas/prof-r14b';
import { psT } from '../../i18n/areas/prof-r14-common';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { loadCostCentres } from '../../lib/cost-centres';
import { billedBy, currentLiveInvoiceIds } from '../../lib/timesheets';
import { disbursementSchedule, reverseDisbursementWriteOff, unrecoveredDisbursements, writeOffDisbursement, type DisbRow } from '../../lib/prof/ps-disb';
import { disbView, writtenOff, type DisbFilter } from '../../lib/prof/ps-disb-view';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { escHtml } from '../../lib/html-esc';
import { can, currentActor } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

const BUCKETS = ['0–30', '31–60', '61–90', '90+'];

export default function DisbView({ notify }: Pick<PsDeskProps, 'notify'>) {
  useT();
  const run = runWith(notify);
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const [f, setF] = useState<DisbFilter>({});
  const [wo, setWo] = useState({ date: today, reason: '' });
  const [note, setNote] = useState('');
  const data = useMemo(() => {
    void tick;
    const live = currentLiveInvoiceIds();
    const billed = (id: string, ref?: string) => !!billedBy(ref, live, id);
    const p = purchasesDb.all();
    return { p, live, open: unrecoveredDisbursements(p, billed, today), off: (g: DisbFilter) => writtenOff(p, billed, today, g) };
  }, [tick, today]);
  const clients = useMemo(() => new Map(localDb.clients.getAll().map((c) => [c.id, c.name])), []);
  const centres = useMemo(() => new Map(loadCostCentres().map((c) => [c.id, c.ps?.code ? `${c.ps.code}: ${c.name}` : c.name])), []);
  const v = disbView(data.open, f);
  const off = data.off(f);
  const notes = useMemo(() => localDb.invoices.getAll().filter((i) => data.live.has(i.id) && (!f.client || i.client?.id === f.client) && disbursementSchedule(i, data.p).length), [data, f.client]);
  const ids = (k: 'clientId' | 'matterId') => [...new Set([...data.open, ...data.off({})].map((r) => r[k]).filter(Boolean))];
  const act = (fn: () => void, ok: string) => run(() => (fn(), true), ok) && setTick((x) => x + 1);
  const print = () => {
    const inv = notes.find((i) => i.id === note);
    if (!inv) return;
    const t = `${r16bT('schedT')}: ${inv.invoice_number}`;
    const rows = disbursementSchedule(inv, data.p).map((s) => `<tr><td>${escHtml(s.date)}</td><td>${escHtml(s.kind ? psbT(`k.${s.kind}`) : '')}</td><td>${escHtml(s.ref)}</td><td>${escHtml(s.name)}</td><td align="right">${escHtml(formatCurrency(s.amount))}</td></tr>`).join('');
    printHtmlDocument(`<!doctype html><meta charset="utf-8"><title>${escHtml(t)}</title><body><h2>${escHtml(t)}</h2><p>${escHtml(inv.client?.name)}</p><table border="1" cellpadding="4"><tr><th>${escHtml(psT('date'))}</th><th>${escHtml(r16bT('kind'))}</th><th>${escHtml(r16bT('ref'))}</th><th></th><th>${escHtml(psT('amount'))}</th></tr>${rows}</table><p>${escHtml(psT('wp'))}</p></body>`, (h) => downloadText('disbursements.html', h, 'text/html'));
  };
  const name = (r: DisbRow) => clients.get(r.clientId) ?? r.clientId.replace(/^name:/, '');
  return (
    <div className={surface.card} data-disb-view>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <Field label={psT('client')}><select className={controls.select} value={f.client ?? ''} onChange={(e) => setF({ ...f, client: e.target.value || undefined })} data-disb-client><option value="">-</option>{ids('clientId').map((id) => <option key={id} value={id}>{clients.get(id) ?? id.replace(/^name:/, '')}</option>)}</select></Field>
          <Field label={psT('matter')}><select className={controls.select} value={f.matter ?? ''} onChange={(e) => setF({ ...f, matter: e.target.value || undefined })}><option value="">-</option>{ids('matterId').map((id) => <option key={id} value={id}>{centres.get(id) ?? id}</option>)}</select></Field>
        </div>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-disb-buckets>
            <thead><tr><th>{r16bT('days')}</th>{BUCKETS.map((b) => <th key={b} className={surface.numeric}>{b}</th>)}<th className={surface.numeric}>{psT('total')}</th></tr></thead>
            <tbody><tr><td>{r16bT('title')}</td>{v.buckets.map((n, k) => <td key={k} className={surface.numeric} data-disb-bucket={k}>{formatCurrency(n)}</td>)}<td className={surface.numeric}>{formatCurrency(v.total)}</td></tr></tbody>
          </table>
        </div>
        <div className={controls.row3}>
          <Field label={r16bT('woDate')}><input type="date" className={controls.input} value={wo.date} onChange={(e) => setWo({ ...wo, date: e.target.value })} /></Field>
          <Field label={psT('reason')}><input className={controls.input} value={wo.reason} onChange={(e) => setWo({ ...wo, reason: e.target.value })} data-disb-reason /></Field>
        </div>
        {!v.rows.length && <p className={controls.hint}>{r16bT('none')}</p>}
        <div className={surface.tableWrap}>
          <table className={surface.table} data-disb-rows>
            <thead><tr><th>{psT('date')}</th><th>{psT('client')}</th><th>{psT('matter')}</th><th>{r16bT('kind')}</th><th>{r16bT('ref')}</th><th className={surface.numeric}>{psT('amount')}</th><th className={surface.numeric}>{r16bT('age')}</th><th /></tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.id} data-disb-row={r.id}>
                  <td>{r.date}</td><td>{name(r)}</td><td>{centres.get(r.matterId) ?? ''}</td><td>{r.kind ? psbT(`k.${r.kind}`) : ''}</td><td>{r.ref}</td>
                  <td className={surface.numeric}>{formatCurrency(r.amount)}</td><td className={surface.numeric}>{r.age}</td>
                  <td>{can('books.edit') && <button type="button" className={controls.btnOutline} onClick={() => act(() => writeOffDisbursement(r.id, wo.date, wo.reason, currentActor()?.name), r16bT('woDone'))} data-disb-wo>{r16bT('wo')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {off.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table} data-disb-off>
              <caption>{r16bT('off')}</caption>
              <tbody>{off.map((r) => <tr key={r.id}><td>{r.date}</td><td>{name(r)}</td><td>{r.ref}</td><td className={surface.numeric}>{formatCurrency(r.amount)}</td><td>{r.wo.date}</td><td>{r.wo.reason}</td><td>{can('settings.manage') && <button type="button" className={controls.btnOutline} onClick={() => act(() => reverseDisbursementWriteOff(r.id), r16bT('revDone'))} data-disb-rev>{r16bT('rev')}</button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {notes.length > 0 && (
          <div className={controls.row}>
            <Field label={r16bT('sched')}><select className={controls.select} value={note} onChange={(e) => setNote(e.target.value)}><option value="">-</option>{notes.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {i.client?.name}</option>)}</select></Field>
            <button type="button" className={controls.btnOutline} disabled={!note} onClick={print}>{psT('print')}</button>
          </div>
        )}
        <p className={controls.hint}>{r16bT('woNote')}</p>
      </div>
    </div>
  );
}
