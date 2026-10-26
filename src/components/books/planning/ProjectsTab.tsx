/**
 * Books → Projects (roadmap 6.16): the cost-centre master and the Project P&L — income, direct
 * costs, margin and net result per cost centre for the selected period, plus an Unallocated column,
 * reconciling to the overall P&L.
 */
import { Fragment, lazy, Suspense, useMemo, useState } from 'react';
import { FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  costCentrePnl,
  costCentrePnlCsv,
  costCentrePnlRows,
  ledgerProfitAndLoss,
  marginPercent,
  type CcSection,
  type CcTotals,
  type Ledger,
} from '../../../lib/ledger';
import {
  COST_CENTRE_KINDS,
  COST_CENTRE_KIND_LABELS,
  deleteCostCentre,
  loadCostCentres,
  saveCostCentre,
  sortCostCentres,
  type CostCentre,
  type CostCentreKind,
} from '../../../lib/cost-centres';
import { localDb } from '../../../lib/localDb';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { EmptyState } from '../../ui/EmptyState';
import { Modal } from '../../ui/Modal';
import { money } from '../ledger/format';
import { PrintTitle, StatementToolbar } from '../ledger/shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './planning.module.css';
import { useT } from '../../../i18n';
import { planT } from '../../../i18n/areas/books-planning';
import { peekTable } from '../../../lib/storage';

// R4-A2: memo row "materials used (stock, not posted)" from production orders tagged with a cost centre (lazy).
const ProjectMaterialsRow = lazy(() => import('../../production/ProjectMaterialsRow'));
// R5-B6: memo row "material consumed at works sites" from stock journals tagged with a cost centre (lazy).
const SiteMaterialsRow = lazy(() => import('../../works/SiteMaterialsRow'));

const SECTION_KEY = { income: 'secIncome', direct: 'secDirect', indirect: 'secIndirect' } as const;
const KIND_KEY = { project: 'kindProject', department: 'kindDepartment', branch: 'kindBranch' } as const;
// R5-B / R5-C kinds (vehicle, fund) show the master's English label until this area names them.
const kindLabel = (k: CostCentreKind) => (k in KIND_KEY ? planT(KIND_KEY[k as keyof typeof KIND_KEY]) : COST_CENTRE_KIND_LABELS[k]);
/** Engine column labels: centre names pass through; the two fixed columns are translated. */
const columnLabel = (label: string) => (label === 'Unallocated' ? planT('unallocated') : label === 'Deleted cost centre' ? planT('deletedCc') : label);

