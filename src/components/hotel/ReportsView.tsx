/**
 * Front desk → Reports (R7-C3, cut-first applied): occupancy / ADR / RevPAR by day (night audits, else stays) with an
 * inline CSS bar, by month and by room type; source mix; night-audit history (with guest ledger and advances held); the
 * police / guest register (Guests view, printable). Tables only, CSV / Excel each. Reads, never writes.
 */
import { useMemo, useState } from 'react';
import { BarChart3, FileText } from 'lucide-react';
import { hT, type HKey } from '../../i18n/areas/hotel-frontdesk-r7';
import { cT } from '../../i18n/areas/hotel-compliance-r7';
import type { AuditStats } from '../../types/hotel-r7';
import { hotelDb } from '../../lib/hotel/hotel-store';
import { byMonth, byRoomType, occupancyByDay, sourceMix } from '../../lib/hotel/hotel-reports';
import { rupees } from '../../lib/hotel/hotel-gst';
import { B } from '../transport/shared';
import { Report } from './ckit';
import { Fields, Row, type Ctx, type Rec } from './FrontDesk';
import styles from './hotel.module.css';

const SECTIONS = ['occ', 'month', 'type', 'source', 'audits'] as const;

const stat = (s: AuditStats) => [s.available, s.occupied, s.complimentary + s.house, s.ooo, `${s.occupancy}%`, rupees(s.room_revenue), rupees(s.adr), rupees(s.revpar)];

export default function ReportsView({ ctx }: { ctx: Ctx }) {
  const [p, setP] = useState<Rec>({ from: `${ctx.day.slice(0, 7)}-01`, to: ctx.day, sec: 'occ' });
  const d = useMemo(() => ({
    rooms: hotelDb.rooms(), types: hotelDb.roomTypes(), reservations: hotelDb.reservations(), folios: hotelDb.folios(), audits: hotelDb.audits(),
  }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = String(p.from);
  const to = String(p.to);
  const sec = p.sec as (typeof SECTIONS)[number];
  const head = [hT('available'), hT('occupied'), cT('comp2'), hT('ooo'), hT('occupancy'), hT('revenue'), 'ADR', 'RevPAR'];
  const days = sec === 'occ' || sec === 'month' ? occupancyByDay(from, to, d) : [];
  const [h, rows]: [string[], (string | number)[][]] =
    sec === 'occ' ? [[cT('day'), ...head, cT('basis')], days.map((r) => [r.day, ...stat(r), cT(`b.${r.basis}`)])]
    : sec === 'month' ? [[cT('month'), ...head], byMonth(days).map((r) => [r.month, ...stat(r)])]
    : sec === 'type' ? [[hT('roomType'), ...head], byRoomType(from, to, d).map((r) => [r.type, ...stat(r)])]
    : sec === 'source' ? [[hT('source'), hT('nights'), hT('revenue')], sourceMix(from, to, d.reservations, d.folios).map((r) => [Object.hasOwn(hT.en, `src.${r.source}`) ? hT(`src.${r.source}` as HKey) : r.source, r.nights, rupees(r.revenue)])]
    : [[cT('day'), ...head, hT('ledger'), hT('advances')], d.audits.filter((a) => a.business_date >= from && a.business_date <= to).map((a) => [a.business_date, ...stat(a.stats), rupees(a.guest_ledger), rupees(a.advances_held)])];
  return (
    <div className={styles.stack} data-hotel-reports>
      <Row>
        <Fields v={p} set={(x) => setP({ ...p, ...x })} spec={[['from', 'from', 'd'], ['to', 'to', 'd']]} />
        <button type="button" className={B.o} onClick={() => ctx.go('guests')}><FileText size={16} aria-hidden="true" /> {cT('r.reg')}</button>
      </Row>
      <Row>
        {SECTIONS.map((s) => <button key={s} type="button" aria-pressed={sec === s} className={sec === s ? styles.viewOn : styles.view} onClick={() => setP({ ...p, sec: s })} data-hotel-report-tab={s}>{cT(`r.${s}`)}</button>)}
      </Row>
      <Report title={cT(`r.${sec}`)} file={`hotel-${sec}_${from}_${to}`} head={h} rows={rows} bars={sec === 'occ' ? days.map((r) => r.occupancy) : undefined} extra={<BarChart3 size={16} aria-hidden="true" />} />
      <p className={styles.note}>{hT('workingPaper')}</p>
    </div>
  );
}
