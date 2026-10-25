import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Circle,
  FilePlus2,
  FileText,
  Hourglass,
  Receipt,
  Users,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { RemindersPanel } from '../components/share';
import { localDb } from '../lib/localDb';
import { shouldShowWizard } from '../lib/onboarding';
import { getTable } from '../lib/storage';
import { pendingReminders, type ReminderRecord } from '../lib/reminders';
import type { CreditLink } from '../lib/stats';
import { getCurrentUser, getUser } from '../lib/auth';
import { useCan } from '../hooks/useCan';
import { getIndianFY } from '../lib/invoice-number';
import { effectiveStatus } from '../lib/invoice-status';
import { attentionList, compactInr, foreignWithoutRate, isRevenueDoc, monthlyBilled, summarize } from '../lib/stats';
import { daysOverdue, formatCurrency, formatDate } from '../lib/utils';
import { dateLocale, useT, type MessageKey } from '../i18n';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Dashboard.module.css';
import { receivableBalance } from '../lib/rcm';

function greeting(hour: number): MessageKey {
  if (hour < 12) return 'dash.morning';
  if (hour < 17) return 'dash.afternoon';
  return 'dash.evening';
}

// Pulls in the whole sample-data builder, so it loads after first paint.
const SetupWizard = lazy(() => import('../components/onboarding/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const DemoNotice = lazy(() => import('../components/demo').then((m) => ({ default: m.DemoNotice })));

/** "2026-10" → "Oct" / "अक्टू॰" in the interface language (5.4). */
function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(dateLocale(), { month: 'short' });
}

export function Dashboard() {
  const { t } = useT();
  const user = getCurrentUser() ?? getUser();
  const navigate = useNavigate();
  // Local roles (6.21): set-up and creation prompts only for roles that may act on them.
  const { can } = useCan();
  // Brand-new account: walk through the essentials once (existing users never see it).
  const [wizardOpen, setWizardOpen] = useState(
    () => can('settings.manage') && shouldShowWizard(localDb.settings.get(), localDb.invoices.getAll().length),
  );
  const [{ invoices, clientCount, profileReady, links }] = useState(() => {
    const settings = localDb.settings.get();
    const profile = localDb.settings.activeProfile();
    return {
      invoices: localDb.invoices.getAll(),
      clientCount: localDb.clients.getAll().length,
      links: getTable<CreditLink>('doc_links'),
      profileReady:
        settings.onboarded && Boolean(profile?.companyName?.trim()) && Boolean(profile?.upiId || profile?.accountNumber),
    };
  });

  // Profit and stock live in larger modules; load them after first paint so the dashboard opens fast.
  const [extras, setExtras] = useState<{ lowStock: number; profit: { netProfit: number; income: number; expenses: number } } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([import('../lib/books'), import('../lib/inventory')])
      .then(([books, inventory]) => {
        if (alive) setExtras({ lowStock: inventory.lowStockCount(), profit: books.getProfitSnapshot('this_fy', 'accrual') });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const lowStock = extras?.lowStock ?? 0;
  const profit = extras?.profit;

  // Derived values are cheap at this scale; recomputing keeps them honest after edits elsewhere.
  const now = new Date();
  const fy = getIndianFY();
  const summary = summarize(invoices, now, links, 'INR');
  const months = monthlyBilled(invoices, 6, now, 'INR');
  // Foreign-currency documents count in rupees at their exchange rate; without a rate they are left out.
  const noRate = foreignWithoutRate(invoices);
  // The reminders panel already lists invoices that deserve a nudge today; don't repeat them here.
  const chasing = new Set(pendingReminders(invoices, now, getTable<ReminderRecord>('reminders')).map((p) => p.invoice.id));
  const attention = attentionList(invoices, 50, now)
    .filter((inv) => !chasing.has(inv.id))
    .slice(0, 5);
  const recent = [...invoices]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 6);
  const peak = Math.max(...months.map((m) => m.billed), 1);
  const collectedPct = summary.billed > 0 ? Math.round((summary.received / summary.billed) * 100) : 0;
  const hasData = invoices.some(isRevenueDoc);

  const checklist = [
    { done: profileReady, label: t('dash.stepProfile'), to: '/settings' },
    { done: clientCount > 0, label: t('dash.stepClient'), to: '/clients' },
    { done: invoices.length > 0, label: t('dash.stepInvoice'), to: '/invoice' },
  ];
  const showChecklist = can('settings.manage') && checklist.some((c) => !c.done);

  return (
    <div className={surface.page}>
      <PageHeader
        title={t('dash.greeting', { greeting: t(greeting(now.getHours())), name: user?.name?.split(' ')[0] || t('dash.there') })}
        subtitle={t('dash.subtitle', { fy: fy.label, date: now.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) })}
        actions={
          can('doc.create') ? (
            <Link to="/invoice" className={controls.btnPrimary}>
              <FilePlus2 size={16} /> {t('nav.newInvoice')}
            </Link>
          ) : undefined
        }
      />

      <Suspense fallback={null}>
        <DemoNotice />
      </Suspense>

      {wizardOpen && (
        <Suspense fallback={null}>
          <SetupWizard
            open
            onClose={(finished) => {
              setWizardOpen(false);
              if (finished) navigate('/invoice');
            }}
          />
        </Suspense>
      )}

      {showChecklist && (
        <section className={styles.checklist} aria-label={t('dash.gettingStarted')}>
          <div className={styles.checklistHead}>
            <h2>{t('dash.getSetUp')}</h2>
            <span>{t('dash.doneOf', { done: checklist.filter((c) => c.done).length, total: checklist.length })}</span>
          </div>
          <ul>
            {checklist.map((c) => (
              <li key={c.label}>
                <Link to={c.to} className={c.done ? styles.stepDone : styles.step}>
                  {c.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  <span>{c.label}</span>
                  {!c.done && <ArrowRight size={14} className={styles.stepArrow} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={surface.statGrid}>
        <StatCard label={t('dash.billed')} value={formatCurrency(summary.billed)} hint={`${summary.count === 1 ? t('dash.issuedOne') : t('dash.issuedMany', { n: summary.count })}${noRate ? t('dash.noRate', { n: noRate }) : ''}`} icon={Receipt} />
        <StatCard label={t('dash.received')} value={formatCurrency(summary.received)} hint={t('dash.collected', { pct: collectedPct })} icon={Banknote} tone="profit" />
        <StatCard label={t('dash.outstanding')} value={formatCurrency(summary.outstanding)} hint={t('dash.yetToBePaid')} icon={Hourglass} tone="warning" />
        <StatCard
          label={t('dash.overdue')}
          value={formatCurrency(summary.overdueAmount)}
          hint={summary.overdueCount ? t('dash.pastDue', { n: summary.overdueCount }) : t('dash.nothingOverdue')}
          icon={AlertTriangle}
          tone={summary.overdueCount ? 'loss' : 'default'}
        />
      </div>

      <RemindersPanel />

      <div className={styles.grid}>
        <section className={surface.card}>
          <div className={surface.cardHead}>
            <span>{t('dash.billed6m')}</span>
            <span className={styles.muted}>{formatCurrency(months.reduce((s, m) => s + m.billed, 0))}</span>
          </div>
          <div className={styles.chart} role="img" aria-label={t('dash.chartAria')}>
            {months.map((m, i) => {
              const height = Math.max((m.billed / peak) * 100, m.billed > 0 ? 4 : 0);
              const latest = i === months.length - 1;
              return (
                <div key={m.key} className={styles.barCol}>
                  <span className={styles.barValue}>{m.billed > 0 ? compactInr(m.billed) : ''}</span>
                  <div className={styles.barTrack}>
                    <div
                      className={latest ? styles.barLatest : styles.bar}
                      style={{ height: `${height}%` }}
                      title={`${monthName(m.key)}: ${formatCurrency(m.billed)}`}
                    />
                  </div>
                  <span className={styles.barLabel}>{monthName(m.key)}</span>
                </div>
              );
            })}
          </div>
          {!hasData && <p className={styles.chartEmpty}>{t('dash.chartEmpty')}</p>}
        </section>

        <section className={surface.card}>
          <div className={surface.cardHead}>
            <span>{t('dash.needsAttention')}</span>
            <Link to="/transactions" className={styles.link}>
              {t('dash.viewAll')}
            </Link>
          </div>
          {attention.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t('dash.allClear')}
              text={chasing.size > 0 ? t('dash.allInReminders') : t('dash.noUnpaid')}
            />
          ) : (
            <ul className={styles.list}>
              {attention.map((inv) => {
                const late = daysOverdue(inv.due_date, now);
                return (
                  <li key={inv.id}>
                    <Link to={`/invoice/${inv.id}`} className={styles.row}>
                      <Avatar name={inv.client?.name || '?'} size={34} square />
                      <div className={styles.rowMain}>
                        <span className={styles.rowTitle}>{inv.client?.name || t('dash.unknownClient')}</span>
                        <span className={late ? styles.late : styles.muted}>
                          {late ? (late === 1 ? t('dash.lateOne') : t('dash.lateMany', { n: late })) : t('dash.due', { date: formatDate(inv.due_date) })}
                        </span>
                      </div>
                      <span className={styles.amount}>{formatCurrency(receivableBalance(inv), inv.currency)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <FileText size={16} /> {t('dash.recent')}
          </span>
          <Link to="/transactions" className={styles.link}>
            {t('dash.openLedger')} <ArrowRight size={13} />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('dash.noInvoices')}
            text={t('dash.noInvoicesText')}
            action={
              can('doc.create') ? (
                <Link to="/invoice" className={controls.btnPrimary}>
                  <FilePlus2 size={16} /> {t('common.createInvoice')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={`${surface.table} ${styles.recent}`}>
              <thead>
                <tr>
                  <th>{t('dash.colDocument')}</th>
                  <th>{t('dash.colClient')}</th>
                  <th>{t('dash.colDate')}</th>
                  <th>{t('dash.colStatus')}</th>
                  <th className={surface.numeric}>{t('dash.colAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((inv) => (
                  <tr key={inv.id}>
                    <td className={styles.rDoc}>
                      <Link to={`/invoice/${inv.id}`} className={styles.docLink}>
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className={styles.rClient}>{inv.client?.name || '—'}</td>
                    <td className={styles.rDate}>{formatDate(inv.issue_date)}</td>
                    <td className={styles.rStatus}>
                      <StatusBadge status={effectiveStatus(inv, now)} />
                    </td>
                    <td className={`${surface.numeric} ${styles.rAmt}`}>{formatCurrency(inv.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={styles.quick}>
        <Link to="/books?tab=pnl" className={styles.quickItem}>
          <Receipt size={18} />
          <div>
            <strong>{profit ? t('dash.netProfit', { amount: formatCurrency(profit.netProfit) }) : t('dash.pnl')}</strong>
            <span>
              {profit
                ? t('dash.pnlHint', { fy: fy.label, income: formatCurrency(profit.income), expenses: formatCurrency(profit.expenses) })
                : t('dash.openBooks', { fy: fy.label })}
            </span>
          </div>
          <ArrowRight size={16} />
        </Link>
        {lowStock > 0 && (
          <Link to="/inventory" className={styles.quickItem}>
            <AlertTriangle size={18} />
            <div>
              <strong>{lowStock === 1 ? t('dash.lowStockOne') : t('dash.lowStockMany', { n: lowStock })}</strong>
              <span>{t('dash.reviewReorder')}</span>
            </div>
            <ArrowRight size={16} />
          </Link>
        )}
        <Link to="/clients" className={styles.quickItem}>
          <Users size={18} />
          <div>
            <strong>{clientCount === 1 ? t('dash.clientsOne') : t('dash.clientsMany', { n: clientCount })}</strong>
            <span>{t('dash.manageDirectory')}</span>
          </div>
          <ArrowRight size={16} />
        </Link>
        <Link to="/settings" className={styles.quickItem}>
          <FileText size={18} />
          <div>
            <strong>{t('dash.profilesBackup')}</strong>
            <span>{t('dash.profilesBackupHint')}</span>
          </div>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