interface Props {
  ledger: Ledger;
  period: Period;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const SECTIONS: CcSection[] = ['income', 'direct', 'indirect'];

const signed = (paise: number) => (paise < 0 ? `(${money(-paise)})` : money(paise));

export function ProjectsTab({ ledger, period, notify }: Props) {
  useT();
  const [version, setVersion] = useState(0);
  const centres = useMemo(() => {
    void version;
    return loadCostCentres();
  }, [version]);
  const [editing, setEditing] = useState<CostCentre | 'new' | null>(null);
  const [rollUp, setRollUp] = useState(false);
  const pnl = useMemo(() => costCentrePnl(ledger, period, centres, { rollUp }), [ledger, period, centres, rollUp]);
  const overall = useMemo(() => ledgerProfitAndLoss(ledger, period), [ledger, period]);
  const reconciles = pnl.grand.netProfit === overall.netProfit && pnl.grand.income === overall.totalIncome;
  const hasGroups = centres.some((c) => c.parent_id);
  const clients = useMemo(() => localDb.clients.getAll(), []);

  const remove = (c: CostCentre) => {
    try {
      deleteCostCentre(c.id);
      setVersion((v) => v + 1);
      notify(planT('deletedName', { name: c.name }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const fileBase = `project-pnl-${period.start}_to_${period.end}`;
  const exportXlsx = async () => {
    const { downloadXlsx } = await import('../../../lib/xlsx');
    await downloadXlsx(`${fileBase}.xlsx`, [{ name: 'Project P&L', rows: costCentrePnlRows(pnl) }]);
  };

  const totalsRow = (label: string, pick: (t: CcTotals) => number, strong = false) => (
    <tr className={strong ? books.totalRow : undefined}>
      <td className={styles.sticky}>{label}</td>
      {pnl.columns.map((c) => {
        const v = pick(pnl.totals[c.key]);
        return <td key={c.key} className={`${surface.numeric} ${strong ? (v > 0 ? books.pos : v < 0 ? books.neg : '') : ''}`}>{signed(v)}</td>;
      })}
      <td className={`${surface.numeric} ${strong ? (pick(pnl.grand) > 0 ? books.pos : pick(pnl.grand) < 0 ? books.neg : '') : ''}`}>{signed(pick(pnl.grand))}</td>
    </tr>
  );

  return (
    <div className={books.stack}>
      <section className={`${surface.card} no-print`}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}><FolderKanban size={16} aria-hidden="true" /> {planT('ccHead')}</span>
          <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
            <Plus size={16} /> {planT('addCc')}
          </button>
        </div>
        {centres.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={planT('noCcTitle')}
            text={planT('noCcText')}
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{planT('ccCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{planT('colName')}</th>
                  <th scope="col">{planT('colKind')}</th>
                  <th scope="col">{planT('colClient')}</th>
                  <th scope="col">{planT('colStatus')}</th>
                  <th scope="col"><span className={surface.srOnly}>{planT('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {sortCostCentres(centres).map((c) => (
                  <tr key={c.id}>
                    <td className={c.parent_id ? styles.child : undefined}>{c.parent_id ? '↳ ' : ''}{c.name}</td>
                    <td>{kindLabel(c.kind)}</td>
                    <td>{clients.find((x) => x.id === c.client_id)?.name ?? '—'}</td>
                    <td className={c.active ? undefined : styles.inactive}>{c.active ? planT('active') : planT('inactive')}</td>
                    <td>
                      <div className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} onClick={() => setEditing(c)} aria-label={planT('editName', { name: c.name })}><Pencil size={16} /></button>
                        <button type="button" className={controls.btnDanger} onClick={() => remove(c)} aria-label={planT('deleteName', { name: c.name })}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {centres.length > 0 && (
        <>
          <StatementToolbar csv={() => costCentrePnlCsv(pnl)} xlsx={() => void exportXlsx()} filename={`${fileBase}.csv`}>
            <span className={reconciles ? books.pos : books.neg}>{reconciles ? planT('ties') : planT('notTies')}</span>
            {hasGroups && (
              <label className={controls.check}>
                <input type="checkbox" checked={rollUp} onChange={(e) => setRollUp(e.target.checked)} />
                {planT('groupUnderParent')}
              </label>
            )}
          </StatementToolbar>
          <PrintTitle title={planT('projectPnl')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
          <section className={surface.card} aria-label={planT('projectPnl')}>
            <div className={surface.cardHead}>{planT('projectPnlHead', { start: formatDate(period.start), end: formatDate(period.end) })}</div>
            {pnl.rows.length === 0 ? (
              <EmptyState icon={FolderKanban} title={planT('nothingPosted')} text={planT('nothingPostedText')} />
            ) : (
              <div className={surface.tableWrap}>
                <table className={surface.table} data-testid="project-pnl">
                  <caption className={surface.srOnly}>{planT('pnlCaption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.sticky}>{planT('colAccount')}</th>
                      {pnl.columns.map((c) => (
                        <th key={c.key} scope="col" className={`${surface.numeric} ${styles.nowrap}`}>{columnLabel(c.label)}</th>
                      ))}
                      <th scope="col" className={surface.numeric}>{planT('total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTIONS.map((sec) => {
                      const rows = pnl.rows.filter((r) => r.section === sec);
                      if (!rows.length) return null;
                      return (
                        <Fragment key={sec}>
                          <tr>
                            <th scope="rowgroup" colSpan={pnl.columns.length + 2} className={styles.sticky}>{planT(SECTION_KEY[sec])}</th>
                          </tr>
                          {rows.map((r) => (
                            <tr key={r.account.id}>
                              <td className={styles.sticky}>{r.account.code} · {r.account.name}</td>
                              {pnl.columns.map((c) => (
                                <td key={c.key} className={surface.numeric}>{r.amounts[c.key] ? signed(r.amounts[c.key]) : '—'}</td>
                              ))}
                              <td className={surface.numeric}>{signed(r.total)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                    {totalsRow(planT('secIncome'), (t) => t.income)}
                    {totalsRow(planT('secDirect'), (t) => t.directCosts)}
                    {totalsRow(planT('margin'), (t) => t.margin, true)}
                    <tr>
                      <td className={styles.sticky}>{planT('marginPct')}</td>
                      {pnl.columns.map((c) => {
                        const m = marginPercent(pnl.totals[c.key]);
                        return <td key={c.key} className={surface.numeric}>{m === null ? '—' : `${m}%`}</td>;
                      })}
                      <td className={surface.numeric}>{marginPercent(pnl.grand) === null ? '—' : `${marginPercent(pnl.grand)}%`}</td>
                    </tr>
                    {totalsRow(planT('secIndirect'), (t) => t.indirectExpenses)}
                    {totalsRow(planT('netProfitLoss'), (t) => t.netProfit, true)}
                    {peekTable<{ cost_centre_id?: string }>('production_orders').some((o) => o?.cost_centre_id) && (
                      <Suspense fallback={null}><ProjectMaterialsRow columns={pnl.columns} period={period} cellClass={styles.sticky} /></Suspense>
                    )}
                    {peekTable<{ cost_centre_id?: string }>('stock_journals').some((j) => j?.cost_centre_id) && (
                      <Suspense fallback={null}><SiteMaterialsRow columns={pnl.columns} period={period} cellClass={styles.sticky} /></Suspense>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className={books.muted}>
            {planT('projectNote')}
          </p>
        </>
      )}

      {editing && (
        <CostCentreForm
          centre={editing === 'new' ? null : editing}
          centres={centres}
          clients={clients.filter((c) => c.id && c.name?.trim()).map((c) => ({ id: c.id!, name: c.name }))}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            setVersion((v) => v + 1);
            notify(planT('savedName', { name: c.name }));
          }}
        />
      )}
    </div>
  );
}

function CostCentreForm({ centre, centres, clients, onClose, onSaved }: {
  centre: CostCentre | null;
  centres: CostCentre[];
  clients: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (c: CostCentre) => void;
}) {
  useT();
  const [name, setName] = useState(centre?.name ?? '');
  const [kind, setKind] = useState<CostCentreKind>(centre?.kind ?? 'project');
  const [parent, setParent] = useState(centre?.parent_id ?? '');
  const [client, setClient] = useState(centre?.client_id ?? '');
  const [active, setActive] = useState(centre?.active ?? true);
  const [notes, setNotes] = useState(centre?.notes ?? '');
  const [error, setError] = useState('');
  const parents = centres.filter((c) => !c.parent_id && c.id !== centre?.id);

  const save = () => {
    try {
      onSaved(saveCostCentre({ id: centre?.id, name, kind, parent_id: parent || undefined, client_id: client || undefined, active, notes }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={centre ? planT('editName', { name: centre.name }) : planT('newCc')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{planT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{planT('save')}</button>
        </>
      }
    >
      <form className={styles.formStack} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-name">{planT('colName')}</label>
            <input id="cc-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={planT('ccNamePh')} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-kind">{planT('colKind')}</label>
            <select id="cc-kind" className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as CostCentreKind)}>
              {COST_CENTRE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-parent">{planT('groupUnder')}</label>
            <select id="cc-parent" className={controls.select} value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{planT('topLevel')}</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-client">{planT('clientOptional')}</label>
            <select id="cc-client" className={controls.select} value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">{planT('none')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <label className={controls.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {planT('activeHint')}
        </label>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cc-notes">{planT('notes')}</label>
          <textarea id="cc-notes" className={controls.textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
