/**
 * R14 PS-B2 editor chip (lazy, `legal` pack): on a new fee note the regime is applied once when the client is picked —
 * reverse charge, exempt or forward charge — with the reason; "Change" cycles it. Existing mechanisms only (outward RCM
 * flag, the R10 exempt marker, Bill of Supply); the snapshot `ps.legal` prints the sentence. Verify with your CA (PS1).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { psbT } from '../../i18n/areas/prof-r14b';
import { DB_PREFIX, getJson, getTable } from '../../lib/storage';
import { legalPatch } from '../../lib/prof/ps-legal-paper';
import type { LegalRegime } from '../../lib/prof/ps-legal';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';

const NEXT: Record<LegalRegime, LegalRegime> = { rcm: 'exempt', exempt: 'taxable', taxable: 'rcm' };

export default function LegalRegimeChip() {
  useT();
  const senior = useMemo(() => getJson<{ legal?: { senior?: boolean } } | null>(`${DB_PREFIX}prof_settings`, null)?.legal?.senior === true, []);
  const s = useInvoiceStore(useShallow((st) => ({ id: st.id, client: st.client, items: st.items, issue_date: st.issue_date, doc_type: st.doc_type, sender: st.sender, ps: (st as { ps?: Record<string, unknown> }).ps })));
  const isNew = useMemo(() => !getTable<{ id: string }>('invoices').some((i) => i?.id === s.id), [s.id]);
  const registered = !!s.sender?.companyGstin?.trim();
  const done = useRef('');
  const apply = (force?: LegalRegime) => {
    const r = legalPatch({ record: s as unknown as InvoiceRecord, registered, senior, force });
    useInvoiceStore.getState().patch(r.patch as never);
  };
  const key = s.client?.id ?? s.client?.name ?? '';
  useEffect(() => {
    // Once per client on a new document; an issued fee note keeps what it was saved with.
    if (!isNew || !s.client?.name || done.current === key) return;
    done.current = key;
    apply();
  }, [key, isNew]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = s.ps?.legal as { regime?: LegalRegime } | undefined;
  if (!legal?.regime) return null;
  const why = legalPatch({ record: s as unknown as InvoiceRecord, registered, senior }).regime.reason;
  return (
    <p className={controls.hint} role="note" data-ps-legal={legal.regime}>
      {!registered && <>{psbT('memo')} · </>}
      {psbT('legal')}: {psbT(`r.${legal.regime}`)} — {psbT(`why.${why}`)} ·{' '}
      <button type="button" className={controls.btnGhost} onClick={() => apply(NEXT[legal.regime!])} data-ps-legal-change>{psbT('change')}</button> <small>{psbT('verify')}</small>
    </p>
  );
}
