import { Fragment, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  GROUPS,
  closingBalances,
  deleteUserAccount,
  groupOf,
  saveUserAccount,
  type GroupId,
  type Ledger,
} from '../../../lib/ledger';
import { formatDate } from '../../../lib/utils';
import { drCr } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import { toCsv } from '../../../lib/csv';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';

interface Props {
  ledger: Ledger;
  asOf: string;
  onChanged: () => void;
  onOpenAccount: (id: string) => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ChartTab({ ledger, asOf, onChanged, onOpenAccount, notify }: Props) {
  useT();
  const uid = useId();
  const [form, setForm] = useState({ code: '', name: '', group: 'INDIRECT_EXPENSES' as GroupId });
  const [error, setError] = useState('');
  const balances = useMemo(() => closingBalances(ledger, asOf), [ledger, asOf]);
  const used = useMemo(() => {
    const s = new Set<string>();
    for (const v of ledger.vouchers) for (const l of v.lines) s.add(l.account);
    return s;
  }, [ledger]);

  const add = () => {
    try {
      const a = saveUserAccount(form);
      setForm({ code: '', name: '', group: form.group });
      setError('');
      onChanged();
      notify(ledgerT('accountAdded', { code: a.code, name: a.name }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = (id: string) => {
    try {
      deleteUserAccount(id, used.has(id));
      onChanged();
      notify(ledgerT('accountDeleted'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const csv = () =>
    toCsv([
      ['Chart of accounts', `Balances as at ${asOf}`, 'Working paper — verify with your CA'],
      ['Code', 'Account', 'Group', 'Schedule III head', 'Balance'],
      ...ledger.accounts.map((a) => [a.code, a.name, groupOf(a.group).label, groupOf(a.group).head, drCr(balances.get(a.id) ?? 0)]),
    ]);

  return (
    <div className={books.stack}>
      <StatementToolbar csv={csv} filename={`chart-of-accounts-${asOf}.csv`} />
      <PrintTitle title={ledgerT('coaTitle')} sub={ledgerT('balancesAsAt', { date: formatDate(asOf) })} />

      <div className={`${surface.card} no-print`}>
        <div className={surface.cardHead}>{ledgerT('addAccountHead')}</div>
        <div className={surface.cardBody}>
          <div className={styles.formGrid}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-code`}>{ledgerT('code')}</label>
              <input id={`${uid}-code`} className={`${controls.input} ${controls.inputMono}`} value={form.code} placeholder={ledgerT('codePh')} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-name`}>{ledgerT('name')}</label>
              <input id={`${uid}-name`} className={controls.input} value={form.name} placeholder={ledgerT('namePh')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-group`}>{ledgerT('group')}</label>
              <select id={`${uid}-group`} className={controls.select} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value as GroupId })}>
                {GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </div>
            <button type="button" className={controls.btnPrimary} onClick={add}>
              <Plus size={16} /> {ledgerT('addAccount')}
            </button>
          </div>
          {error && <div className={controls.error} role="alert">{error}</div>}
          <p className={controls.hint}>
            {ledgerT('coaHint')}
          </p>
        </div>
      </div>

      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{ledgerT('coaCaption', { date: asOf })}</caption>
            <thead>
              <tr>
                <th scope="col">{ledgerT('colCode')}</th>
                <th scope="col">{ledgerT('colAccount')}</th>
                <th scope="col" className={surface.numeric}>{ledgerT('colBalance')}</th>
                <th scope="col" className="no-print"><span className={surface.srOnly}>{ledgerT('actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const list = ledger.accounts.filter((a) => a.group === g.id);
                if (!list.length) return null;
                return (
                  <Fragment key={g.id}>
                    <tr className={styles.groupRow}>
                      <td colSpan={4}>{g.label} <span className={books.muted}>· {g.head}</span></td>
                    </tr>
                    {list.map((a) => (
                      <tr key={a.id}>
                        <td className={styles.code}>{a.code}</td>
                        <td>
                          <button type="button" className={styles.rowButton} onClick={() => onOpenAccount(a.id)}>{a.name}</button>
                          {!a.system && <> <span className={styles.badgeManual}>{ledgerT('yours')}</span></>}
                        </td>
                        <td className={surface.numeric}>{drCr(balances.get(a.id) ?? 0)}</td>
                        <td className="no-print">
                          {!a.system && !used.has(a.id) && (
                            <button type="button" className={controls.btnIcon} aria-label={ledgerT('deleteName', { name: a.name })} onClick={() => remove(a.id)}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
