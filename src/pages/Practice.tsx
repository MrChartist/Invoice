import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Download, Lock, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LearnMore, practiceEmpty } from '../components/discover';
import { discoverT } from '../i18n/areas/discover-r6';
import { DscRegister } from '../components/practice/DscRegister';
import { ChecklistPanel } from '../components/practice/ChecklistPanel';
import { buildPracticeBoard, boardCsv, boardTable, peekedCompany, type PeekedCompany, type PracticeRow, type PracticeTables } from '../lib/practice';
import { checklistDb } from '../lib/client-checklist';
import { companyDbName } from '../lib/company-registry';
import { activeCompanyId, deleteCompany, readRegistry, realCompanies, switchCompany } from '../lib/companies';
import { SINGLETON_KEYS, getJson, getTable } from '../lib/storage';
import { todayIso } from '../lib/tax-rules';
import { downloadText } from '../lib/download';
import { formatDate } from '../lib/utils';
import { useT } from '../i18n';
import { dkT } from '../i18n/areas/desks-r3';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/practice/practice.module.css';

// R14 (PS-D5): "Bill" for a company linked to a client of the firm (CA desk); the board stays read-only.
const PracticeBillLink = lazy(() => import('../components/prof/PracticeBillLink'));

/** The open company's tables, read from the live storage (same shape as a peek). */
function currentTables(): PracticeTables {
  return {
    settings: getJson<unknown>(SINGLETON_KEYS.settings, null),
    compliance: getTable('compliance'),
    tds_returns: getTable('tds_returns'),
    dsc_register: getTable('dsc_register'),
    client_checklist: getTable('client_checklist'),
    checklist_template: checklistDb.template(),
    invoices: getTable('invoices'),
    vouchers: getTable('vouchers'),
    purchases: getTable('purchases'),
  };
}

async function loadBoard(): Promise<PeekedCompany[]> {
  const reg = readRegistry();
  const here = activeCompanyId();
  // QA7 G7: the Demo company is not one of the user's companies (shown only while it is the open one).
  const list = reg.list.filter((c) => !c.demo || c.id === here);
  const out: PeekedCompany[] = [];
  const { peekCompliance } = await import('../lib/company-peek');
  for (const c of list) {
    if (c.id === here) {
      out.push({ id: c.id, name: c.name, current: true, tables: currentTables() });
      continue;
    }
    out.push(peekedCompany(c, await peekCompliance(companyDbName(c.id))));
  }
  return out;
}

/**
 * R3-C6 practice desk (`/practice`, owner only): a read-only board of every company on this device —
 * GSTINs, next due and overdue returns, TDS return marks, last voucher, books lock, drafts, checklist
 * progress and the nearest DSC expiry — plus the open company's DSC register and monthly checklist.
 * Other companies are peeked read-only (never created, upgraded or written); "Open" switches company.
 */
