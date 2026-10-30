import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InvoiceRecord } from '../../types/invoice';
import { quoteFamily, revisionDiff, revisionOf, supersededIds } from '../../lib/quote-revisions';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import styles from './sales-r2.module.css';

/**
 * R2-B3: every revision of a quotation (same base number), Superseded ones marked, and a line-level
 * diff of a revision against the one before it. Old revisions are never edited.
 */
export function RevisionsPanel({ quote, refreshKey }: { quote: InvoiceRecord; refreshKey?: number | string }) {
  useT(); // re-render on a language switch (5.4)
  const { family, superseded } = useMemo(() => {
    void refreshKey;
    return { family: quoteFamily(quote, localDb.invoices.getAll()), superseded: supersededIds(readLinks()) };
  }, [quote, refreshKey]);
  const [pick, setPick] = useState(quote.id);
  if (family.length <= 1) return null;
  const idx = Math.max(family.findIndex((q) => q.id === pick), 0);
  const current = family[idx];
  const prev = idx > 0 ? family[idx - 1] : undefined;
  const diff = prev ? revisionDiff(prev, current) : null;
  const cur = current.currency || 'INR';
  const changed = diff?.lines.filter((l) => l.kind !== 'same') ?? [];

  return (
    <details className={styles.panel} open data-revisions>
      <summary className={styles.panelHead}>
        <strong>{s2T('q.revisions')}</strong>
        <span className={styles.muted}>{family.length}</span>
      </summary>
      <ul className={styles.list}>
        {family.map((q) => (
          <li key={q.id}>
            <button type="button" className={styles.linkBtn} aria-pressed={q.id === current.id} onClick={() => setPick(q.id)}>
              {s2T('q.revisionN', { n: revisionOf(q) })}
            </button>{' '}
            {q.id === quote.id ? <strong>{q.invoice_number}</strong> : <Link to={`/invoice/${q.id}`}>{q.invoice_number}</Link>} · {formatDate(q.issue_date)} · {formatCurrency(q.total, q.currency || 'INR')}{' '}
            <span className={styles.muted}>{superseded.has(q.id) ? s2T('q.superseded') : s2T('q.current')}</span>
          </li>
        ))}
      </ul>
      {diff && prev && (
        <div>
          <h4 className={styles.sub}>{s2T('q.diffVs', { number: prev.invoice_number })}</h4>
          {changed.length === 0 ? <p className={styles.muted}>{s2T('q.noChange')}</p> : (
            <ul className={styles.list}>
              {changed.map((l, i) => (
                <li key={`${l.name}-${i}`} className={cn(l.kind === 'added' && styles.diffAdded, l.kind === 'removed' && styles.diffRemoved, l.kind === 'changed' && styles.diffChanged)}>
                  {l.kind === 'added' ? s2T('q.added') : l.kind === 'removed' ? s2T('q.removed') : s2T('q.changed')}: {l.name || '-'}
                  {l.kind === 'changed' && l.before && l.after && (
                    <span className={styles.muted}>
                      {' '}({l.fields.map((f) => `${f.replace('_percent', ' %').replace('_', ' ')} ${String(l.before![f as keyof typeof l.before])} → ${String(l.after![f as keyof typeof l.after])}`).join('; ')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.muted}>{s2T('q.totalChange', { before: formatCurrency(diff.totalBefore, cur), after: formatCurrency(diff.totalAfter, cur) })}</p>
        </div>
      )}
    </details>
  );
}
