/** MF-D4 incentive claims: PLI, subsidies, subvention — claim, reasonable assurance (journal), receipt; 180-day bell. */
import { useMemo, useState } from 'react';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import { todayInput } from '../../lib/utils';
import { claimFigures, grantAssetLedgers, INCENTIVE_SCHEMES, incentiveClaimsDb, pendingClaims, receiveClaim, recogniseClaim, suggestedClaim, type IncentiveClaim } from '../../lib/mfg/mf-incentives';
import { NumberInput } from '../ui/NumberInput';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';

const LABEL: Record<string, string> = { pli: 'PLI', state_capital: 'State capital subsidy', interest_subvention: 'Interest subvention', power: 'Power subsidy', sgst_reimbursement: 'SGST reimbursement', freight: 'Freight subsidy', other: 'Other' };

export default function IncentivesView({ ctx }: { ctx: MfgContext }) {
  const today = todayInput();
  const rows = useMemo(() => { void ctx.version; return incentiveClaimsDb.all(); }, [ctx.version]);
  const [f, setF] = useState<Omit<IncentiveClaim, 'id' | 'voucher_ids'>>({ scheme: 'pli', name: '', period_from: '', period_to: '', claimed: 0, kind: 'income' });
  const [act, setAct] = useState({ date: today, amount: 0 });
  const assets = useMemo(() => { void ctx.version; return grantAssetLedgers(); }, [ctx.version]);
  const bell = pendingClaims(rows, today);
  const n = (k: 'eligible_base' | 'rate_pct' | 'claimed' | 'approved') => <NumberInput className={controls.input} style={{ maxWidth: 120 }} value={f[k] ?? 0} onChange={(v) => setF({ ...f, [k]: v, ...(k === 'eligible_base' || k === 'rate_pct' ? { claimed: suggestedClaim(k === 'eligible_base' ? v : f.eligible_base, k === 'rate_pct' ? v : f.rate_pct) || f.claimed } : {}) })} data-mfd={`inc-${k}`} />;
  return (
    <>
      {bell.length > 0 && <p role="status" className={controls.hint}>{sdT('pendingBell', { n: bell.length })}</p>}
      <div style={row}>
        <Fld l={sdT('scheme')}>
          <select className={controls.select} value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value as IncentiveClaim['scheme'] })} data-mfd="inc-scheme">
            {INCENTIVE_SCHEMES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </Fld>
        <Fld l={sdT('name')}><input className={controls.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-mfd="inc-name" /></Fld>
        <Fld l={sdT('from')}><input type="date" className={controls.input} value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} data-mfd="inc-from" /></Fld>
        <Fld l={sdT('to')}><input type="date" className={controls.input} value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} data-mfd="inc-to" /></Fld>
        <Fld l={sdT('base')}>{n('eligible_base')}</Fld>
        <Fld l={sdT('ratePct')}>{n('rate_pct')}</Fld>
        <Fld l={sdT('claimed')}>{n('claimed')}</Fld>
        <Fld l={sdT('approved')}>{n('approved')}</Fld>
        <Fld l={sdT('kind')}>
          <select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as IncentiveClaim['kind'] })}>
            <option value="income">{sdT('income')}</option>
            <option value="capital">{sdT('capital')}</option>
          </select>
        </Fld>
        {f.kind === 'capital' && (
          <Fld l={sdT('assetLedger')}>
            <select className={controls.select} value={f.asset_account_id ?? ''} onChange={(e) => setF({ ...f, asset_account_id: e.target.value || undefined })} data-mfd="inc-asset">
              <option value="">{sdT('capitalReserve')}</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Fld>
        )}
        <button type="button" className={controls.btnPrimary} disabled={!ctx.canBooks} onClick={() => run(ctx, () => { incentiveClaimsDb.save(f); return sdT('saved'); })} data-mfd-b="inc-add">{sdT('add')}</button>
      </div>
      <div style={row}>
        <Fld l={sdT('assurance')}><input type="date" className={controls.input} value={act.date} onChange={(e) => setAct({ ...act, date: e.target.value })} data-mfd="inc-date" /></Fld>
        <Fld l={sdT('amount')}><NumberInput className={controls.input} style={{ maxWidth: 120 }} value={act.amount} onChange={(v) => setAct({ ...act, amount: v })} data-mfd="inc-amount" /></Fld>
      </div>
      <Tbl empty={sdT('none')} head={[sdT('name'), sdT('period'), sdT('claimed'), sdT('recognised'), sdT('received'), sdT('pending'), '']} rows={rows.map((r) => {
        const x = claimFigures(r, today);
        return [`${LABEL[r.scheme]} · ${r.name}`, `${r.period_from} – ${r.period_to}`, rs(r.claimed), r.recognised_on ? `${rs(x.recognised)} (${r.recognised_on})` : '-', rs(x.received), rs(x.pending),
          <span key="a">{!r.recognised_on && <button type="button" className={sm} disabled={!ctx.canBooks} onClick={() => run(ctx, () => { recogniseClaim(r.id, act.date); return sdT('saved'); })} data-mfd-b="inc-recognise">{sdT('recognise')}</button>}
            {r.recognised_on && x.receivable > 0 && <button type="button" className={sm} disabled={!ctx.canBooks} onClick={() => run(ctx, () => { receiveClaim(r.id, act.amount || x.receivable, act.date); return sdT('saved'); })} data-mfd-b="inc-receive">{sdT('receive')}</button>}</span>];
      })} />
      <p className={controls.hint}>{sdT('grantNote')}</p>
    </>
  );
}
