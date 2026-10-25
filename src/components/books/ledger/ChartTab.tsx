import { Fragment, Suspense, lazy, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import {
  allGroups,
  closingBalances,
  deleteUserAccount,
  groupOf,
  immediateGroupOf,
  loadUserGroups,
  openingDifferenceText,
  openingVoucherDifference,
  saveUserAccount,
  type GroupId,
  type Ledger,
} from '../../../lib/ledger';
import { isMasterScreenParam } from '../../masters/screens';
import { mastersT } from '../../../i18n/areas/masters';
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

// Accounts Info (WP-1): Group / Ledger Create · Alter · Display and opening balances, loaded on demand.
const MastersPanel = lazy(() => import('../../masters/MastersPanel'));

export function ChartTab({ ledger, asOf, onChanged, onOpenAccount, notify }: Props) {
  useT();
  const uid = useId();
  const [params, setParams] = useSearchParams();
  const masterScreen = params.get('m');
  const showMasters = isMasterScreenParam(masterScreen);
  const navigateMasters = (screen: string | null, id?: string) => {
    const next = new URLSearchParams(params);
    if (screen) next.set('m', screen);
    else next.delete('m');
    if (id) next.set('mid', id);
    else next.delete('mid');
    setParams(next, { replace: true });
  };
  // User groups are re-read whenever the ledger is rebuilt (after any master write).
  const userGroups = useMemo(() => {
    void ledger;
    return loadUserGroups();
  }, [ledger]);
  const groups = useMemo(() => allGroups(userGroups), [userGroups]);
  const openingDiff = useMemo(() => openingVoucherDifference(ledger.vouchers.find((v) => v.id.startsWith('obal:'))), [ledger]);
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
      ...ledger.accounts.map((a) => [a.code, a.name, groupOf(immediateGroupOf(a), userGroups).label, groupOf(a.group).head, drCr(balances.get(a.id) ?? 0)]),
    ]);

  return (
    <div className={books.stack}>
      <StatementToolbar csv={csv} filename={`chart-of-accounts-${asOf}.csv`} />
      <PrintTitle title={ledgerT('coaTitle')} sub={ledgerT('balancesAsAt', { date: formatDate(asOf) })} />

      <div className="no-print">
        {!showMasters && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => navigateMasters('menu')}>
            <BookOpen size={16} /> {mastersT('accountsInfo')}
          </button>
        )}
        {showMasters && (
          <Suspense fallback={null}>
            <MastersPanel
              screen={masterScreen as never}
              itemId={params.get('mid') ?? undefined}
              onNavigate={(s, id) => navigateMasters(s, id)}
              onClose={() => navigateMasters(null)}
              onChanged={onChanged}
              notify={notify}
            />
            {masterScreen === 'menu' && (
              <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} style={{ marginTop: 8 }} onClick={() => navigateMasters(null)}>
                {mastersT('back')}
              </button>
            )}
          </Suspense>
        )}
      </div>
      {openingDiff !== 0 && (
        <div className={controls.error} role="status">
          {openingDifferenceText(openingDiff)} — {mastersT('differenceNote')}
        </div>
      )}

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
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{'\u00a0\u00a0'.repeat(g.depth ?? 0)}{g.label}</option>
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
              {groups.map((g) => {
                const list = ledger.accounts.filter((a) => immediateGroupOf(a) === g.id || (a.under && !groups.some((x) => x.id === a.under) && a.group === g.id));
                if (!list.length && g.system) return null;
                return (
                  <Fragment key={g.id}>
                    <tr className={styles.groupRow}>
                      <td colSpan={4} style={g.depth ? { paddingLeft: `${g.depth * 16 + 8}px` } : undefined}>
                        {g.label} <span className={books.muted}>· {g.system ? g.head : groupOf(g.primary ?? g.id).label}</span>
                      </td>
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