export function Practice() {
  useT();
  const [rows, setRows] = useState<PracticeRow[] | null>(null);
  const [today] = useState(() => todayIso());
  const refresh = useCallback(() => {
    void loadBoard().then((c) => setRows(buildPracticeBoard(c, today))).catch(() => setRows([]));
  }, [today]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const exportCsv = () => rows && downloadText(`practice_board_${today}.csv`, boardCsv(rows), 'text/csv');
  const exportXlsx = async () => {
    if (!rows) return;
    const { downloadXlsx } = await import('../lib/xlsx');
    await downloadXlsx(`practice_board_${today}.xlsx`, [{ name: 'Practice board', rows: boardTable(rows) }]);
  };
  // A registry entry whose database is gone (removed elsewhere): drop it from the list (deleting a
  // database that does not exist creates nothing).
  const forget = (id: string) => {
    void deleteCompany(id).then(refresh).catch(refresh);
  };
  const open = (id: string) => {
    window.history.replaceState(null, '', '/');
    switchCompany(id);
  };

  return (
    <div className={surface.page} data-practice>
      <PageHeader title={dkT('pr.title')} subtitle={dkT('pr.subtitle')} />
      {/* R6-B3: the desk shows every company on the device — with one company, say how to add the next. */}
      {practiceEmpty(realCompanies().length) && (
        <EmptyState
          icon={Building2}
          title={discoverT('practiceTitle')}
          text={discoverT('practiceText')}
          action={
            <div className={surface.pageActions} style={{ justifyContent: 'center' }} data-practice-empty>
              <Link to="/settings?tab=data" className={controls.btnPrimary}>{discoverT('practiceAdd')}</Link>
              <LearnMore topic="practice" />
            </div>
          }
        />
      )}
      <section className={styles.section}>
        <h2 className={styles.head}><Building2 size={16} aria-hidden /> {dkT('pr.board')}</h2>
        <p className={styles.note}>{dkT('pr.caNote')}</p>
        <div className={styles.row}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={refresh}><RefreshCw size={14} /> {dkT('pr.refresh')}</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={exportCsv} disabled={!rows?.length}><Download size={14} /> CSV</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportXlsx()} disabled={!rows?.length}><Download size={14} /> XLSX</button>
        </div>
        {!rows ? (
          <p className={styles.note}>{dkT('reading')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-practice-board>
              <thead>
                <tr>
                  <th scope="col">{dkT('pr.company')}</th>
                  <th scope="col">GSTIN</th>
                  <th scope="col">{dkT('pr.nextDue')}</th>
                  <th scope="col" className={styles.num}>{dkT('pr.overdue')}</th>
                  <th scope="col">{dkT('pr.tds')}</th>
                  <th scope="col">{dkT('pr.lastVoucher')}</th>
                  <th scope="col">{dkT('pr.lock')}</th>
                  <th scope="col" className={styles.num}>{dkT('pr.drafts')}</th>
                  <th scope="col">{dkT('pr.checklist')}</th>
                  <th scope="col">{dkT('pr.dsc')}</th>
                  <th scope="col"><span className={surface.srOnly}>{dkT('pr.open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.current ? styles.current : undefined} data-practice-row={r.id}>
                    <td><strong>{r.name}</strong>{r.current && <div className={styles.note}>{dkT('pr.open1')}</div>}</td>
                    {r.missing ? (
                      <td colSpan={9} className={styles.muted}>{dkT('pr.missing')}</td>
                    ) : r.locked ? (
                      <td colSpan={9} className={styles.muted}><Lock size={13} aria-hidden /> {dkT('pr.locked')}</td>
                    ) : (
                      <>
                        <td>{r.gstins.join(', ') || '-'}<div className={styles.note}>{dkT(`pr.freq.${r.frequency}` as const)}</div></td>
                        <td>{r.nextDue ? <>{r.nextDue.form} {r.nextDue.label}<div className={styles.note}>{formatDate(r.nextDue.due)}</div></> : '-'}</td>
                        <td className={`${styles.num} ${r.overdue ? styles.bad : ''}`} title={r.overdueForms.join('\n')}>{r.overdue}</td>
                        <td>{r.lastTds ?? '-'}<div className={styles.note}>{dkT('pr.tdsFy', { n: r.tdsFiledThisFy })}</div></td>
                        <td>{r.lastVoucher ? formatDate(r.lastVoucher) : '-'}</td>
                        <td>{r.lockUntil ? formatDate(r.lockUntil) : dkT('pr.unlocked')}</td>
                        <td className={styles.num}>{r.drafts}</td>
                        <td>{r.checklist.done}/{r.checklist.total}</td>
                        <td className={r.dsc && r.dsc.days <= 7 ? styles.bad : r.dsc && r.dsc.days <= 30 ? styles.warn : undefined}>
                          {r.dsc ? <>{formatDate(r.dsc.validTo)}<div className={styles.note}>{r.dsc.holder}</div></> : '-'}
                        </td>
                      </>
                    )}
                    <td>
                      {r.missing
                        ? <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => forget(r.id)}>{dkT('pr.forget')}</button>
                        : r.current
                        ? <Link to="/gst-reports?tab=compliance" className={`${controls.btnGhost} ${controls.btnSm}`}>{dkT('pr.markFiled')}</Link>
                        : <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => open(r.id)}>{dkT('pr.open')}</button>}
                      {!r.missing && <Suspense fallback={null}><PracticeBillLink companyId={r.id} /></Suspense>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className={styles.grid} style={{ alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))' }}>
        <DscRegister onChanged={refresh} />
        <ChecklistPanel onChanged={refresh} />
      </div>
      <p className={styles.note}>{dkT('pr.privacy')}</p>
    </div>
  );
}

export default Practice;
