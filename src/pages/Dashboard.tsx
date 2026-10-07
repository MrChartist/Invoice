import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { getTable } from '../lib/storage';
import { pendingReminders, type ReminderRecord } from '../lib/reminders';
import type { CreditLink } from '../lib/stats';
import { getUser } from '../lib/auth';
import { getIndianFY } from '../lib/invoice-number';
import { effectiveStatus } from '../lib/invoice-status';
import { attentionList, compactInr, isRevenueDoc, monthlyBilled, summarize } from '../lib/stats';
import { daysOverdue, formatCurrency, formatDate } from '../lib/utils';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Dashboard.module.css';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const user = getUser();
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
    { done: profileReady, label: 'Add your business & payment details', to: '/settings' },
    { done: clientCount > 0, label: 'Add your first client', to: '/clients' },
    { done: invoices.length > 0, label: 'Create your first invoice', to: '/invoice' },
  ];
  const showChecklist = checklist.some((c) => !c.done);

  return (
    <div className={surface.page}>
      <PageHeader
        title={`${greeting(now.getHours())}, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle={`Financial year FY${fy.label} · ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <Link to="/invoice" className={controls.btnPrimary}>
            <FilePlus2 size={16} /> New invoice
          </Link>
        }
      />

      {showChecklist && (
        <section className={styles.checklist} aria-label="Getting started">
          <div className={styles.checklistHead}>
            <h2>Get set up</h2>
            <span>
              {checklist.filter((c) => c.done).length} of {checklist.length} done
            </span>
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
        <StatCard label="Billed" value={formatCurrency(summary.billed)} hint={`${summary.count} issued invoice${summary.count === 1 ? '' : 's'}`} icon={Receipt} />
        <StatCard label="Received" value={formatCurrency(summary.received)} hint={`${collectedPct}% collected`} icon={Banknote} tone="profit" />
        <StatCard label="Outstanding" value={formatCurrency(summary.outstanding)} hint="Yet to be paid" icon={Hourglass} tone="warning" />
        <StatCard
          label="Overdue"
          value={formatCurrency(summary.overdueAmount)}
          hint={summary.overdueCount ? `${summary.overdueCount} past due date` : 'Nothing overdue'}
          icon={AlertTriangle}
          tone={summary.overdueCount ? 'loss' : 'default'}
        />
      </div>

      <RemindersPanel />

      <div className={styles.grid}>
        <section className={surface.card}>
          <div className={surface.cardHead}>
            <span>Billed · last 6 months</span>
            <span className={styles.muted}>{formatCurrency(months.reduce((s, m) => s + m.billed, 0))}</span>
          </div>
          <div className={styles.chart} role="img" aria-label="Bar chart of amount billed per month">
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
                      title={`${m.label}: ${formatCurrency(m.billed)}`}
                    />
                  </div>
                  <span className={styles.barLabel}>{m.label}</span>
                </div>
              );
            })}
          </div>
          {!hasData && <p className={styles.chartEmpty}>Your billing trend appears here once you issue an invoice.</p>}
        </section>

        <section className={surface.card}>
          <div className={surface.cardHead}>
            <span>Needs attention</span>
            <Link to="/transactions" className={styles.link}>
              View all
            </Link>
          </div>
          {attention.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All clear"
              text={chasing.size > 0 ? "Everything unpaid is already in the payment reminders above." : "No unpaid invoices. Nicely done."}
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
                        <span className={styles.rowTitle}>{inv.client?.name || 'Unknown client'}</span>
                        <span className={late ? styles.late : styles.muted}>
                          {late ? `${late} day${late === 1 ? '' : 's'} overdue` : `Due ${formatDate(inv.due_date)}`}
                        </span>
                      </div>
                      <span className={styles.amount}>{formatCurrency(inv.balance_due ?? inv.total, inv.currency)}</span>
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
            <FileText size={16} /> Recent documents
          </span>
          <Link to="/transactions" className={styles.link}>
            Open ledger <ArrowRight size={13} />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            text="Create your first GST-ready invoice in under a minute. It is saved only on this device."
            action={
              <Link to="/invoice" className={controls.btnPrimary}>
                <FilePlus2 size={16} /> Create an invoice
              </Link>
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={`${surface.table} ${styles.recent}`}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className={surface.numeric}>Amount</th>
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
            <strong>{profit ? `${formatCurrency(profit.netProfit)} net profit` : 'Profit & loss'}</strong>
            <span>
              {profit
                ? `FY${fy.label} · income ${formatCurrency(profit.income)} · expenses ${formatCurrency(profit.expenses)}`
                : `FY${fy.label} · open the books`}
            </span>
          </div>
          <ArrowRight size={16} />
        </Link>
        {lowStock > 0 && (
          <Link to="/inventory" className={styles.quickItem}>
            <AlertTriangle size={18} />
            <div>
              <strong>{lowStock} item{lowStock === 1 ? '' : 's'} low on stock</strong>
              <span>Review reorder levels</span>
            </div>
            <ArrowRight size={16} />
          </Link>
        )}
        <Link to="/clients" className={styles.quickItem}>
          <Users size={18} />
          <div>
            <strong>{clientCount} client{clientCount === 1 ? '' : 's'}</strong>
            <span>Manage your directory</span>
          </div>
          <ArrowRight size={16} />
        </Link>
        <Link to="/settings" className={styles.quickItem}>
          <FileText size={18} />
          <div>
            <strong>Profiles &amp; backup</strong>
            <span>Business details, bank, UPI</span>
          </div>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
