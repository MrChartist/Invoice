/**
 * Books → Funds (R5-C4): funds (restricted / corpus / FCRA cost centres), inter-fund transfers, the fund statement for
 * the Books period, and the FCRA desk (FC-4, Sec 11 tracker). Lazy; listed with the `nonprofit` pack.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Period } from '../../lib/books';
import type { FundInfo } from '../../types/institutions-r5';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { loadLedger } from '../../lib/ledger';
import { NATURES, ensureGeneralFund, loadFunds, saveFund, transferBetweenFunds } from '../../lib/nonprofit/funds';
import { useT } from '../../i18n';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, S, Shell, T } from '../institutions/Views';
import { attempt, num, opts, rs, today, useView, type Notify } from '../institutions/ui';
import { FundStatement } from './FundStatement';
import { Fc4Panel } from './Fc4Panel';

const VIEWS = ['funds', 'statement', 'fcra'] as const;

export default function FundsTab({ period, notify }: { period: Period; notify: Notify }) {
  useT();
  const [view, go] = useView(VIEWS);
  // The default "General fund" is created once, the first time the tab opens with the pack on.
  const [tick, setTick] = useState(() => {
    if (isPackOn(localDb.settings.get(), 'nonprofit')) attempt(notify, () => ensureGeneralFund());
    return 0;
  });
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const funds = useMemo(() => loadFunds(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledger = useMemo(() => loadLedger(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState('');
  const fund = funds.find((f) => f.id === id) ?? funds[0];
  const [f, setF] = useState<{ name: string } & FundInfo>({ name: '', nature: 'restricted' });
  const [tr, setTr] = useState({ from: '', to: '', amount: 0, date: today() });
  const pick = [['', '—'] as const, ...funds.map((x) => [x.id, x.name] as const)];
  const run = (fn: () => void) => attempt(notify, () => { fn(); refresh(); }, iT('saved'));
  return (
    <Shell pack="nonprofit" views={VIEWS} view={view} go={go} label={(v) => iT(`funds.${v}`)} note={iT('fundsNote')} d="funds-tab">
      {view === 'funds' && (
        <div className={styles.stack}>
          {funds.map((x) => <div key={x.id} className={styles.line}><strong>{x.name}</strong><span className={styles.note}>{iT(`nature.${x.fund.nature}`)}{x.fund.purpose ? ` · ${x.fund.purpose}` : ''}{x.fund.budget ? ` · ${rs(x.fund.budget)}` : ''}</span></div>)}
          <div className={styles.toolbar}>
            <T l={iT('name')} v={f.name} on={(name) => setF({ ...f, name })} />
            <S l={iT('nature')} v={f.nature} o={opts(NATURES, 'nature.')} on={(v) => setF({ ...f, nature: v as FundInfo['nature'] })} />
            <T l={iT('purpose')} v={f.purpose} on={(purpose) => setF({ ...f, purpose })} />
            <T l={iT('budget')} v={f.budget || ''} on={(v) => setF({ ...f, budget: num(v) })} />
            <B p l={iT('addFund')} on={() => run(() => { const { name, ...fund } = f; saveFund({ name, fund }); setF({ name: '', nature: 'restricted' }); })} />
          </div>
          <h3>{iT('transfer')}</h3>
          <div className={styles.toolbar}>
            <S l={iT('from')} v={tr.from} o={pick} on={(from) => setTr({ ...tr, from })} />
            <S l={iT('to')} v={tr.to} o={pick} on={(to) => setTr({ ...tr, to })} />
            <T l={iT('amount')} v={tr.amount || ''} on={(v) => setTr({ ...tr, amount: num(v) })} />
            <T l={iT('date')} t="date" v={tr.date} on={(date) => setTr({ ...tr, date })} />
            <B l={iT('transfer')} on={() => run(() => transferBetweenFunds(tr.from, tr.to, tr.amount, tr.date))} />
          </div>
        </div>
      )}
      {view === 'statement' && fund && (
        <div className={styles.stack}>
          <S l={iT('fund')} v={fund.id} o={pick.slice(1)} on={setId} />
          <FundStatement ledger={ledger} fund={fund} period={period} />
        </div>
      )}
      {view === 'fcra' && <Fc4Panel ledger={ledger} funds={funds} notify={notify} refresh={refresh} />}
    </Shell>
  );
}
