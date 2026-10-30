/** PS-D1 partners: the deed terms (share, remuneration, interest), a new ratio from a date, drawings. */
import { useMemo, useState } from 'react';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import { todayInput } from '../../lib/utils';
import { A } from '../../lib/ledger/accounts';
import { deletePartner, loadPartners, postDrawings, savePartner, saveRatio, shareProblems, termOn } from '../../lib/prof/ps-partners';
import type { PartnerRemuneration } from '../../types/prof-r14';
import { NumberInput } from '../ui/NumberInput';
import { Fld, Tbl } from './ps-d-ui';
import { inr, type PsDeskCtx, row, sm } from './ps-desk';
import { can } from '../../lib/access';
import { r16bT } from '../../i18n/areas/prof-r16b';
import controls from '../../styles/controls.module.css';

const num = (v: number, on: (n: number) => void, k: string) => <NumberInput className={controls.input} style={{ maxWidth: 110 }} value={v} onChange={on} data-ps={k} />;

export default function PartnersView({ ctx }: { ctx: PsDeskCtx }) {
  const today = todayInput();
  const partners = useMemo(() => { void ctx.tick; return loadPartners(); }, [ctx.tick]);
  const [f, setF] = useState({ name: '', pan: '', kind: 'working' as 'working' | 'non_working', joined: today, share: 0, mode: 'max_allowable' as PartnerRemuneration['mode'], amount: 0, interest: 12, drawInt: 0, deed: '' });
  const [ratio, setRatio] = useState<{ from: string; shares: Record<string, number> }>({ from: today, shares: {} });
  const [dr, setDr] = useState<{ partner: string; amount: number; date: string; from: string }>({ partner: '', amount: 0, date: today, from: A.cash });
  const problems = shareProblems(partners);
  const add = () => ctx.run(() => savePartner({
    name: f.name, ...(f.pan ? { pan: f.pan } : {}), kind: f.kind, joined: f.joined,
    terms: [{ from: f.joined, share_pct: f.share, remuneration: { mode: f.mode, ...(f.mode === 'fixed' ? { amount: f.amount } : f.mode === 'pct_book_profit' ? { pct: f.amount } : {}) }, interest_pct: f.interest, ...(f.drawInt ? { interest_on_drawings_pct: f.drawInt } : {}), ...(f.deed ? { deed_ref: f.deed } : {}) }],
  }));
  return (
    <>
      {problems.map((p) => <p key={p.date} role="alert" className={controls.hint} data-ps-shares>{fdT('sharesBad', { total: p.total, date: p.date })}</p>)}
      <div style={row}>
        <Fld l={fdT('name')}><input className={controls.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-ps="p-name" /></Fld>
        <Fld l={fdT('pan')}><input className={controls.input} style={{ maxWidth: 130 }} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} data-ps="p-pan" /></Fld>
        <Fld l={fdT('kind')}>
          <select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'working' })} data-ps="p-kind">
            <option value="working">{fdT('working')}</option><option value="non_working">{fdT('nonWorking')}</option>
          </select>
        </Fld>
        <Fld l={fdT('joined')}><input type="date" className={controls.input} value={f.joined} onChange={(e) => setF({ ...f, joined: e.target.value })} data-ps="p-joined" /></Fld>
        <Fld l={fdT('share')}>{num(f.share, (v) => setF({ ...f, share: v }), 'p-share')}</Fld>
        <Fld l={fdT('remMode')}>
          <select className={controls.select} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PartnerRemuneration['mode'] })} data-ps="p-mode">
            <option value="max_allowable">{fdT('maxAllow')}</option><option value="fixed">{fdT('fixed')}</option><option value="pct_book_profit">{fdT('pctBp')}</option>
          </select>
        </Fld>
        {f.mode !== 'max_allowable' && <Fld l={f.mode === 'fixed' ? fdT('amount') : fdT('pctBp')}>{num(f.amount, (v) => setF({ ...f, amount: v }), 'p-amount')}</Fld>}
        <Fld l={fdT('interestPct')}>{num(f.interest, (v) => setF({ ...f, interest: v }), 'p-interest')}</Fld>
        <Fld l={fdT('drawIntPct')}>{num(f.drawInt, (v) => setF({ ...f, drawInt: v }), 'p-drawint')}</Fld>
        <Fld l={fdT('deedRef')}><input className={controls.input} style={{ maxWidth: 140 }} value={f.deed} onChange={(e) => setF({ ...f, deed: e.target.value })} /></Fld>
        <button type="button" className={controls.btnPrimary} onClick={add} data-ps-b="p-add">{fdT('add')}</button>
      </div>
      <Tbl empty={fdT('none')} head={[fdT('name'), fdT('pan'), fdT('kind'), fdT('joined'), fdT('share'), fdT('remMode'), fdT('interestPct'), fdT('ratioFrom'), '']} rows={partners.map((p) => {
        const t = termOn(p, today) ?? p.terms[0];
        return [p.name, p.pan ?? '-', p.kind === 'working' ? fdT('working') : fdT('nonWorking'), p.joined, `${t?.share_pct ?? 0}`, t ? (t.remuneration.mode === 'fixed' ? inr(t.remuneration.amount ?? 0) : t.remuneration.mode === 'pct_book_profit' ? `${t.remuneration.pct} %` : fdT('maxAllow')) : '-', `${t?.interest_pct ?? 0}`,
          num(ratio.shares[p.id] ?? t?.share_pct ?? 0, (v) => setRatio({ ...ratio, shares: { ...ratio.shares, [p.id]: v } }), 'r-share'),
          // R16-B5: refused while a partner posting or a ledger line names the partner (recycle bin)
          can('settings.manage') && <button type="button" className={sm} onClick={() => window.confirm(r16bT('delAsk', { name: p.name })) && ctx.run(() => deletePartner(p.id), r16bT('deleted'))} data-ps-b="p-del">{r16bT('del')}</button>];
      })} />
      {partners.length > 1 && (
        <div style={row}>
          <Fld l={fdT('ratioFrom')}><input type="date" className={controls.input} value={ratio.from} onChange={(e) => setRatio({ ...ratio, from: e.target.value })} /></Fld>
          <button type="button" className={controls.btnOutline} onClick={() => ctx.run(() => saveRatio(ratio.from, Object.fromEntries(partners.map((p) => [p.id, ratio.shares[p.id] ?? termOn(p, ratio.from)?.share_pct ?? 0]))))}>{fdT('newRatio')}</button>
        </div>
      )}
      <p className={controls.label}>{fdT('drawings')}</p>
      <div style={row}>
        <Fld l={fdT('kind')}>
          <select className={controls.select} value={dr.partner} onChange={(e) => setDr({ ...dr, partner: e.target.value })} data-ps="d-partner">
            <option value="">-</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Fld>
        <Fld l={fdT('amount')}>{num(dr.amount, (v) => setDr({ ...dr, amount: v }), 'd-amount')}</Fld>
        <Fld l={fdT('date')}><input type="date" className={controls.input} value={dr.date} onChange={(e) => setDr({ ...dr, date: e.target.value })} /></Fld>
        <Fld l={fdT('paidFrom')}>
          <select className={controls.select} value={dr.from} onChange={(e) => setDr({ ...dr, from: e.target.value })}>
            <option value={A.cash}>{fdT('cash')}</option><option value={A.bank}>{fdT('bank')}</option>
          </select>
        </Fld>
        <button type="button" className={controls.btnOutline} onClick={() => ctx.run(() => postDrawings(dr.partner, dr.amount, dr.date, dr.from))} data-ps-b="d-post">{fdT('post')}</button>
      </div>
    </>
  );
}
