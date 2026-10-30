/**
 * Reports → Bank stock statement (TR-C4, not pack-gated): drawing power from our stock and debtors on a date, with the
 * margins of the chosen cash-credit account. Print / XLSX. A bank working paper — verify with your CA (TR19).
 */
import { useMemo, useState, type ChangeEvent } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { formatCurrency, todayInput } from '../../lib/utils';
import { bankAccountsDb, pickableBankAccounts } from '../../lib/bank-accounts';
import { can } from '../../lib/access';
import { DEFAULT_TERMS, drawingPower, loadBankStatementSettings, saveBankTerms, statementRows, termsOf } from '../../lib/trade/tr-stock-statement';
import { loadStockStatementInput } from '../../lib/trade/tr-stock-live';
import type { BankStatementTerms } from '../../types/trade-r8';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

type W = Parameters<typeof trT>[0];

export default function StockStatementTab() {
  useT();
  const accounts = pickableBankAccounts('brs', bankAccountsDb.active());
  const [account, setAccount] = useState(() => (accounts.find((a) => a.od) ?? accounts[0])?.id ?? '');
  const [asOf, setAsOf] = useState(todayInput);
  const [terms, setTerms] = useState<BankStatementTerms>(() => termsOf(loadBankStatementSettings().by_account?.[account] ?? { ...DEFAULT_TERMS, limit: accounts.find((a) => a.id === account)?.od_limit }));
  const [msg, setMsg] = useState('');
  const input = useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? loadStockStatementInput(asOf, account, terms) : null), [asOf, account, terms]);
  const s = input ? drawingPower(input) : null;
  const words = (k: string, n?: number) => trT(k as W, n === undefined ? undefined : { n });
  const rows = input && s ? statementRows(input, s, words) : [];
  const pick = (id: string) => {
    setAccount(id);
    setTerms(termsOf(loadBankStatementSettings().by_account?.[id] ?? { ...DEFAULT_TERMS, limit: accounts.find((a) => a.id === id)?.od_limit }));
  };
  const num = (k: keyof BankStatementTerms) => (e: ChangeEvent<HTMLInputElement>) => setTerms((t) => ({ ...t, [k]: e.target.value === '' ? undefined : Number(e.target.value) }));
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`stock-statement-${asOf}.xlsx`, [{ name: 'Stock statement', rows: rows.map((r) => r.map((c) => (typeof c === 'number' ? c : String(c)))) }]);
  };
  return (
    <section className={own.stack} data-stock-statement>
      <h3>{trT('ssTitle')}</h3>
      <p className={own.muted}>{trT('ssIntro')}</p>
      <div className={own.row}>
        <label className={controls.field}><span className={controls.label}>{trT('asOf')}</span><DateField className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className={controls.field}>
          <span className={controls.label}>{trT('bank')}</span>
          <SelectField className={controls.select} value={account} onChange={(e) => pick(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SelectField>
        </label>
        <label className={controls.field}><span className={controls.label}>{trT('stockMargin')}</span><input type="number" min={0} max={100} className={controls.input} value={terms.stock_margin ?? ''} onChange={num('stock_margin')} /></label>
        <label className={controls.field}><span className={controls.label}>{trT('debtorMargin')}</span><input type="number" min={0} max={100} className={controls.input} value={terms.debtor_margin ?? ''} onChange={num('debtor_margin')} /></label>
        <label className={controls.field}><span className={controls.label}>{trT('ageDays')}</span><input type="number" min={1} className={controls.input} value={terms.age_days ?? ''} onChange={num('age_days')} /></label>
        <label className={controls.field}><span className={controls.label}>{trT('limit')}</span><input type="number" min={0} className={controls.input} value={terms.limit ?? ''} onChange={num('limit')} /></label>
      </div>
      {input?.valuerLabel && <p className={own.notice}>{trT('valuerNote', { label: input.valuerLabel })}</p>}
      <div className={own.tableWrap}>
        <table className={own.table}>
          <tbody>
            {rows.slice(1).map(([label, amount], i) => (
              <tr key={i} data-ss-row={i}><td>{label}</td><td className={own.num}>{typeof amount === 'number' ? formatCurrency(amount) : amount}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={own.row}>
        {can('settings.manage') && account && (
          <button type="button" className={controls.btnOutline} onClick={() => { try { saveBankTerms(account, terms); setMsg(trT('saved', { n: trT('saveTerms') })); } catch (err) { setMsg((err as Error).message); } }}>{trT('saveTerms')}</button>
        )}
        <button type="button" className={controls.btnOutline} onClick={() => window.print()}>{trT('print')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => void xlsx()} disabled={!rows.length}>{trT('xlsx')}</button>
      </div>
      {msg && <p className={own.muted} role="status">{msg}</p>}
      <p className={own.muted}>{trT('workingPaper')}</p>
    </section>
  );
}
