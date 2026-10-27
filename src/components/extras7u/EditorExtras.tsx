/**
 * 7U editor extras in the summary panel (lazy; mounted only once an agent, a bill-value offer or the
 * pharma pack exists): sales agent, the bill-value offer line (applied automatically after the price
 * was chosen, removable per bill), prescription details for Schedule H1 / X sales.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RECORD_KEYS, useInvoiceStore } from '../../store/useInvoiceStore';
import { agentsDb } from '../../lib/sales-commission';
import { localDb } from '../../lib/localDb';
import { schemesDb } from '../../lib/pricing';
import { applyBillOffer, removeBillOffer } from '../../lib/offers';
import { liveScheduleIndex, readPharmaSettings, rxMissing } from '../../lib/pharma';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { x7T } from '../../i18n/areas/extras-7u';
import controls from '../../styles/controls.module.css';
import own from './x7u.module.css';

const RxEditorExtra = lazy(() => import('../retail-r9/RxStrip').then((m) => ({ default: m.RxEditorExtra })));

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'CREDIT_NOTE']);
const OFFER_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER']);

const recordOf = (): InvoiceRecord => {
  const st = useInvoiceStore.getState();
  return Object.fromEntries(RECORD_KEYS.map((k) => [k, st[k]])) as unknown as InvoiceRecord;
};

export default function EditorExtras() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({
    doc_type: st.doc_type, agent_id: st.agent_id, offer: st.offer, rx: st.rx, items: st.items, issue_date: st.issue_date,
    discount_type: st.discount_type, discount_rate: st.discount_rate, patch: st.patch,
  })));
  const agents = useMemo(() => agentsDb.all().filter((a) => a.kind !== 'broker'), []); // R8-B: brokers have their own picker
  const offers = useMemo(() => schemesDb.all().filter((x) => x.kind === 'bill_value'), []);
  const pharma = useMemo(() => readPharmaSettings(), []);
  const index = useMemo(() => (pharma.enabled ? liveScheduleIndex() : new Map()), [pharma.enabled]);
  const [skipOffer, setSkipOffer] = useState(false);
  // 8F: a party's default salesman fills an empty agent when the party is picked.
  const clientId = useInvoiceStore((st) => st.client?.id);
  useEffect(() => {
    if (!clientId || useInvoiceStore.getState().agent_id) return;
    const agent = localDb.clients.getById(clientId)?.agent_id;
    if (agent && agents.some((a) => a.id === agent)) s.patch({ agent_id: agent });
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bill-value offer: re-applied whenever the bill changes (same record back = nothing to do).
  useEffect(() => {
    if (!offers.length || !OFFER_DOCS.has(s.doc_type)) return;
    const rec = recordOf();
    const next = skipOffer ? removeBillOffer(rec) : applyBillOffer(rec, offers);
    if (next === rec) return;
    s.patch({ discount_type: next.discount_type, discount_rate: next.discount_rate, offer: next.offer });
  }, [offers, skipOffer, s.items, s.issue_date, s.doc_type, s.discount_type, s.discount_rate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!SALES.has(s.doc_type)) return null;
  const missing = pharma.enabled ? rxMissing({ items: s.items, rx: s.rx }, index) : [];
  const liveAgents = agents.filter((a) => a.active !== false || a.id === s.agent_id);

  return (
    <div className={own.form} data-editor-extras>
      {liveAgents.length > 0 && (
        <label className={controls.field}><span className={controls.label}>{x7T('salesAgent')}</span>
          <select className={controls.select} value={s.agent_id ?? ''} onChange={(e) => s.patch({ agent_id: e.target.value || undefined })}>
            <option value="">{x7T('noAgent')}</option>
            {liveAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
      )}
      {offers.length > 0 && OFFER_DOCS.has(s.doc_type) && (s.offer || skipOffer) && (
        <div className={own.offerLine} data-offer-line>
          {s.offer ? <span>{s.offer.label}</span> : <span className={own.muted}>{x7T('offerSkipped')}</span>}
          {s.offer && <strong>−{formatCurrency(s.offer.value)}</strong>}
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setSkipOffer(!skipOffer)}>{skipOffer ? x7T('applyOffer') : x7T('notThisBill')}</button>
        </div>
      )}
      {pharma.enabled && (
        <div className={own.box}>
          <p className={own.sub}>{x7T('prescription')}</p>
          <Suspense fallback={null}><RxEditorExtra /></Suspense>{/* R9 (RT-B1): doctor picker, age / gender, Rx no. / date / photo */}
          {missing.length > 0 && <p className={own.warn}>{x7T('rxNeeded', { items: missing.join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}
