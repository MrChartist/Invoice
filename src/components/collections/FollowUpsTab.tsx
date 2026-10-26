import { useMemo, useState } from 'react';
import { CheckCircle2, MessageCircle, NotebookPen } from 'lucide-react';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import type { PartyReceivable, ReceivablesReport } from '../../lib/receivables';
import { can } from '../../lib/access';
import { followUpsDue, loadCollectionNotes, markActionDone, receiptsByParty, type FollowUpLists, type FollowUpRow } from '../../lib/collections';
import { buildPartyReminder } from '../../lib/khata';
import { normalizePhone, whatsappLink } from '../../lib/share';
import { localDb } from '../../lib/localDb';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { FollowUpDialog } from './FollowUpDialog';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './collections.module.css';

export interface FollowUpsTabProps {
  report: ReceivablesReport;
  invoices: InvoiceRecord[];
  payments: Payment[];
  clients: Client[];
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const SECTIONS: { key: keyof FollowUpLists; label: () => string }[] = [
  { key: 'today', label: () => colT('fuToday') },
  { key: 'overdue', label: () => colT('fuOverdue') },
  { key: 'promisesDue', label: () => colT('fuDue') },
  { key: 'broken', label: () => colT('fuBroken') },
  { key: 'kept', label: () => colT('fuKept') },
];

/**
 * R2-A4 Receivables → Follow-ups: today's and overdue next actions, promises due, broken promises and promises
 * kept in the last 30 days, each with one-tap WhatsApp (the party reminder) and "Log outcome".
 */
export function FollowUpsTab({ report, invoices, payments, clients, notify }: FollowUpsTabProps) {
  useT();
  const [version, setVersion] = useState(0);
  const [logFor, setLogFor] = useState<PartyReceivable | { key: string; name: string; bills: [] } | null>(null);
  const today = todayInput();
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const lists = useMemo(
    () => followUpsDue(loadCollectionNotes(), receiptsByParty(invoices, payments, clients), today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, payments, clients, today, version],
  );
  const partyOf = (key: string) => report.parties.find((p) => p.key === key);
  const phoneOf = (p: PartyReceivable | undefined, name: string) => {
    const c = clients.find((x) => (p?.clientId && x.id === p.clientId) || x.name?.trim().toLowerCase() === (p?.name ?? name).trim().toLowerCase());
    return normalizePhone(c?.phone);
  };
  const empty = SECTIONS.every((s) => lists[s.key].length === 0);

  const row = (r: FollowUpRow, section: keyof FollowUpLists) => {
    const n = r.note;
    const party = partyOf(n.party_key);
    const name = party?.name ?? n.party_name ?? n.party_key;
    const reminder = party && party.net > 0.004 ? buildPartyReminder({ party, sender }) : null;
    return (
      <li key={`${section}-${n.id}`} className={cn(styles.item, section === 'broken' && styles.broken, section === 'kept' && styles.kept)} data-followup-row={section}>
        <div className={styles.itemMain}>
          <span className={styles.itemTitle}>{name}</span>
          <span className={styles.itemMeta}>
            {[
              colT(`kind.${n.kind}`),
              n.outcome,
              n.promise ? colT('fuPromised', { amount: formatCurrency(n.promise.amount, 'INR'), date: formatDate(n.promise.date) }) : '',
              r.progress && r.progress.received > 0 ? colT('fuReceived', { amount: formatCurrency(r.progress.received, 'INR') }) : '',
              r.progress?.partly ? colT('fuPartly') : '',
              n.next_action?.date ? colT('fuNextOn', { date: formatDate(n.next_action.date) }) : '',
              n.next_action?.user_name ? colT('fuBy', { name: n.next_action.user_name }) : '',
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className={styles.itemActions}>
          {reminder && (
            <a className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} href={whatsappLink(phoneOf(party, name), reminder.body)} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={14} /> {colT('fuWa')}
            </a>
          )}
          {can('payment.record') && (
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setLogFor(party ?? { key: n.party_key, name, bills: [] })}>
              <NotebookPen size={14} /> {colT('fuOutcomeBtn')}
            </button>
          )}
          {(section === 'today' || section === 'overdue') && can('payment.record') && (
            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
              onClick={() => { try { markActionDone(n.id); setVersion((v) => v + 1); } catch (err) { notify((err as Error).message, 'error'); } }}>
              <CheckCircle2 size={14} /> {colT('fuDone')}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className={surface.card} data-followups-tab>
      <div className={surface.cardHead}><h2 className={styles.boxHead}>{colT('tabFollowups')}</h2></div>
      <div className={`${surface.cardBody} ${styles.stack}`}>
        {empty && <p className={styles.note}>{colT('fuEmpty')}</p>}
        {SECTIONS.map((s) => lists[s.key].length > 0 && (
          <section key={s.key} className={styles.section} aria-label={s.label()}>
            <h3 className={styles.sectionHead}>{s.label()} <span className={styles.count}>{lists[s.key].length}</span></h3>
            <ul className={styles.list}>{lists[s.key].map((r) => row(r, s.key))}</ul>
          </section>
        ))}
      </div>
      {logFor && (
        <FollowUpDialog partyKey={logFor.key} partyName={logFor.name}
          bills={(logFor.bills as PartyReceivable['bills']).map((b) => ({ id: b.invoiceId, number: b.number, outstanding: b.outstanding }))}
          onClose={() => setLogFor(null)} onSaved={(m) => { notify(m); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

export default FollowUpsTab;
