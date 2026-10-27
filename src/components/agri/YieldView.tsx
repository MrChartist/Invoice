/** AG-C5 Mill → Yield & stock: the monthly mill report and the bank stock statement with the mill preset (CSV / XLSX). */
import { useEffect, useState } from 'react';
import type { BankStatementTerms } from '../../types/trade-r8';
import { bankAccountsDb, pickableBankAccounts } from '../../lib/bank-accounts';
import { DEFAULT_TERMS, drawingPower, loadBankStatementSettings, statementRows, termsOf } from '../../lib/trade/tr-stock-statement';
import { loadMillReportInput, loadMillStockStatement, millMonths, type MillGroup, type MillMonth } from '../../lib/agri/ag-mill-reports';
import { csvDownload, fmtMoney, today } from '../transport/shared';
import { Num, Sel, Table, Txt } from './mill-ui';
import { T, errText, q, row } from './mill-kit';
import type { MlKey } from '../../i18n/areas/agri-r12c';
import controls from '../../styles/controls.module.css';

type Statement = Awaited<ReturnType<typeof loadMillStockStatement>>;

const monthRows = (ms: readonly MillMonth[]) => ms.map((m) => [m.month, q(m.intakeOwn), q(m.intakeCmr), q(m.intakeJob), q(m.input), q(m.main), q(m.co), q(m.by), m.outturnPct, m.standard || '', m.byPct, q(m.moistureLoss), m.flagged]);

export default function YieldView() {
  const [months, setMonths] = useState<MillMonth[] | null>(null);
  const [err, setErr] = useState('');
  const accounts = pickableBankAccounts('brs', bankAccountsDb.active());
  const [account, setAccount] = useState(() => (accounts.find((a) => a.od) ?? accounts[0])?.id ?? '');
  const [asOf, setAsOf] = useState(today());
  const [terms, setTerms] = useState<BankStatementTerms>(() => termsOf(loadBankStatementSettings().by_account?.[account] ?? DEFAULT_TERMS));
  const [st, setSt] = useState<Statement | null>(null);
  useEffect(() => {
    loadMillReportInput().then((i) => setMonths(millMonths(i))).catch((e) => setErr(errText(e)));
  }, []);
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return;
    loadMillStockStatement(asOf, account, terms, (g: MillGroup) => T(`g.${g}`)).then(setSt).catch((e) => setErr(errText(e)));
  }, [asOf, account, terms]);
  const head = [T('month'), T('intakeOwn'), T('intakeCmr'), T('intakeJob'), T('milled'), T('main'), T('co'), T('by'), T('outturn'), T('standard'), T('byPct'), T('moistureLoss'), T('flagged')];
  const s = st ? drawingPower(st) : null;
  const sRows = st && s ? statementRows(st, s, (k, v) => T(k as MlKey, v === undefined ? undefined : { n: v })) : [];
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    const real = (months ?? []).flatMap((m) => m.realisation.map((r) => [m.month, r.name, r.qty, r.value, r.rate]));
    await downloadXlsx(`mill-report-${asOf}.xlsx`, [
      { name: 'Monthly', rows: [head, ...monthRows(months ?? [])].map((r) => r.map((c) => (typeof c === 'number' ? c : String(c)))) },
      { name: 'Realisation', rows: [[T('month'), T('by'), T('qty'), T('amount'), T('perUnit')], ...real].map((r) => r.map((c) => (typeof c === 'number' ? c : String(c)))) },
      { name: 'Stock statement', rows: sRows.map((r) => r.map((c) => (typeof c === 'number' ? c : String(c)))) },
    ]);
  };
  return (
    <div data-ml-view="yield">
      {err && <p className={controls.hint} role="alert">{err}</p>}
      <div style={row}>
        <h4>{T('monthly')}</h4>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => csvDownload('mill-report.csv', [head, ...monthRows(months ?? [])])}>{T('csv')}</button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => void xlsx()}>{T('xlsx')}</button>
      </div>
      <Table d="months" head={head} rows={monthRows(months ?? [])} />
      <p className={controls.hint}>{T('unitsNote')}</p>
      <h4>{T('realisation')}</h4>
      <Table d="realisation" head={[T('month'), T('by'), T('qty'), T('amount'), T('perUnit')]} rows={(months ?? []).flatMap((m) => m.realisation.map((r) => [m.month, r.name, r.qty, fmtMoney(r.value), fmtMoney(r.rate)]))} />

      <h4>{T('stockStatement')}</h4>
      <div style={row}>
        <Txt l={T('asOf')} v={asOf} set={setAsOf} type="date" x={170} />
        <Sel l={T('bank')} v={account} set={(x) => { setAccount(x); setTerms(termsOf(loadBankStatementSettings().by_account?.[x] ?? DEFAULT_TERMS)); }} o={accounts.map((a) => [a.id, a.name] as const)} x={220} />
        <Num l={T('stockMargin')} v={String(terms.stock_margin ?? '')} set={(x) => setTerms({ ...terms, stock_margin: Number(x) })} />
        <Num l={T('debtorMargin')} v={String(terms.debtor_margin ?? '')} set={(x) => setTerms({ ...terms, debtor_margin: Number(x) })} />
      </div>
      <Table d="statement" head={['', T('amount')]} rows={sRows.slice(1).map(([l, a]) => [l, typeof a === 'number' ? fmtMoney(a) : a])} />
      {st && st.principalQtl > 0 && <p className={controls.hint} data-ml-principal={st.principalQtl}>{T('principalMemo', { qtl: st.principalQtl })}</p>}
    </div>
  );
}
