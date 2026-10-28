import { Suspense, lazy, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FolderKanban, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { loadCostCentres } from '../../lib/cost-centres';
import {
  INVOICED, columnTasks, deleteTask, displayColumn, loadProjectSettings, loadTasks, moveTask, moveTaskBy, projectBurn, renameColumn,
  saveProjectSettings, saveTask, saveTasks, taskProgress, tasksToRows, type ProjectSettings, type ProjectTask,
} from '../../lib/projects';
import { formatMinutes, liveInvoiceIds } from '../../lib/timesheets';
import { listUsers } from '../../lib/auth';
import { can } from '../../lib/access';
import { downloadText, toCsv } from '../../lib/download';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Bar, ProjectForm, ProjectHeader } from './ProjectHeader';
import { draftOf, saveProjectDraft, type ProjectDraft } from './project-draft';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
// R14 (PS-A): professional rows, only while the `practice` pack is on (one small lazy chunk).
const MatterLink = lazy(() => import('../prof/ProfRows').then((m) => ({ default: m.MatterLink })));

type Notify = (message: string, tone?: 'success' | 'error') => void;

interface Props {
  clients: Client[];
  prefs: TimePrefs;
  entries: TimeEntry[];
  invoices: InvoiceRecord[];
  projectId?: string;
  onSelect: (id: string | null) => void;
  onBill: (target: { key: string; name: string; projectId: string }) => void;
  notify: Notify;
  onChanged: () => void;
}

interface TaskDraft {
  id?: string;
  title: string;
  column: string;
  estimate: string;
  assignee_id: string;
  rate: string;
  due: string;
}

