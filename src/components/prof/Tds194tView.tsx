/** PS-D2 194T: monthly credits to partners (journal + TDS row), the per-partner FY aggregate and deposit due dates. */
import { useMemo, useState } from 'react';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import { todayInput } from '../../lib/utils';
import { getIndianFY } from '../../lib/invoice-number';
import { sectionText } from '../../lib/ita2025';
import { KINDS_194T, creditPartner, loadPartnerRuns, register194t, undoPartnerRun } from '../../lib/prof/ps-194t';
import { loadPartners } from '../../lib/prof/ps-partners';
import type { PartnerCreditKind } from '../../types/prof-r14d';
import { NumberInput } from '../ui/NumberInput';
import { Fld, Tbl } from './ps-d-ui';
import { inr, sm, type PsDeskCtx, row } from './ps-desk';
import controls from '../../styles/controls.module.css';

export default function Tds194tView({ ctx }: { ctx: PsDeskCtx }) {
  const today = todayInput();
  const [fy, setFy] = useState(getIndianFY(today).startYear);
  const [f, setF] = useState({ partner: '', kind: 'remuneration' as PartnerCreditKind, amount: 0, date: today });
  const data = useMemo(() => { void ctx.tick; return { partners: loadPartners(), runs: loadPartnerRuns() }; }, [ctx.tick]);
  const reg = register194t(fy, data.partners, data.runs);
  const credits = data.runs.filter((r) => r.kind === 'credit' && r.fy === fy);
  return (
    <>
      <div style={row}>
        <Fld l={fdT('fy')}>
          <select className={controls.select} value={fy} onChange={(e) => setFy(+e.target.value)}>{[fy + 1, fy, fy - 1].map((y) => <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}</option>)}</select>
        </Fld>
        <Fld l={fdT('kind')}>
          <select className={controls.select} value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })} data-ps="t-partner">
            <option value="">—</option>{data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Fld>
        <Fld l={fdT('credit')}>
          <select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PartnerCreditKind })}>{KINDS_194T.map((k) => <option key={k} value={k}>{fdT(`k.${k}`)}</option>)}</select>
        </Fld>
        <Fld l={fdT('amount')}><NumberInput className={controls.input} style={{ maxWidth: 120 }} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} data-ps="t-amount" /></Fld>
        <Fld l={fdT('date')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-ps="t-date" /></Fld>
        <button type="button" className={controls.btnPrimary} onClick={() => ctx.run(() => { const r = creditPartner({ partnerId: f.partner, kind: f.kind, amount: f.amount, date: f.date }); return r.tds ? `${fdT('tds')}: ${inr(r.tds)}` : fdT('saved'); })} data-ps-b="t-credit">{fdT('post')}</button>
      </div>
      <p className={controls.hint}>{fdT('note194t')} {sectionText('194T', f.date)}</p>
      <Tbl empty={fdT('none')} head={[fdT('name'), fdT('total'), fdT('tds'), fdT('due')]} rows={reg.map((r) => [r.partner.name, inr(r.total), inr(r.tds), r.credits.filter((c) => c.due).map((c) => c.due).join(', ') || '—'])} />
      <Tbl empty="" head={[fdT('date'), fdT('name'), fdT('credit'), fdT('amount'), fdT('tds'), '']} rows={credits.map((c) => [c.date, data.partners.find((p) => p.id === c.partner_id)?.name ?? '—', fdT(`k.${c.credit_kind ?? 'remuneration'}`), inr(c.amount ?? 0), inr(c.tds ?? 0),
        <button key="u" type="button" className={sm} onClick={() => ctx.run(() => undoPartnerRun(c.id))}>{fdT('undo')}</button>])} />
    </>
  );
}
