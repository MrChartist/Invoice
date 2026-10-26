/**
 * GST → Hotel (R7-C1, tab `hotel-gst`, listed with the hotel pack; its URL always opens it). Specified-premises status
 * for this and the next FY with its evidence, the declarations register (Annexure VII / VIII / IX), the band report and
 * its common-credit input (D12), the guards and the GSTR-1 HSN / SAC 9963 rows. A working paper — verify with your CA.
 * With the pack off nothing hotel is read. Lives in the pack's chunk (reached through `hotel-lazy.ts`).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, ShieldCheck } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type { PremisesDecl } from '../../types/hotel-r7';
import { useT } from '../../i18n';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { cT, type CKey } from '../../i18n/areas/hotel-compliance-r7';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { todayIso } from '../../lib/tax-rules';
import { hotelDb } from '../../lib/hotel/hotel-store';
import { fyName, fyOfDay, fyRange, hotelGuards, restaurantRate, rupees } from '../../lib/hotel/hotel-gst';
import { addDecl, premisesNow, removeDecl, setPrevFyValue, type PremisesStatus } from '../../lib/hotel/premises';
import { bandReport, hsn9963 } from '../../lib/hotel/band-report';
import { B, errText } from '../transport/shared';
import { Fields, Row, type Rec } from './FrontDesk';
import { Report } from './ckit';
import styles from './hotel.module.css';

const ANNEX = { opt_in: 'VII', new_reg_opt_in: 'VIII', opt_out: 'IX' } as const;

function evidence(st: PremisesStatus, fy: number): string {
  const p = fyName(fy - 1);
  const x = st.prev;
  const v = x ? rupees(x.value) : '';
  if (!st.rule) return cT('ev.pre');
  if (st.basis === 'previous_fy_value' && x) {
    return cT(x.source === 'stays' ? 'ev.stays' : 'ev.typed', { room: x.room ?? '', v, d: x.night ?? '', p });
  }
  if (st.decl && st.basis !== 'none') return cT('ev.decl', { a: ANNEX[st.decl.kind], d: st.decl.filed_on, ref: st.decl.ref ?? '' });
  return cT(x ? 'ev.low' : 'ev.none', { p, v });
}

export default function HotelGstTab({ notify }: { notify: (m: string, tone?: 'success' | 'error') => void }) {
  useT();
  const cur = fyOfDay(todayIso());
  const [f, setF] = useState<Rec>({ fy: String(cur), dfy: fyName(cur + 1), kind: 'opt_in', filed_on: todayIso() });
  const [tick, setTick] = useState(0);
  const on = isPackOn(localDb.settings.get(), 'hotel');
  const fy = Number(f.fy);
  const d = useMemo(() => {
    if (!on) return null;
    const inv = getTable<InvoiceRecord>('invoices');
    const s = hotelDb.settings();
    const memo = new Map<number, PremisesStatus>();
    const status = (y: number) => memo.get(y) ?? memo.set(y, premisesNow(y)).get(y)!;
    const sac = { room: s.sac_room, fnb: s.sac_fnb };
    const { from, to } = fyRange(fy);
    return { s, status, bands: bandReport(inv, from, to, sac), hsn: hsn9963(inv, from, to), guards: hotelGuards(inv, getTable('purchases'), (y) => status(y).specified, from, to, sac) };
  }, [on, fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className={styles.note} data-hotel-gst-off>{cT('packOff')}</p>;
  const run = (fn: () => void) => {
    try {
      fn();
      notify(hT('saved'));
      setTick((n) => n + 1);
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const prev = fyName(fy - 1);
  const decls = d.s.premises ?? [];
  const set = (p: Rec) => setF({ ...f, ...p });
  return (
    <div className={styles.stack} data-hotel-gst>
      <Row>
        <Fields v={f} set={set} spec={[['fy', cT('fy'), [cur - 2, cur - 1, cur, cur + 1].map((y) => [String(y), fyName(y)] as const)], ['prev', cT('prev', { p: prev }), 'n']]} />
        <button type="button" className={B.o} onClick={() => run(() => setPrevFyValue(prev, Number(f.prev) || 0))} data-prev-save>{hT('save')}</button>
      </Row>
      {localDb.settings.activeProfile()?.gst_scheme === 'composition' && <p className={styles.warn}>{cT('comp')}</p>}
      <div className={styles.grid}>
        {[fy, fy + 1].map((y) => {
          const st = d.status(y);
          const rr = restaurantRate(st, `${y}-04-01`);
          return (
            <div key={y} className={styles.box} data-premises={fyName(y)} data-specified={st.specified ? 'yes' : 'no'}>
              <strong><ShieldCheck size={16} aria-hidden="true" /> {cT('fy')} {fyName(y)}: {cT(st.specified ? 'spec' : 'notSpec')}</strong>
              <span>{evidence(st, y)}</span>
              {st.optOutIgnored && <span className={styles.warn}>{cT('byLaw')}</span>}
              <span data-fnb-rate={rr.rate}>{cT('fnbRate', { r: rr.rate, itc: cT(rr.itc ? 'withItc' : 'noItc') })}</span>
            </div>
          );
        })}
      </div>

      <section className={styles.box} data-decls>
        <strong>{cT('decls')}</strong>
        {decls.map((x, i) => (
          <Row key={i}>{x.fy} · {cT(`k.${x.kind}`)} · {x.filed_on} {x.ref} {x.arn_on}
            <button type="button" className={B.gs} onClick={() => run(() => removeDecl(i))}>{hT('remove')}</button></Row>
        ))}
        <Row>
          <Fields v={f} set={set} spec={[['dfy', cT('fy')], ['kind', cT('kind'), Object.keys(ANNEX).map((k) => [k, cT(`k.${k}` as CKey)] as const)], ['filed_on', cT('filedOn'), 'd'], ['ref', cT('ref')], ['arn_on', cT('arn'), 'd']]} />
          <button type="button" className={B.p} data-decl-add onClick={() => run(() => addDecl({
            fy: String(f.dfy), kind: f.kind as PremisesDecl['kind'], filed_on: String(f.filed_on), ...(f.ref ? { ref: String(f.ref) } : {}),
            ...(f.kind === 'new_reg_opt_in' && f.arn_on ? { arn_on: String(f.arn_on) } : {}),
          }))}>{hT('add')}</button>
        </Row>
      </section>

      <Report title={cT('bands')} file={`hotel-bands-${fyName(fy)}`} head={[cT('month'), cT('lowN'), cT('lowV'), cT('highN'), cT('highV'), cT('fnb'), cT('noItcT'), cT('itcT')]}
        rows={d.bands.map((r) => [r.month, r.low.nights, rupees(r.low.value), r.high.nights, rupees(r.high.value), rupees(r.fnb), rupees(r.noItc), rupees(r.withItc)])} />
      <Row>
        <Landmark size={16} aria-hidden="true" /> <span data-cc-input>{cT('cc', { e: rupees(d.bands.reduce((s, r) => s + r.noItc, 0)) })}</span>
        <Link className={B.os} to="/gst-reports?tab=common-credit">{cT('ccOpen')}</Link>
      </Row>
      <section className={styles.box} data-hotel-guards>
        <strong>{cT('checks')}</strong>
        {d.guards.map((g, i) => <span key={i} className={styles.warn} data-guard={g.kind}>{cT(`g.${g.kind}`, { no: g.number, d: g.date, got: g.got ?? '', exp: g.expect ?? '', v: rupees(g.amount ?? 0) })}</span>)}
        {!d.guards.length && <span className={styles.note}>{cT('ok')}</span>}
        {fy === 2025 && <span className={styles.note}>{cT('sep22')}</span>}
      </section>
      <Report title={cT('hsn')} file={`hsn-9963-${fyName(fy)}`} head={['SAC', cT('rate'), cT('qty'), cT('taxable'), 'GST']}
        rows={d.hsn.map((r) => [r.hsn, r.rate, r.qty, rupees(r.taxable), rupees(r.tax)])} />
      <p className={styles.note}>{cT('verify')}</p>
    </div>
  );
}
