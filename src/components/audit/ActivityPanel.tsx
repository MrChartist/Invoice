import { useMemo, useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { AUDIT_MAX_ROWS, audit } from '../../lib/audit';
import { auditToCsv, filterAudit, type AuditFilter } from '../../lib/audit-query';
import { downloadText } from '../../lib/download';
import { localDayOf } from '../../lib/dates';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  type AuditAction,
  type AuditEntity,
  type AuditEntry,
} from '../../types/audit';
import { AuditChanges } from './AuditChanges';
import { formatWhen, toneOf } from './audit-format';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './audit.module.css';

const PAGE = 100;
const TAG = { good: styles.tagCreate, bad: styles.tagDanger, lock: styles.tagLock, neutral: '' } as const;

function Row({ e, open, onToggle }: { e: AuditEntry; open: boolean; onToggle: () => void }) {
  const has = (e.changes?.length ?? 0) > 0;
  return (
    <>
      <tr>
        <td className={styles.when}>{formatWhen(e.at)}</td>
        <td>
          <span className={`${styles.tag} ${TAG[toneOf(e.action)]}`}>{AUDIT_ACTION_LABELS[e.action]}</span>
        </td>
        <td>{AUDIT_ENTITY_LABELS[e.entity]}</td>
        <td>
          {has ? (
            <button type="button" className={styles.expand} aria-expanded={open} onClick={onToggle}>
              {e.summary}
              <span className={styles.more} style={{ marginLeft: '0.4rem' }}>
                {open ? 'Hide' : 'Details'}
              </span>
            </button>
          ) : (
            e.summary
          )}
          {open && <AuditChanges changes={e.changes} />}
        </td>
      </tr>
    </>
  );
}

/** Settings → Activity: the full edit log with filters, search and CSV export. */
export function ActivityPanel() {
  const [version] = useState(0);
  const [entity, setEntity] = useState<AuditEntity | 'all'>('all');
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const all = useMemo(() => {
    void version;
    return audit.all();
  }, [version]);
  const filter: AuditFilter = { entity, action, from, to, q };
  const rows = useMemo(() => filterAudit(all, filter), [all, entity, action, from, to, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.slice(0, limit);
  const filtered = entity !== 'all' || action !== 'all' || from || to || q.trim();

  const exportCsv = () => downloadText(`activity-log-${localDayOf(new Date())}.csv`, '﻿' + auditToCsv(rows), 'text/csv');
  const reset = () => {
    setEntity('all');
    setAction('all');
    setFrom('');
    setTo('');
    setQ('');
    setLimit(PAGE);
  };

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <ScrollText size={16} aria-hidden="true" /> Activity log
        </span>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={14} /> Export CSV
        </button>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          Every change to documents, payments, clients and settings is recorded on this device — like Tally&apos;s edit log.
          Contact and bank details are noted as &ldquo;changed&rdquo;, never copied.
        </p>

        <div className={styles.toolbar}>
          <label className={`${controls.field} ${styles.searchField}`}>
            <span className={controls.label}>Search</span>
            <input
              className={controls.input}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Invoice number, client, amount…"
            />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Area</span>
            <select className={controls.select} value={entity} onChange={(e) => setEntity(e.target.value as AuditEntity | 'all')}>
              <option value="all">Everything</option>
              {AUDIT_ENTITIES.map((x) => (
                <option key={x} value={x}>
                  {AUDIT_ENTITY_LABELS[x]}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Action</span>
            <select className={controls.select} value={action} onChange={(e) => setAction(e.target.value as AuditAction | 'all')}>
              <option value="all">Any action</option>
              {AUDIT_ACTIONS.map((x) => (
                <option key={x} value={x}>
                  {AUDIT_ACTION_LABELS[x]}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>From</span>
            <input className={controls.input} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>To</span>
            <input className={controls.input} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        <div className={styles.panelHead}>
          <span className={styles.count} aria-live="polite">
            {rows.length} of {all.length} entr{all.length === 1 ? 'y' : 'ies'}
          </span>
          {filtered ? (
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={reset}>
              Clear filters
            </button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className={styles.emptyNote}>
            {all.length === 0 ? 'Nothing recorded yet. Create or edit a document and it will show up here.' : 'No entries match these filters.'}
          </p>
        ) : (
          <>
            <div className={surface.tableWrap}>
              <table className={styles.logTable}>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Area</th>
                    <th scope="col">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.cards}>
              {shown.map((e) => (
                <div key={e.id} className={styles.card}>
                  <div>
                    <span className={`${styles.tag} ${TAG[toneOf(e.action)]}`}>{AUDIT_ACTION_LABELS[e.action]}</span>{' '}
                    <span className={styles.when}>{formatWhen(e.at)}</span>
                  </div>
                  <div>{e.summary}</div>
                  <AuditChanges changes={e.changes} />
                </div>
              ))}
            </div>

            {rows.length > shown.length && (
              <button type="button" className={controls.btnOutline} style={{ alignSelf: 'flex-start' }} onClick={() => setLimit((n) => n + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown.length)} more
              </button>
            )}
          </>
        )}
        <p className={styles.limit}>The newest {AUDIT_MAX_ROWS.toLocaleString('en-IN')} entries are kept; older ones roll off. Included in backups.</p>
      </div>
    </section>
  );
}
