import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat2, Undo2 } from 'lucide-react';
import type { Client, DocumentType, InvoiceItem } from '../../types/invoice';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatDate, todayInput } from '../../lib/utils';
import { HABIT_DOC_TYPES, habitKey, lastBill, repeatLines, usualItems, usualLine, type UsualItem } from '../../lib/party-habits';
import { applyPartyDefaults, type AppliedDefaults } from '../../lib/party-defaults';
import type { Scheme } from '../../lib/pricing';
import { afterLineChange, editorPricing, pickCatalogItem, repriceAll } from './pricing-actions';
import { masterOf } from '../clients/party-defaults';
import { isRepeatShortcut } from './line-keys';
import styles from './party-habits.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Per-party habits, cached for the session (keyed by party, document type and the invoice count). */
const cache = new Map<string, { last: ReturnType<typeof lastBill>; usual: UsualItem[] }>();

function habitsFor(party: Client, docType: DocumentType) {
  const invoices = localDb.invoices.getAll();
  const key = `${habitKey(party)}|${docType}|${invoices.length}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = { last: lastBill(invoices, party, docType), usual: usualItems(invoices, party, todayInput()) };
    cache.set(key, hit);
  }
  return hit;
}

const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;

/**
 * Under the party on a NEW document: applies the party's document defaults once (R3-B5, with Undo and
 * the default discount on new lines), and offers "Repeat last bill" (Alt+R) and up to 8 usual-item
 * chips (R3-B6). Loaded lazily by PartiesSection when a party is picked from the directory.
 */
export default function PartyHabitsStrip({ party }: { party: Client }) {
  useT();
  const id = useInvoiceStore((s) => s.id);
  const docType = useInvoiceStore((s) => s.doc_type);
  const clientName = useInvoiceStore((s) => s.client.name);
  const hasLine = useInvoiceStore((s) => s.items.some((i) => i.name?.trim()));
  const active = !id && norm(clientName) === norm(party.name);
  const [applied, setApplied] = useState<AppliedDefaults | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(true);
  const discounted = useRef(new Set<string>());
  const appliedOnce = useRef(false);

  // R3-B5: apply the party's defaults once, when the strip mounts for this pick.
  useEffect(() => {
    if (appliedOnce.current || !active) return;
    appliedOnce.current = true;
    const st = useInvoiceStore.getState();
    const settings = localDb.settings.get();
    const master = masterOf(party) ?? party;
    const res = applyPartyDefaults(st, master, { notes: settings.defaultNotes, terms: st.sender?.defaultTerms || settings.defaultTerms }, getTable('currency_rates'));
    if (!res) return;
    if (Object.keys(res.patch).length) st.patch(res.patch);
    setApplied(res);
  }, [active, party]);

  // R3-B5: the default discount goes on lines added after the pick (lines already named keep theirs).
  useEffect(() => {
    const d = applied?.line_discount ?? 0;
    if (!d) return;
    const skip = new Set(useInvoiceStore.getState().items.filter((i) => i.name?.trim()).map((i) => i.id));
    const tag = () => {
      const st = useInvoiceStore.getState();
      if (st.id) return;
      for (const line of st.items) {
        if (skip.has(line.id) || discounted.current.has(line.id) || line.free_of || num(line.discount_percent) > 0) continue;
        discounted.current.add(line.id);
        st.patchItem(line.id, { discount_percent: d });
      }
    };
    tag();
    return useInvoiceStore.subscribe(tag);
  }, [applied]);

  const undo = () => {
    if (!applied) return;
    const st = useInvoiceStore.getState();
    if (Object.keys(applied.undo).length) st.patch(applied.undo);
    for (const line of st.items) {
      if (discounted.current.has(line.id) && num(line.discount_percent) === applied.line_discount) st.patchItem(line.id, { discount_percent: 0 });
    }
    discounted.current.clear();
    setApplied(null);
    setMessage(svcT('defaultsUndone'));
  };

  const habits = useMemo(() => (active && HABIT_DOC_TYPES.includes(docType) ? habitsFor(party, docType) : null), [active, party, docType]);
  const last = habits?.last;

  const catalog = () => localDb.items.getAll();
  const placeLines = (lines: InvoiceItem[]) => {
    const st = useInvoiceStore.getState();
    const kept = st.items.filter((i) => i.name?.trim());
    st.patch({ items: [...kept, ...lines] });
  };

  const repeat = () => {
    if (!last) return;
    const st = useInvoiceStore.getState();
    const lines = repeatLines(last.items ?? [], { catalog: catalog(), schemes: getTable<Scheme>('schemes'), day: st.issue_date, newId: generateId });
    if (!lines.length) return;
    placeLines(lines);
    // Today's prices through the existing pricing path (levels / slabs / price lists), then schemes.
    if (editorPricing() && !lines.some((l) => num(l.unit_factor) > 0 && num(l.unit_factor) !== 1)) repriceAll();
    else afterLineChange();
    setMessage(svcT('repeated', { n: lines.filter((l) => !l.free_of).length, number: last.invoice_number }));
  };

  const addUsual = (u: UsualItem) => {
    const st = useInvoiceStore.getState();
    const cat = catalog();
    const line = usualLine(u, { catalog: cat, day: st.issue_date, newId: generateId });
    placeLines([line]);
    const item = cat.find((c) => norm(c.name) === norm(u.name));
    // A catalogue item goes through the editor's pricing path (level, slab, last rate, schemes); its quantity stays.
    if (item && !(num(line.unit_factor) > 0 && num(line.unit_factor) !== 1)) pickCatalogItem(line.id, item);
    else afterLineChange();
  };

  // Alt+R repeats the last bill while this strip is live.
  useEffect(() => {
    if (!active || !last) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isRepeatShortcut(e)) return;
      e.preventDefault();
      repeat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!active) return null;
  if (!applied && !message && !(habits && (habits.last || habits.usual.length > 0))) return null;
  const phone = isPhone();
  const showHabits = !!habits && (habits.last || habits.usual.length > 0) && (phone ? open : !hasLine);

  return (
    <div className={styles.strip} data-party-strip>
      {applied && (
        <span className={styles.applied} role="status" data-defaults-applied>
          {svcT('defaultsApplied', { party: party.name })}
          <button type="button" className={styles.chip} onClick={undo}><Undo2 size={12} /> {svcT('undo')}</button>
        </span>
      )}
      {message && <span className={styles.hint} role="status">{message}</span>}
      {habits && (habits.last || habits.usual.length > 0) && phone && (
        <button type="button" className={styles.chip} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? svcT('hideStrip') : svcT('showStrip')}
        </button>
      )}
      {showHabits && (
        <>
          {last && (
            <div className={styles.row}>
              <button type="button" className={styles.chip} onClick={repeat} data-repeat-last>
                <Repeat2 size={14} /> {svcT('repeatLast')}
              </button>
              <span className={styles.hint}>{svcT('repeatHint', { number: last.invoice_number, date: formatDate(last.issue_date), n: (last.items ?? []).filter((l) => !l.free_of && l.name?.trim()).length })}</span>
            </div>
          )}
          {habits.usual.length > 0 && (
            <div className={styles.row} aria-label={svcT('usual')} data-usual-items>
              <span className={styles.label}>{svcT('usual')}</span>
              {habits.usual.map((u) => (
                <button key={u.name} type="button" className={styles.chip} onClick={() => addUsual(u)} aria-label={svcT('usualAdd', { item: u.name })}>
                  {u.name} × {u.last_qty}{u.unit ? ` ${u.unit}` : ''}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
