import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type { Milestone } from '../../types/sales-r2';
import { createBalanceInvoice, progressBlocked, progressSummary, saveMilestones } from '../../lib/progress-billing';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { generateId } from '../../lib/storage';
import { formatCurrency, formatDate } from '../../lib/utils';
import { StatusBadge } from '../ui/StatusBadge';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './sales-r2.module.css';

const ProgressInvoiceDialog = lazy(() => import('./ProgressInvoiceDialog').then((m) => ({ default: m.ProgressInvoiceDialog })));

/**
 * R2-B2 on a quotation / sales order: billed vs quoted (quoted, invoiced, credited, remaining, % complete),
 * the stage invoices, the milestone plan, and the Progress invoice / Invoice remaining balance actions.
 */
export function ProgressPanel({ source, refreshKey }: { source: InvoiceRecord; refreshKey?: number | string }) {
  useT(); // re-render on a language switch (5.4)
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const { summary, blocked, fresh } = useMemo(() => {
    void refreshKey;
    void tick;
    const f = localDb.invoices.getById(source.id) ?? source;
    const links = readLinks();
    return { fresh: f, summary: progressSummary(f, localDb.invoices.getAll(), links), blocked: progressBlocked(f, links) };
  }, [source, refreshKey, tick]);
  const [plan, setPlan] = useState<Milestone[]>(() => fresh.milestones ?? []);
  const cur = fresh.currency || 'INR';
  const money = (n: number) => formatCurrency(n, cur);

  const balance = () => {
    setError('');
    try {
      const rec = createBalanceInvoice(fresh);
      navigate(`/invoice/${rec.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const savePlan = () => {
    setError('');
    try {
      const saved = saveMilestones(fresh.id, plan);
      setPlan(saved.milestones ?? []);
      setTick((t) => t + 1);
      setError(s2T('p.planSaved'));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <details className={styles.panel} open={summary.stages.length > 0 || undefined} data-progress-panel>
      <summary className={styles.panelHead}>
        <strong>{s2T('p.panel')}</strong>
        <span className={styles.muted}>{s2T('p.complete', { pct: summary.percent })}</span>
      </summary>
      <div className={styles.kpis}>
        <div><span>{s2T('p.quoted')}</span><strong>{money(summary.quoted)}</strong></div>
        <div><span>{s2T('p.invoiced')}</span><strong data-progress-invoiced>{money(summary.invoiced)}</strong></div>
        <div><span>{s2T('p.credited')}</span><strong>{money(summary.credited)}</strong></div>
        <div><span>{s2T('p.remaining')}</span><strong data-progress-remaining>{money(summary.remaining)}</strong></div>
      </div>
      <div className={styles.bar} aria-hidden="true"><span style={{ width: `${Math.min(Math.max(summary.percent, 0), 100)}%` }} /></div>
      <p className={styles.muted}>{s2T('verifyCa')}</p>

      <div className={controls.row}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!!blocked} title={blocked || undefined} onClick={() => setOpen(true)} data-progress-open>
          {s2T('p.menu')}
        </button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!!blocked || summary.remaining <= 0.004} onClick={balance} data-progress-balance>
          {s2T('p.balanceMenu')}
        </button>
      </div>
      {summary.closed && <p className={styles.muted}>{s2T('p.closed')}</p>}

      <h4 className={styles.sub}>{s2T('p.stages')}</h4>
      {summary.stages.length === 0 ? <p className={styles.muted}>{s2T('p.noStages')}</p> : (
        <ul className={styles.list}>
          {summary.stages.map((s) => (
            <li key={s.id}>
              <Link to={`/invoice/${s.id}`}>{s.invoice_number}</Link> · {formatDate(s.issue_date)} · {money(s.taxable_value)}{' '}
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}

      <h4 className={styles.sub}>{s2T('p.plan')}</h4>
      <div className={styles.planGrid}>
        {plan.map((m, i) => {
          const inv = m.invoice_id ? summary.stages.find((s) => s.id === m.invoice_id) : undefined;
          return (
            <div key={m.id} className={styles.planRow}>
              <input className={controls.input} value={m.name} onChange={(e) => setPlan(plan.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))} placeholder={s2T('p.mName')} aria-label={`${s2T('p.mName')} ${i + 1}`} />
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={m.percent || ''} onChange={(e) => setPlan(plan.map((x) => (x.id === m.id ? { ...x, percent: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } : x)))} placeholder={s2T('p.mPct')} aria-label={`${s2T('p.mPct')} ${i + 1}`} />
              <input className={controls.input} type="date" value={m.expected_date ?? ''} onChange={(e) => setPlan(plan.map((x) => (x.id === m.id ? { ...x, expected_date: e.target.value || undefined } : x)))} aria-label={`${s2T('p.mDate')} ${i + 1}`} />
              {inv ? <span className={styles.muted}>✓ {s2T('p.ticked', { number: inv.invoice_number })}</span> : (
                <button type="button" className={controls.btnIcon} onClick={() => setPlan(plan.filter((x) => x.id !== m.id))} aria-label={`${s2T('remove')} ${i + 1}`}><Trash2 size={14} /></button>
              )}
            </div>
          );
        })}
      </div>
      <div className={controls.row}>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setPlan([...plan, { id: generateId(), name: '', percent: 0 }])}>
          <Plus size={14} aria-hidden="true" /> {s2T('p.addMilestone')}
        </button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={savePlan}>{s2T('p.savePlan')}</button>
      </div>
      {error && <p className={styles.muted} role="status">{error}</p>}
      <p className={styles.muted}>{s2T('p.tos')}</p>

      {open && (
        <Suspense fallback={null}>
          <ProgressInvoiceDialog source={fresh} onClose={() => setOpen(false)} onCreated={(rec) => navigate(`/invoice/${rec.id}`)} />
        </Suspense>
      )}
    </details>
  );
}
