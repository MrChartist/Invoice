/** R14 PS-B3 client-money ledger: record receipts, payments on behalf, to-fees, refunds, transfers and interest. */
import { useMemo, useState } from 'react';
import { cmT } from '../../i18n/areas/prof-r14b-cm';
import { localDb } from '../../lib/localDb';
import { isRevenueDoc } from '../../lib/stats';
import { todayInput } from '../../lib/utils';
import { CM_KINDS, cmBalances, totalHeld, type CmInput, type CmKind } from '../../lib/prof/ps-client-money';
import { cmDb, recordClientMoney, removeClientMoney } from '../../lib/prof/ps-cm-post';
import { NumberInput } from '../ui/NumberInput';
import { Fld, Tbl } from '../mfg/mfd-ui';
import { row, rs, sm } from '../mfg/mfd-util';
import type { CmCtx } from './ClientMoneyDesk';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

export default function CmLedgerView({ ctx }: { ctx: CmCtx }) {
  const rows = useMemo(() => { void ctx.version; return cmDb.all(); }, [ctx.version]);
  const [f, setF] = useState<CmInput>(() => ({ kind: 'receipt', date: todayInput(), client_id: '', amount: 0, bank_account_id: ctx.accounts[0]?.id ?? '', purpose: 'expenses', ref: '', narration: '' }));
  const [override, setOverride] = useState('');
  const set = (p: Partial<CmInput>) => setF((x) => ({ ...x, ...p }));
  const name = (id?: string) => ctx.clients.find((c) => c.id === id)?.name ?? '';
  const invoices = useMemo(() => (f.kind === 'to_fees' && f.client_id ? localDb.invoices.getAll().filter((i) => i.client?.id === f.client_id && isRevenueDoc(i) && i.status !== 'Draft' && Number(i.balance_due) > 0) : []), [f.kind, f.client_id]);
  const sel = (k: keyof CmInput, opts: readonly [string, string][], tag?: string) => (
    <SelectField className={controls.select} value={String(f[k] ?? '')} onChange={(e) => set({ [k]: e.target.value || undefined } as Partial<CmInput>)} data-cm={tag ?? k}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </SelectField>
  );
  const clientOpts: [string, string][] = [['', '-'], ...ctx.clients.map((c) => [c.id, c.name] as [string, string])];
  const save = () => ctx.run(() => {
    const r = recordClientMoney({ ...f, ...(f.kind === 'interest' && f.interest_to === 'firm' ? { client_id: '' } : {}) }, { override_reason: override });
    setF((x) => ({ ...x, amount: 0, ref: '', narration: '' }));
    setOverride('');
    return cmT('saved', { number: r.number });
  });
  return (
    <>
      <p className={controls.hint} data-cm-total>{cmT('total', { amount: rs(totalHeld(rows)) })}</p>
      <div style={row}>
        <Fld l={cmT('kind')}>{sel('kind', CM_KINDS.map((k) => [k, cmT(`k.${k}` as 'k.receipt')]))}</Fld>
        <Fld l={cmT('date')}><DateField className={controls.input} value={f.date} onChange={(e) => set({ date: e.target.value })} data-cm="date" /></Fld>
        {!(f.kind === 'interest' && f.interest_to === 'firm') && <Fld l={cmT('client')}>{sel('client_id', clientOpts, 'client')}</Fld>}
        <Fld l={cmT('matter')}>{sel('matter_id', [['', '-'], ...ctx.matters.filter((m) => !m.client_id || m.client_id === f.client_id).map((m) => [m.id, m.name] as [string, string])])}</Fld>
        {f.kind === 'transfer' && <Fld l={cmT('toClient')}>{sel('to_client_id', clientOpts, 'to')}</Fld>}
        <Fld l={cmT('amount')}><NumberInput className={controls.input} style={{ maxWidth: 140 }} value={f.amount} onChange={(v) => set({ amount: v })} data-cm="amount" /></Fld>
        <Fld l={cmT('account')}>{sel('bank_account_id', ctx.accounts.map((a) => [a.id, a.name]))}</Fld>
        {f.kind === 'receipt' && <Fld l={cmT('purpose')}>{sel('purpose', (['expenses', 'fees', 'other'] as const).map((p) => [p, cmT(`p.${p}`)]))}</Fld>}
        {f.kind === 'interest' && <Fld l={cmT('interestTo')}>{sel('interest_to', [['client', cmT('it.client')], ['firm', cmT('it.firm')]])}</Fld>}
        <Fld l={cmT('ref')}><input className={controls.input} value={f.ref} onChange={(e) => set({ ref: e.target.value })} /></Fld>
        <Fld l={cmT('narration')}><input className={controls.input} value={f.narration} onChange={(e) => set({ narration: e.target.value })} /></Fld>
      </div>
      {f.kind === 'to_fees' && (
        <div style={row}>
          <Fld l={cmT('invoice')}>{sel('invoice_id', [['', '-'], ...invoices.map((i) => [i.id, `${i.invoice_number} · ₹${rs(Number(i.balance_due))}`] as [string, string])], 'invoice')}</Fld>
          <Fld l={cmT('auth')}>
            <SelectField className={controls.select} value={f.authority?.mode ?? ''} onChange={(e) => set({ authority: e.target.value ? { date: f.authority?.date || f.date, ref: f.authority?.ref ?? '', mode: e.target.value as 'written' } : undefined })} data-cm="auth">
              <option value="">-</option>
              {(['written', 'email', 'engagement'] as const).map((m) => <option key={m} value={m}>{cmT(`a.${m}`)}</option>)}
            </SelectField>
          </Fld>
          {f.authority && <Fld l={cmT('authRef')}><input className={controls.input} value={f.authority.ref} onChange={(e) => set({ authority: { ...f.authority!, ref: e.target.value } })} data-cm="auth-ref" /></Fld>}
          {f.authority && <Fld l={cmT('authDate')}><DateField className={controls.input} value={f.authority.date} onChange={(e) => set({ authority: { ...f.authority!, date: e.target.value } })} /></Fld>}
          {!f.authority && <Fld l={cmT('override')}><input className={controls.input} value={override} onChange={(e) => setOverride(e.target.value)} /></Fld>}
          <p className={controls.hint} role="note">{cmT('feesWarn')}</p>
        </div>
      )}
      <div style={row}><button type="button" className={controls.btnPrimary} disabled={!ctx.accounts.length} onClick={save} data-cm-b="record">{cmT('record')}</button></div>
      <Tbl empty={cmT('none')} head={[cmT('client'), cmT('matter'), cmT('held')]} rows={cmBalances(rows).map((b) => [name(b.client), ctx.matters.find((m) => m.id === b.matter)?.name ?? '', rs(b.balance)])} />
      <Tbl empty={cmT('none')} head={[cmT('number'), cmT('date'), cmT('kind'), cmT('client'), cmT('amount'), cmT('ref'), '']} rows={[...rows].reverse().map((r) => [
        r.number, r.date, cmT(`k.${r.kind as CmKind}` as 'k.receipt'), `${name(r.client_id)}${r.to_client_id ? ` → ${name(r.to_client_id)}` : ''}`, rs(r.amount), r.ref,
        <button key="d" type="button" className={sm} onClick={() => ctx.run(() => { removeClientMoney(r.id); return cmT('deleted'); })}>{cmT('del')}</button>,
      ])} />
    </>
  );
}
