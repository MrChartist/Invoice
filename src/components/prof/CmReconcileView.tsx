/** R14 PS-B3 three-way reconciliation: bank statement, ledger and Σ client balances on a date, every difference listed. */
import { useMemo, useState } from 'react';
import { cmT } from '../../i18n/areas/prof-r14b-cm';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { bankLedgerId } from '../../lib/bank-ledgers';
import { loadVouchers } from '../../lib/ledger/vouchers';
import { cmDb } from '../../lib/prof/ps-cm-post';
import { balancesByClient, threeWay } from '../../lib/prof/ps-cm-reco';
import { Fld, Tbl } from '../mfg/mfd-ui';
import { row, rs } from '../mfg/mfd-util';
import type { CmCtx } from './ClientMoneyDesk';
import controls from '../../styles/controls.module.css';

export default function CmReconcileView({ ctx }: { ctx: CmCtx }) {
  const [date, setDate] = useState(todayInput());
  const [stmt, setStmt] = useState('');
  const r = useMemo(() => {
    void ctx.version;
    const rows = cmDb.all();
    return {
      reco: threeWay({
        date, statement: stmt.trim() === '' ? null : Number(stmt) || 0, rows, vouchers: loadVouchers(),
        bankLedgers: new Map(ctx.accounts.map((a) => [bankLedgerId(a.id), { opening: a.opening, as_of: a.opening_as_of }])),
        paymentIds: new Set(getTable<{ id: string }>('transactions').map((p) => p.id)),
      }),
      bal: balancesByClient(rows, date),
    };
  }, [ctx.version, ctx.accounts, date, stmt]);
  const name = (id: string) => ctx.clients.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      <div style={row}>
        <Fld l={cmT('asOn')}><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
        <Fld l={cmT('stmt')}><input className={controls.input} inputMode="decimal" value={stmt} onChange={(e) => setStmt(e.target.value.replace(/[^0-9.-]/g, ''))} data-cm="stmt" /></Fld>
      </div>
      <Tbl empty="" head={['', '₹']} rows={[[cmT('stmt'), r.reco.statement === null ? '—' : rs(r.reco.statement)], [cmT('ledgerBal'), rs(r.reco.ledger)], [cmT('clientsBal'), rs(r.reco.clients)]]} />
      <p className={controls.hint} role="status" data-cm-agreed={r.reco.agreed ? 'yes' : 'no'}>{r.reco.agreed ? cmT('agreed') : cmT('diffs')}</p>
      {r.reco.diffs.length > 0 && <Tbl empty="" head={[cmT('diffs'), cmT('ref'), '₹']} rows={r.reco.diffs.map((d) => [cmT(`d.${d.kind}`), d.ref, rs(d.amount)])} />}
      <Tbl empty={cmT('none')} head={[cmT('client'), cmT('matter'), cmT('held')]} rows={r.bal.map((b) => [name(b.client), ctx.matters.find((m) => m.id === b.matter)?.name ?? '', rs(b.balance)])} />
    </>
  );
}