/** R3-B2: projects with an hours budget, tasks on a board / list, estimate vs actual. */
export default function ProjectsBoard({ clients, prefs, entries, invoices, projectId, onSelect, onBill, notify, onChanged }: Props) {
  useT();
  const editable = can('books.edit');
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const centres = useMemo(() => loadCostCentres(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => loadTasks(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const settings = useMemo<ProjectSettings>(() => loadProjectSettings(), [version]);
  const live = useMemo(() => liveInvoiceIds(invoices), [invoices]);
  const people = useMemo(() => listUsers(), []);
  const projects = useMemo(() => centres.filter((c) => c.kind === 'project' && (c.active || c.id === projectId)).sort((a, b) => a.name.localeCompare(b.name)), [centres, projectId]);
  const project = projects.find((p) => p.id === projectId) ?? (projectId ? undefined : projects[0]);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [editProject, setEditProject] = useState<ProjectDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const focusId = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const run = (fn: () => void, ok?: string) => {
    try {
      fn();
      if (ok) notify(ok);
      refresh();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  // Keep keyboard focus on a card after Alt+← / Alt+→ re-renders the board.
  useEffect(() => {
    if (!focusId.current) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${focusId.current}"]`)?.focus();
    focusId.current = null;
  });

  const columns = settings.columns;
  const mine = project ? tasks.filter((t) => t.cost_centre_id === project.id) : [];
  const shown = (col: string) => {
    if (!project) return [];
    if (col === INVOICED) return mine.filter((t) => displayColumn(t, entries, live) === INVOICED).sort((a, b) => a.sort - b.sort);
    return columnTasks(tasks, project.id, col).filter((t) => displayColumn(t, entries, live) !== INVOICED);
  };
  const colLabel = (c: string) => (c === INVOICED ? svcT('invoicedCol') : c);
  const personName = (id?: string) => (id ? people.find((u) => u.id === id)?.name ?? '' : '');

  const saveProject = () => {
    if (!editProject) return;
    run(() => {
      const prev = editProject.id ? centres.find((c) => c.id === editProject.id) : undefined;
      const row = saveProjectDraft(editProject, prev);
      setEditProject(null);
      onSelect(row.id);
    }, svcT('projectSaved'));
  };

  const saveTaskDraft = () => {
    if (!taskDraft || !project) return;
    run(() => {
      const est = Number(taskDraft.estimate) || 0;
      saveTask({
        ...(taskDraft.id ? tasks.find((t) => t.id === taskDraft.id) : {}),
        id: taskDraft.id,
        cost_centre_id: project.id,
        title: taskDraft.title,
        column: taskDraft.column,
        estimate_minutes: Math.round(est * 60),
        assignee_id: taskDraft.assignee_id || undefined,
        rate: Number(taskDraft.rate) > 0 ? Number(taskDraft.rate) : undefined,
        due: taskDraft.due || undefined,
      });
      setTaskDraft(null);
    }, svcT('taskSaved'));
  };

  const move = (next: ProjectTask[] | null, id: string) => {
    if (!next) return;
    focusId.current = id;
    run(() => saveTasks(next));
  };

  const onCardKey = (e: KeyboardEvent<HTMLElement>, t: ProjectTask) => {
    if (!editable || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    move(moveTaskBy(tasks, t.id, e.key === 'ArrowLeft' ? -1 : 1, columns), t.id);
  };

  const onDrop = (e: DragEvent, col: string, index?: number) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id || col === INVOICED || !editable) return;
    move(moveTask(tasks, id, col, index ?? columnTasks(tasks, project!.id, col).length), id);
  };

  const exportTasks = async (format: 'csv' | 'xlsx') => {
    const rows = tasksToRows(project ? mine : tasks, centres, entries, prefs, live, colLabel);
    const base = `tasks-${todayInput()}`;
    if (format === 'csv') return downloadText(`${base}.csv`, '﻿' + toCsv(rows), 'text/csv');
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`${base}.xlsx`, [{ name: 'Tasks', rows }]);
  };

  const addColumn = () => {
    const name = newColumn.trim();
    if (!name || columns.includes(name)) return;
    run(() => saveProjectSettings({ columns: [...columns, name] }));
    setNewColumn('');
  };
  const rename = (from: string) => {
    const to = window.prompt(svcT('renameColumn'), from);
    if (!to) return;
    const r = renameColumn(settings, tasks, from, to);
    run(() => {
      saveProjectSettings(r.settings);
      saveTasks(r.tasks);
    });
  };

  const client = project?.client_id ? clients.find((c) => c.id === project.client_id) : undefined;

  const card = (t: ProjectTask, col: string, index: number) => {
    const p = taskProgress(t, entries);
    const at = columns.indexOf(t.column);
    return (
      <article
        key={t.id}
        className={styles.card}
        tabIndex={0}
        data-task-id={t.id}
        draggable={editable && col !== INVOICED}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
        onDragOver={(e) => { if (col !== INVOICED) e.preventDefault(); }}
        onDrop={(e) => { e.stopPropagation(); onDrop(e, col, index); }}
        onKeyDown={(e) => onCardKey(e, t)}
        aria-label={t.title}
      >
        <span className={styles.cardTitle}>{t.title}</span>
        <div className={styles.cardMeta}>
          <span>{svcT('trackedVsEstimate', { tracked: formatMinutes(p.tracked), estimate: p.estimate ? formatMinutes(p.estimate) : '–' })}</span>
          {t.due && <span>{formatDate(t.due)}</span>}
        </div>
        <Bar pct={p.pct} />
        <div className={styles.cardMeta}>
          <span>{personName(t.assignee_id)}{t.rate ? ` · ₹${t.rate}/h` : ''}</span>
          {editable && (
            <span className={styles.row}>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} disabled={at <= 0} aria-label={svcT('moveLeft')} onClick={() => move(moveTaskBy(tasks, t.id, -1, columns), t.id)}><ChevronLeft size={14} /></button>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} disabled={at >= columns.length - 1} aria-label={svcT('moveRight')} onClick={() => move(moveTaskBy(tasks, t.id, 1, columns), t.id)}><ChevronRight size={14} /></button>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={`${svcT('edit')} ${t.title}`}
                onClick={() => setTaskDraft({ id: t.id, title: t.title, column: t.column, estimate: t.estimate_minutes ? String(Math.round((t.estimate_minutes / 60) * 100) / 100) : '', assignee_id: t.assignee_id ?? '', rate: t.rate ? String(t.rate) : '', due: t.due ?? '' })}>
                <Pencil size={14} />
              </button>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={`${svcT('delete')} ${t.title}`} onClick={() => run(() => deleteTask(t.id), svcT('taskDeleted'))}><Trash2 size={14} /></button>
            </span>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className={surface.card} data-projects>
      <div className={styles.section}>
        <div className={styles.spread}>
          <div className={styles.row}>
            {projects.length > 0 && (
              <select className={controls.select} value={project?.id ?? ''} onChange={(e) => onSelect(e.target.value || null)} aria-label={svcT('pickProject')} data-project-select>
                {projects.map((p) => {
                  const b = projectBurn(p, entries, tasks, prefs, live, todayInput());
                  return <option key={p.id} value={p.id}>{p.name}{b.pct !== null ? ` · ${Math.floor(b.pct)}%` : ''}</option>;
                })}
              </select>
            )}
            {editable && (
              <button type="button" className={controls.btnOutline} onClick={() => setEditProject(draftOf())} data-new-project>
                <Plus size={16} /> {svcT('newProject')}
              </button>
            )}
            {project && editable && (
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setEditProject(draftOf(project))}><Pencil size={14} /> {svcT('edit')}</button>
            )}
          </div>
          {project && (
            <div className={styles.row}>
              <div className={controls.segment} role="tablist" aria-label={svcT('board')}>
                <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('board')}>{svcT('board')}</button>
                <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('list')}>{svcT('list')}</button>
              </div>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportTasks('csv')}><Download size={14} /> CSV</button>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportTasks('xlsx')}><FileSpreadsheet size={14} /> Excel</button>
              <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} disabled={!client} title={client ? undefined : svcT('billNeedsClient')}
                onClick={() => client?.id && onBill({ key: client.id, name: client.name, projectId: project.id })} data-bill-project>
                <ReceiptText size={14} /> {svcT('billProject')}
              </button>
            </div>
          )}
        </div>
        <p className={styles.muted}>{svcT('projectsIntro')}</p>
      </div>

      {!project ? (
        <EmptyState icon={FolderKanban} title={svcT('noProjects')} text={svcT('noProjectsText')} />
      ) : (
        <>
          <ProjectHeader project={project} entries={entries} tasks={tasks} prefs={prefs} live={live} />
          <div className={styles.section}>
            <div className={styles.spread}>
              <p className={styles.muted}>{svcT('boardKeys')}</p>
              {editable && (
                <button type="button" className={controls.btnOutline} onClick={() => setTaskDraft({ title: '', column: columns[0], estimate: '', assignee_id: '', rate: '', due: '' })} data-add-task>
                  <Plus size={16} /> {svcT('addTask')}
                </button>
              )}
            </div>
            {view === 'board' ? (
              <div className={styles.board} ref={boardRef} data-board>
                {[...columns, INVOICED].map((col) => {
                  const list = shown(col);
                  return (
                    <div key={col} className={cn(styles.column, dragOver === col && styles.columnOver)} data-column={col}
                      onDragOver={(e) => { if (col !== INVOICED && editable) { e.preventDefault(); setDragOver(col); } }}
                      onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
                      onDrop={(e) => onDrop(e, col)}>
                      <div className={styles.columnHead}>
                        <span>{colLabel(col)} · {list.length}</span>
                        {col !== INVOICED && editable && (
                          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={`${svcT('renameColumn')} ${col}`} onClick={() => rename(col)}><Pencil size={12} /></button>
                        )}
                      </div>
                      {col === INVOICED && <span className={styles.muted}>{svcT('invoicedHint')}</span>}
                      {list.length ? list.map((t, i) => card(t, col, i)) : <span className={styles.muted}>{svcT('noTasks')}</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <thead><tr><th>{svcT('task')}</th><th>{svcT('columns')}</th><th className={surface.numeric}>{svcT('estimate')}</th><th className={surface.numeric}>{svcT('tracked')}</th><th>{svcT('due')}</th><th>{svcT('assignee')}</th></tr></thead>
                  <tbody>
                    {mine.sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column) || a.sort - b.sort).map((t) => {
                      const p = taskProgress(t, entries);
                      return (
                        <tr key={t.id}>
                          <td>{t.title}</td>
                          <td>{colLabel(displayColumn(t, entries, live))}</td>
                          <td className={surface.numeric}>{p.estimate ? formatMinutes(p.estimate) : '–'}</td>
                          <td className={surface.numeric}>{formatMinutes(p.tracked)}{p.pct !== null ? ` · ${Math.round(p.pct)}%` : ''}</td>
                          <td>{t.due ? formatDate(t.due) : '–'}</td>
                          <td>{personName(t.assignee_id) || '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {editable && view === 'board' && (
              <form className={styles.row} onSubmit={(e) => { e.preventDefault(); addColumn(); }}>
                <input className={controls.input} value={newColumn} onChange={(e) => setNewColumn(e.target.value)} placeholder={svcT('columnName')} aria-label={svcT('columnName')} />
                <button type="submit" className={cn(controls.btnOutline, controls.btnSm)} disabled={!newColumn.trim()}><Plus size={14} /> {svcT('addColumn')}</button>
              </form>
            )}
          </div>
        </>
      )}

      <Modal open={!!editProject} onClose={() => setEditProject(null)} size="lg" title={editProject?.id ? svcT('edit') : svcT('newProject')}>
        {editProject && (
          <form className={styles.section} onSubmit={(e) => { e.preventDefault(); saveProject(); }}>
            <ProjectForm value={editProject} clients={clients} onChange={setEditProject} />
            {isPackOn(localDb.settings.get(), 'practice') && <Suspense fallback={null}><MatterLink code={loadCostCentres().find((c) => c.id === editProject.id)?.ps?.code} /></Suspense>}
            <div className={styles.row}>
              <button type="button" className={controls.btnOutline} onClick={() => setEditProject(null)}>{svcT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary} disabled={!editProject.name.trim()} data-save-project>{svcT('save')}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!taskDraft} onClose={() => setTaskDraft(null)} size="md" title={taskDraft?.id ? svcT('edit') : svcT('addTask')}>
        {taskDraft && (
          <form className={styles.section} onSubmit={(e) => { e.preventDefault(); saveTaskDraft(); }}>
            <div className={styles.form}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-title">{svcT('taskTitle')}</label>
                <input id="tk-title" className={controls.input} value={taskDraft.title} onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })} autoFocus />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-col">{svcT('columns')}</label>
                <select id="tk-col" className={controls.select} value={taskDraft.column} onChange={(e) => setTaskDraft({ ...taskDraft, column: e.target.value })}>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-est">{svcT('estimateHours')}</label>
                <input id="tk-est" type="number" min={0} step="0.25" className={controls.input} value={taskDraft.estimate} onChange={(e) => setTaskDraft({ ...taskDraft, estimate: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-who">{svcT('assignee')}</label>
                <select id="tk-who" className={controls.select} value={taskDraft.assignee_id} onChange={(e) => setTaskDraft({ ...taskDraft, assignee_id: e.target.value })}>
                  <option value="">{svcT('nobody')}</option>
                  {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-rate">{svcT('taskRate')}</label>
                <input id="tk-rate" type="number" min={0} step="0.01" className={controls.input} value={taskDraft.rate} onChange={(e) => setTaskDraft({ ...taskDraft, rate: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="tk-due">{svcT('due')}</label>
                <input id="tk-due" type="date" className={controls.input} value={taskDraft.due} onChange={(e) => setTaskDraft({ ...taskDraft, due: e.target.value })} />
              </div>
            </div>
            <div className={styles.row}>
              <button type="button" className={controls.btnOutline} onClick={() => setTaskDraft(null)}>{svcT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary} disabled={!taskDraft.title.trim()} data-save-task>{svcT('save')}</button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
