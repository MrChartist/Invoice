/** R5-C6 security deposits: record (received / paid), adjust, apply to damages, forfeit, refund; balances; schedule CSV. */
import { useMemo, useState } from 'react';
import type { Lease, SecurityDeposit } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { adjustAgainstInvoice, applyToCharge, depositBalance, depositOpenInvoices, depositScheduleCsv, recordDeposit, refundDeposit, refundReceiptHtml, type DepositInput } from '../../lib/property/deposits';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, S, T, Tbl } from '../institutions/Views';
import { attempt, csv, feeCtx, num, printPage, rs, today, type Notify } from '../institutions/ui';

type Act = 'adjust' | 'damages' | 'forfeit' | 'refund';

export function DepositsPanel({ deposits, leases, notify, refresh }: { deposits: readonly SecurityDeposit[]; leases: readonly Lease[]; notify: Notify; refresh: () => void }) {
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const [f, setF] = useState<DepositInput>({ direction: 'received', party_id: '', party_name: '', amount: 0, date: today(), mode: 'bank' });
  const [sel, setSel] = useState<{ d: SecurityDeposit; act: Act; amount: number; inv: string; what: string } | null>(null);
  const set = (x: Partial<DepositInput>) => setF({ ...f, ...x });
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? '';
  const run = (fn: () => void) => attempt(notify, () => { fn(); setSel(null); refresh(); }, iT('saved'));
  const go = () => sel && run(() => {
    const { d, act, amount } = sel;
    if (act === 'adjust') adjustAgainstInvoice(d.id, sel.inv, amount, today());
    else if (act !== 'refund') applyToCharge(d.id, act === 'forfeit' ? 'forfeit' : 'adjust', amount, today(), sel.what, feeCtx(today()));
    else {
      const out = refundDeposit(d.id, amount, today());
      printPage(refundReceiptHtml(out, out.movements[out.movements.length - 1], localDb.settings.activeProfile()?.companyName ?? ''), 'deposit-refund.html');
    }
  });
  // QA6 F3 / F18: the due net of credit notes, read once per picked deposit (shared rows, not a clone per keystroke).
  const party = sel?.act === 'adjust' ? sel.d.party_id : '';
  const open = useMemo(() => depositOpenInvoices(party), [party]);
  return (
    <div className={styles.stack} data-deposits>
      <div className={styles.toolbar}>
        <S l={iT('direction')} v={f.direction} o={[['received', iT('dir.received')], ['paid', iT('dir.paid')]]} on={(v) => set({ direction: v as 'paid' })} />
        <S l={iT('party')} v={f.party_id} o={[['', '—'], ...clients.map((c) => [c.id!, c.name] as const)]} on={(party_id) => set({ party_id, party_name: name(party_id) })} />
        <T l={iT('amount')} v={f.amount || ''} on={(v) => set({ amount: num(v) })} />
        <T l={iT('date')} t="date" v={f.date} on={(date) => set({ date })} />
        <S l={iT('mode')} v={f.mode} o={[['bank', iT('mode.electronic')], ['cash', iT('mode.cash')]]} on={(mode) => set({ mode })} />
        <S l={iT('lease')} v={f.lease_id} o={[['', '—'], ...leases.map((l) => [l.id, `${name(l.tenant_id)} · ${l.start}`] as const)]} on={(v) => set({ lease_id: v || undefined })} />
        <T l={iT('interestPa')} v={f.interest_pct} on={(v) => set({ interest_pct: num(v) || undefined })} />
        <B p l={iT('save')} on={() => run(() => recordDeposit(f))} />
      </div>
      <p className={styles.note}>{iT('depositNote')}</p>
      <div><B l={iT('csv')} on={() => csv(`deposits-${today()}.csv`, depositScheduleCsv(deposits, today(), [iT('party'), iT('direction'), iT('date'), iT('amount'), iT('act.adjust'), iT('act.refund'), iT('balance')]))} /></div>
      <Tbl h={[iT('party'), iT('direction'), iT('date'), iT('amount'), iT('balance'), '']} rows={deposits.map((d) => [d.party_name, iT(`dir.${d.direction}`), d.date, rs(d.amount), rs(depositBalance(d)),
        d.status === 'open' && (d.direction === 'received' ? (['adjust', 'damages', 'forfeit', 'refund'] as const) : (['refund'] as const)).map((a) => <B key={a} sm l={iT(`act.${a}`)} on={() => setSel({ d, act: a, amount: depositBalance(d), inv: '', what: '' })} />)])} />
      {sel && (
        <div className={styles.toolbar}>
          <strong>{iT(`act.${sel.act}`)} · {sel.d.party_name}</strong>
          {sel.act === 'adjust' && <S l={iT('invoice')} v={sel.inv} o={[['', '—'], ...open.map(({ inv: i, due }) => [i.id, `${i.invoice_number} · ${rs(due)}`] as const)]} on={(inv) => setSel({ ...sel, inv })} />}
          {(sel.act === 'damages' || sel.act === 'forfeit') && <T l={iT('description')} v={sel.what} on={(what) => setSel({ ...sel, what })} />}
          <T l={iT('amount')} v={sel.amount || ''} on={(v) => setSel({ ...sel, amount: num(v) })} />
          <B p l={iT('confirm')} on={go} />
          <B g l={iT('cancel')} on={() => setSel(null)} />
        </div>
      )}
    </div>
  );
}
