/**
 * Books → Projects (roadmap 6.16): the cost-centre master and the Project P&L — income, direct
 * costs, margin and net result per cost centre for the selected period, plus an Unallocated column,
 * reconciling to the overall P&L.
 */
import { Fragment, useMemo, useState } from 'react';
import { FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  CC_SECTION_LABELS,
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

interface Props {
  ledger: Ledger;
  period: Period;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const SECTIONS: CcSection[] = ['income', 'direct', 'indirect'];

const signed = (paise: number) => (paise < 0 ? `(${money(-paise)})` : money(paise));

export function ProjectsTab({ ledger, period, notify }: Props) {
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
      notify(`Deleted ${c.name}`);
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
          <span className={surface.cardHeadIcon}><FolderKanban size={16} aria-hidden="true" /> Cost centres &amp; projects</span>
          <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
            <Plus size={16} /> Add cost centre
          </button>
        </div>
        {centres.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No cost centres yet"
            text="Add a project, department or branch. A picker then appears on invoices, bills, expenses, vouchers and time entries, and this tab shows a P&L per cost centre."
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Cost centres</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className={surface.srOnly}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sortCostCentres(centres).map((c) => (
                  <tr key={c.id}>
                    <td className={c.parent_id ? styles.child : undefined}>{c.parent_id ? '↳ ' : ''}{c.name}</td>
                    <td>{COST_CENTRE_KIND_LABELS[c.kind]}</td>
                    <td>{clients.find((x) => x.id === c.client_id)?.name ?? '—'}</td>
                    <td className={c.active ? undefined : styles.inactive}>{c.active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <div className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil size={16} /></button>
                        <button type="button" className={controls.btnDanger} onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><Trash2 size={16} /></button>
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
            <span className={reconciles ? books.pos : books.neg}>{reconciles ? 'Ties to the P&L' : 'Does not tie to the P&L — check the Vouchers warnings'}</span>
            {hasGroups && (
              <label className={controls.check}>
                <input type="checkbox" checked={rollUp} onChange={(e) => setRollUp(e.target.checked)} />
                Group under parent
              </label>
            )}
          </StatementToolbar>
          <PrintTitle title="Project P&L" sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
          <section className={surface.card} aria-label="Project P&L">
            <div className={surface.cardHead}>Project P&amp;L · {formatDate(period.start)} – {formatDate(period.end)}</div>
            {pnl.rows.length === 0 ? (
              <EmptyState icon={FolderKanban} title="Nothing posted in this period" text="Tag invoices, bills or expenses with a cost centre, or widen the period." />
            ) : (
              <div className={surface.tableWrap}>
                <table className={surface.table} data-testid="project-pnl">
                  <caption className={surface.srOnly}>Income, direct costs and margin per cost centre</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.sticky}>Account</th>
                      {pnl.columns.map((c) => (
                        <th key={c.key} scope="col" className={`${surface.numeric} ${styles.nowrap}`}>{c.label}</th>
                      ))}
                      <th scope="col" className={surface.numeric}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTIONS.map((sec) => {
                      const rows = pnl.rows.filter((r) => r.section === sec);
                      if (!rows.length) return null;
                      return (
                        <Fragment key={sec}>
                          <tr>
                            <th scope="rowgroup" colSpan={pnl.columns.length + 2} className={styles.sticky}>{CC_SECTION_LABELS[sec]}</th>
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
                    {totalsRow('Income', (t) => t.income)}
                    {totalsRow('Direct costs', (t) => t.directCosts)}
                    {totalsRow('Margin', (t) => t.margin, true)}
                    <tr>
                      <td className={styles.sticky}>Margin %</td>
                      {pnl.columns.map((c) => {
                        const m = marginPercent(pnl.totals[c.key]);
                        return <td key={c.key} className={surface.numeric}>{m === null ? '—' : `${m}%`}</td>;
                      })}
                      <td className={surface.numeric}>{marginPercent(pnl.grand) === null ? '—' : `${marginPercent(pnl.grand)}%`}</td>
                    </tr>
                    {totalsRow('Indirect expenses', (t) => t.indirectExpenses)}
                    {totalsRow('Net profit / (loss)', (t) => t.netProfit, true)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className={books.muted}>
            Income and costs follow the cost centre on each invoice line, bill, expense and voucher line; anything untagged (and
            depreciation) is Unallocated, so the columns add up to the Profit &amp; loss for the same period.
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
            notify(`${c.name} saved`);
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
      title={centre ? `Edit ${centre.name}` : 'New cost centre'}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>Save</button>
        </>
      }
    >
      <form className={styles.formStack} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-name">Name</label>
            <input id="cc-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Website revamp" />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-kind">Kind</label>
            <select id="cc-kind" className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as CostCentreKind)}>
              {COST_CENTRE_KINDS.map((k) => <option key={k} value={k}>{COST_CENTRE_KIND_LABELS[k]}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-parent">Group under (optional)</label>
            <select id="cc-parent" className={controls.select} value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— Top level —</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="cc-client">Client (optional)</label>
            <select id="cc-client" className={controls.select} value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">— None —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <label className={controls.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (inactive cost centres are hidden from pickers but stay in reports)
        </label>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cc-notes">Notes</label>
          <textarea id="cc-notes" className={controls.textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
