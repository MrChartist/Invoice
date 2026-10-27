/** PS-D1 year-end appropriation: book profit, Sec 40(b) allowable, interest, residual by ratio; post / reverse; statements. */
import { useMemo, useState } from 'react';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import { todayInput } from '../../lib/utils';
import { getIndianFY } from '../../lib/invoice-number';
import { sectionText } from '../../lib/ita2025';
import { computeRun, type RunResult } from '../../lib/prof/ps-partner-run';
import { loadRunInput, partnerStatements, postRun, reverseRun, yearEndRun } from '../../lib/prof/ps-partner-post';
import { NumberInput } from '../ui/NumberInput';
import { Fld, Tbl } from '../mfg/mfd-ui';
import { row } from '../mfg/mfd-util';
import { inr, sm, type PsDeskCtx } from './ps-desk';
import controls from '../../styles/controls.module.css';

export default function AppropriationView({ ctx }: { ctx: PsDeskCtx }) {
  const cur = getIndianFY(todayInput()).startYear;
  const [fy, setFy] = useState(cur - (todayInput().slice(5, 7) < '04' ? 0 : 1));
  const [mode, setMode] = useState<'opening' | 'daily'>('opening');
  const [adj, setAdj] = useState<{ label: string; amount: number }[]>([]);
  const [draft, setDraft] = useState({ label: '', amount: 0 });
  const [res, setRes] = useState<RunResult | null>(null);
  const posted = useMemo(() => { void ctx.tick; return yearEndRun(fy); }, [ctx.tick, fy]);
  const stmts = useMemo(() => { void ctx.tick; try { return partnerStatements(fy); } catch { return []; } }, [ctx.tick, fy]);
  const work = () => ctx.run(() => setRes(computeRun(loadRunInput(fy, mode, adj))), '');
  const kv = (k: Parameters<typeof fdT>[0], v: number) => [fdT(k), inr(v)];
  return (
    <>
      <div style={row}>
        <Fld l={fdT('fy')}>
          <select className={controls.select} value={fy} onChange={(e) => { setFy(+e.target.value); setRes(null); }} data-ps="a-fy">
            {[cur, cur - 1, cur - 2].map((y) => <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}</option>)}
          </select>
        </Fld>
        <Fld l={fdT('capitalMode')}>
          <select className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as 'opening')}><option value="opening">{fdT('opening')}</option><option value="daily">{fdT('daily')}</option></select>
        </Fld>
        <Fld l={fdT('adjLabel')}><input className={controls.input} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Fld>
        <Fld l={fdT('amount')}><NumberInput className={controls.input} style={{ maxWidth: 120 }} value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} /></Fld>
        <button type="button" className={sm} disabled={!draft.label || !draft.amount} onClick={() => { setAdj([...adj, draft]); setDraft({ label: '', amount: 0 }); }}>{fdT('add')}</button>
        <button type="button" className={controls.btnPrimary} onClick={work} data-ps-b="a-compute">{fdT('compute')}</button>
      </div>
      {adj.length > 0 && <p className={controls.hint}>{adj.map((a) => `${a.label}: ${inr(a.amount)}`).join(' · ')}</p>}
      {res && (
        <>
          {res.problems.map((p) => <p key={p} role="alert" className={controls.hint}>{p}</p>)}
          <Tbl empty="" head={['', '']} rows={[
            kv('netProfit', res.netProfit), kv('bookProfit', res.bookProfit), [`${fdT('allowable')} (${sectionText('40(b)', `${fy}-04-01`)})${res.allowableVerified ? '' : ' *'}`, inr(res.allowable)],
            kv('remuneration', res.remunerationTotal), kv('disallowed', res.disallowed + res.interestDisallowed), kv('interest', res.interestTotal), kv('drawingsInterest', res.drawingsInterestTotal), kv('residual', res.residual),
          ]} />
          <Tbl empty="" head={[fdT('name'), fdT('share'), fdT('interest'), fdT('remuneration'), fdT('drawingsInterest'), fdT('shareAmt')]} rows={res.lines.map((l) => [l.name, `${l.share_pct}`, inr(l.interest), inr(l.remuneration), inr(l.drawings_interest), inr(l.share)])} />
          <p className={controls.hint}>{fdT('presNote')}</p>
          {!posted && <button type="button" className={controls.btnPrimary} disabled={res.problems.length > 0} onClick={() => ctx.run(() => { postRun(res, adj); return fdT('posted'); })} data-ps-b="a-post">{fdT('postRun')}</button>}
        </>
      )}
      {posted && <p className={controls.hint} data-ps-posted>{fdT('posted')} {inr(posted.residual ?? 0)} · <button type="button" className={sm} onClick={() => ctx.run(() => reverseRun(fy))}>{fdT('reverse')}</button></p>}
      <p className={controls.label}>{fdT('statement')}</p>
      <Tbl empty={fdT('none')} head={[fdT('name'), fdT('openBal'), fdT('introduced'), fdT('drawings'), fdT('interest'), fdT('remuneration'), fdT('tds'), fdT('drawingsInterest'), fdT('shareAmt'), fdT('closing')]}
        rows={stmts.map((s) => [s.name, inr(s.opening), inr(s.introduced), inr(s.drawings), inr(s.interest), inr(s.remuneration), inr(s.tds), inr(s.drawingsInterest), inr(s.share), inr(s.closing)])} />
    </>
  );
}
