/**
 * Project budget warnings in the notification bell (R3-B2): hours tracked at 80% / 100% of a project's
 * hours budget (and the same for its fee budget). Loaded lazily by the bell only once `project_tasks`
 * has rows (`ensureProjectAlerts` in NotificationBell.tsx).
 */
import type { AppNotification } from './notifications';
import { registerNotificationProvider } from './notifications';
import { loadCostCentres } from './cost-centres';
import { loadTasks, projectBurn, type BudgetLevel } from './projects';
import { liveInvoiceIds, readTimePrefs, timeDb } from './timesheets';
import { localDayOf } from './dates';
import type { CostCentre } from './cost-centres';
import type { ProjectBurn } from './projects';

let unregister: (() => void) | null = null;

/** Pure: the notices for one project's burn (stable ids per project × level). */
export function projectNotices(p: Pick<CostCentre, 'id' | 'name'>, burn: ProjectBurn, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const note = (kind: 'hours' | 'fee', level: BudgetLevel, pct: number | null) => {
    if (!level || pct === null) return;
    out.push({
      id: `project-${kind}:${p.id}:${level}`,
      severity: level === 100 ? 'critical' : 'warning',
      title: level === 100 ? `${p.name}: ${kind === 'hours' ? 'hours' : 'fee'} budget used up` : `${p.name}: ${Math.floor(pct)}% of the ${kind === 'hours' ? 'hours' : 'fee'} budget used`,
      detail: kind === 'hours'
        ? `${Math.round(burn.tracked_minutes / 6) / 10} h tracked of ${Math.round(burn.budget_minutes / 6) / 10} h budgeted.`
        : `Billed + unbilled time is ${Math.floor(pct)}% of the fee budget.`,
      href: `/time?tab=projects&project=${encodeURIComponent(p.id)}`,
      cta: 'Open project',
      at,
    });
  };
  note('hours', burn.level, burn.pct);
  note('fee', burn.fee_level, burn.fee_pct);
  return out;
}

export function registerProjectAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const projects = loadCostCentres().filter((c) => c.kind === 'project' && c.active && c.status !== 'done' && (c.budget_minutes || c.fee_budget));
    if (!projects.length) return [];
    const entries = timeDb.all();
    const tasks = loadTasks();
    const prefs = readTimePrefs();
    const live = liveInvoiceIds(ctx.invoices);
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    return projects.flatMap((p) => projectNotices(p, projectBurn(p, entries, tasks, prefs, live, today), at));
  });
}
