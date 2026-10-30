/**
 * TR-A1 / A5 editor summary strip (lazy; trade settings or a trading pack on):
 *  - the cash-discount term printed under the totals ("2% if paid within 7 days"), defaulted from the party;
 *  - returnable packaging given / taken back with this document (sales documents, packaging on).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { localDb } from '../../lib/localDb';
import { impliedPacks } from '../../lib/shop-mode';
import { loadPackMoves, loadPackTypes, recordPackMove } from '../../lib/trade/tr-packaging';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import controls from '../../styles/controls.module.css';
import own from './trade.module.css';
import { SelectField } from '../ui/SelectField';

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN', 'CREDIT_NOTE']);

export default function PackagingStrip() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['id', 'client', 'cash_discount', 'doc_type', 'issue_date', 'invoice_number', 'patch'])));
  const set = useMemo(() => localDb.settings.get(), []);
  const packs = impliedPacks(set);
  const trade = !!set.trade_discounts || packs.includes('distributor') || packs.includes('commodity');
  const packOn = !!set.returnable_packaging || packs.some((p) => p === 'distributor' || p === 'commodity' || p === 'agency');
  const prevClient = useRef(s.client?.id);
  useEffect(() => {
    if (prevClient.current === s.client?.id) return;
    prevClient.current = s.client?.id;
    const cd = s.client?.id ? localDb.clients.getById(s.client.id)?.cash_discount : undefined;
    if (cd) s.patch({ cash_discount: cd });
  }, [s]);
  const [tick, setTick] = useState(0);
  const types = useMemo(() => (packOn ? loadPackTypes() : []), [packOn]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (packOn ? loadPackMoves().filter((m) => m.doc_id === s.id) : []), [packOn, s.id, tick]);
  const [mv, setMv] = useState({ type: '', out: '', in: '', msg: '' });
  const cd = s.cash_discount;
  const term = (p: Partial<{ percent: number; days: number }>) => {
    const next = { percent: cd?.percent ?? 0, days: cd?.days ?? 0, ...p };
    s.patch({ cash_discount: next.percent > 0 ? next : undefined });
  };
  const record = () => {
    try {
      recordPackMove({ date: s.issue_date, party_kind: 'client', party_id: s.client?.id, party_name: s.client?.name ?? '', type_id: mv.type || types[0]?.id || '', out: Number(mv.out) || 0, in: Number(mv.in) || 0, doc_id: s.id, doc_no: s.invoice_number });
      setMv({ ...mv, out: '', in: '', msg: aT('recorded') });
      setTick((n) => n + 1);
    } catch (e) {
      setMv({ ...mv, msg: (e as Error).message });
    }
  };
  return (
    <div className={own.stack} data-trade-strip>
      {trade && s.doc_type !== 'CREDIT_NOTE' && s.doc_type !== 'DELIVERY_CHALLAN' && (
        <div className={own.inline}>
          <span>{aT('cashDisc')}</span>
          <input className={controls.ghost} type="number" min={0} max={99} step="0.01" size={4} value={cd?.percent ?? ''} onChange={(e) => term({ percent: Number(e.target.value) || 0 })} aria-label={aT('cashDisc')} data-cd-percent />
          <span>{aT('cdDays')}</span>
          <input className={controls.ghost} type="number" min={0} size={4} value={cd?.days ?? ''} onChange={(e) => term({ days: Math.max(Math.round(Number(e.target.value) || 0), 0) })} aria-label={aT('cdDays')} data-cd-days />
        </div>
      )}
      {packOn && SALES.has(s.doc_type) && types.length > 0 && !!s.client?.name && (
        <div className={own.inline} data-pack-strip>
          <span>{aT('crates')}</span>
          <SelectField className={controls.ghost} value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })} aria-label={aT('crates')}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <input className={controls.ghost} type="number" min={0} size={4} placeholder={aT('out')} value={mv.out} onChange={(e) => setMv({ ...mv, out: e.target.value })} aria-label={aT('out')} data-pack-out />
          <input className={controls.ghost} type="number" min={0} size={4} placeholder={aT('in')} value={mv.in} onChange={(e) => setMv({ ...mv, in: e.target.value })} aria-label={aT('in')} />
          <button type="button" className={controls.btnGhost} onClick={record} data-pack-record>{aT('record')}</button>
          {mine.length > 0 && <span className={own.muted}>{mine.map((m) => `${types.find((t) => t.id === m.type_id)?.name ?? ''} ${m.out ? `−${m.out}` : ''}${m.in ? ` +${m.in}` : ''}`).join(' · ')}</span>}
          {mv.msg && <span className={own.muted} role="status">{mv.msg}</span>}
        </div>
      )}
    </div>
  );
}
