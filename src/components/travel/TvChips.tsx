/**
 * R15-D editor chips (lazy, mounted by `TravelRows` once a trip / event is picked): the place-of-supply chip (D2 trips by
 * Sec 12(2) / 13(3)(b), D3 events by Sec 12(7)(a)) with "Use this POS" (sets the place of supply and snapshots
 * `tv.pos_note`), the Sec 2(6) check of R14 when the user marked an export, and the outbound TCS chip (D1): the rate
 * by date and buyer aggregate, the stand-alone / non-resident tests and "Apply TCS" (the invoice's TCS fields + `tv.tcs`).
 * Only the user's click writes. Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { tvdList, tvdT } from '../../i18n/areas/travel-r15d';
import { localDb } from '../../lib/localDb';
import { formatCurrency } from '../../lib/utils';
import { round2 } from '../../lib/invoice-calc';
import { stateByCode } from '../../lib/india-states';
import { loadBookings } from '../../lib/travel/tv-bookings';
import { readTravelSettings } from '../../lib/travel/tv-settings';
import { tvSnapshot } from '../../lib/travel/tv-regime';
import { buyerKey, priorTourBase, tcsPatch, tourTcs } from '../../lib/travel/tv-tcs';
import { travelPos, tripExportCheck } from '../../lib/travel/tv-pos';
import { eventRule } from '../../lib/travel/tv-events';
import type { Trip } from '../../lib/travel/tv-trips';
import controls from '../../styles/controls.module.css';

const VERDICTS = ['export', 'not', 'pending', 'unknown'];
const line = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', width: '100%' } as const;

export default function TvChips({ trip }: { trip: Trip }) {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ id: st.id, date: st.issue_date, client: st.client, totals: st.totals, tv: st.tv, pos: st.place_of_supply, supply_type: st.supply_type, currency: st.currency, fx: st.exchange_rate, sender: st.sender })));
  const comps = useMemo(() => loadBookings(trip.id).filter((b) => b.status !== 'cancelled').map((b) => b.component), [trip.id]);
  const invoices = useMemo(() => localDb.invoices.getAll(), []);
  const master = useMemo(() => localDb.clients.getAll().find((c) => !!c.id && c.id === s.client?.id), [s.client?.id]);
  const party = { ...master, ...s.client, tv: s.client?.tv ?? master?.tv, ps: s.client?.ps ?? master?.ps };
  const [force, setForce] = useState(!!s.tv?.tcs?.force);
  const [nr, setNr] = useState(!!(s.tv?.tcs?.nr || party.tv?.non_resident));
  const st = useInvoiceStore.getState;
  const t = trip.tv;
  const pos = travelPos(t, party, comps);
  const exp = tripExportCheck({ id: s.id, issue_date: s.date, supply_type: s.supply_type, place_of_supply: s.pos, sender: s.sender, currency: s.currency }, party, t.scope);
  const usePos = () => {
    if (/^\d\d$/.test(pos.state) && pos.state !== '96' && pos.state !== s.pos) st().setPlaceOfSupply(pos.state);
    st().patch({ tv: { ...st().tv, pos_note: pos.note } });
  };
  const showTcs = t.kind === 'trip' && (t.scope === 'outbound' || !!s.tv?.tcs);
  const baseKind = readTravelSettings().tcs?.base ?? 'total';
  const tot = s.totals;
  const base = baseKind === 'taxable' ? tot.taxable_value : round2(tot.total - tot.round_off - tot.tcs_amount);
  const rate = s.currency && s.currency !== 'INR' && Number(s.fx) > 0 ? Number(s.fx) : 1;
  const r = showTcs ? tourTcs({ date: s.date, base: base * rate, prior: priorTourBase(invoices, buyerKey(s.client), s.date, s.id), pan: s.client?.pan, nonResident: nr, components: comps, force }) : null;
  return (
    <>
      <div style={line} data-tv-pos={pos.key}>
        <span className={controls.label}>{tvdT('posHead')}</span>
        <span className={controls.hint} role="note">{tvdT(`pos.${pos.key}`)}{/^\d\d$/.test(pos.state) && pos.state !== '96' ? ` · ${stateByCode(pos.state)?.name ?? pos.state}` : ''}</span>
        {pos.note && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={usePos} data-tv-pos-apply>{tvdT('posApply')}</button>}
        {pos.exempt && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => st().patch({ tv: { ...st().tv, ...tvSnapshot(trip, 'exempt_outside', s.date) } })} data-tv-exempt>{tvdT('useExempt')}</button>}
        {pos.hotel && <span className={controls.hint}>{tvdT('hotel')}</span>}
        {exp && <span className={controls.hint} data-tv-export={exp.verdict}>{tvdT('exportChk', { ok: exp.ok, of: exp.of, v: tvdList('verdicts', VERDICTS, exp.verdict) })}</span>}
        {t.kind === 'event' && <span className={controls.hint}>{tvdT('feeRule', eventRule(s.date))}</span>}
      </div>
      {r && (
        <div style={line} data-tv-tcs={r.status}>
          <span className={controls.label}>{tvdT('tcsHead')}</span>
          <span className={controls.hint} role="note" data-tv-tcs-calc>
            {r.status === 'ok' ? `${tvdT('tcsCalc', { rate: r.rate, amount: formatCurrency(r.amount) })} · ${r.label}${r.slab ? ` (${r.slab})` : ''}` : tvdT(r.status === 'not_package' ? 'notPackage' : r.status === 'non_resident' ? 'nonResident' : 'off')}
            {r.noPan ? ` · ${tvdT('noPan')}` : ''}
          </span>
          <label className={controls.check}><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} data-tv-tcs-force /> {tvdT('tcsForce')}</label>
          <label className={controls.check}><input type="checkbox" checked={nr} onChange={(e) => setNr(e.target.checked)} data-tv-tcs-nr /> {tvdT('tcsNr')}</label>
          {r.status !== 'off' && <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => st().patch(tcsPatch(r, base, baseKind, st().tv, { force }))} data-tv-tcs-apply>{tvdT('tcsApply')}</button>}
        </div>
      )}
    </>
  );
}
