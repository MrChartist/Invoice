import { useMemo } from 'react';
import { getTable } from '../../lib/storage';
import { FOLLOW_UP_KINDS, idByNameOf, loadCollectionNotes, partyKeyFor, partyTimeline, receiptsByParty, type FollowUpKind, type TimelineItem } from '../../lib/collections';
import { remindT } from '../../i18n/areas/reminders';
import type { ReminderRecord } from '../../lib/reminders';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import surface from '../../styles/surface.module.css';
import styles from './collections.module.css';

export interface PartyTimelineProps {
  partyKey: string;
  invoices: InvoiceRecord[];
  payments: Payment[];
  clients: Client[];
  /** Bumped by the caller after a change so the timeline re-reads storage. */
  version?: number;
}

function describe(it: TimelineItem): string {
  if (it.kind === 'followup') return [it.sub && (FOLLOW_UP_KINDS as readonly string[]).includes(it.sub) ? colT(`kind.${it.sub as FollowUpKind}`) : it.sub, it.text].filter(Boolean).join(': ');
  if (it.kind === 'promise') return colT('fuPromised', { amount: formatCurrency(it.amount ?? 0, 'INR'), date: formatDate(it.until ?? '') });
  if (it.kind === 'reminder') return [it.sub ? remindT(`stage.${it.sub}` as Parameters<typeof remindT>[0]) : '', it.channel].filter(Boolean).join(' · ');
  return '';
}

/** R2-A4: reminders sent, follow-ups, promises and receipts of one party, newest first (statement screen). */
export function PartyTimeline({ partyKey, invoices, payments, clients, version = 0 }: PartyTimelineProps) {
  useT();
  const items = useMemo(() => {
    const idByName = idByNameOf(clients);
    const invoiceIds = new Set(invoices.filter((i) => partyKeyFor(i.client, idByName) === partyKey).map((i) => i.id));
    return partyTimeline(partyKey, {
      notes: loadCollectionNotes(),
      receipts: receiptsByParty(invoices, payments, clients),
      reminders: getTable<ReminderRecord>('reminders'),
      invoiceIds,
    }).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyKey, invoices, payments, clients, version]);
  return (
    <div className={surface.card} data-party-timeline>
      <div className={surface.cardHead}><h2 className={styles.boxHead}>{colT('tlTitle')}</h2></div>
      <div className={surface.cardBody}>
        {items.length === 0 ? (
          <p className={styles.note}>{colT('tlEmpty')}</p>
        ) : (
          <ul className={styles.timeline}>
            {items.map((it, i) => (
              <li key={`${it.date}-${it.kind}-${i}`} className={styles.tlRow}>
                <span>{formatDate(it.date)}</span>
                <span className={styles.tlKind}>{colT(`tl.${it.kind}`)}</span>
                <span>{describe(it)}</span>
                <span className={surface.numeric}>{it.amount && it.kind !== 'promise' ? formatCurrency(it.amount, 'INR') : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PartyTimeline;
