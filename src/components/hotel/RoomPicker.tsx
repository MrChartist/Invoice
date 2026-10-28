/**
 * R7-B2 "Room" settle / tender (rendered only with the hotel pack on; loaded through the FrontDesk chunk): a pick-list of
 * in-house rooms with the primary guest's surname. Tables passes `order` (the order settles onto the folio), the POS
 * passes `record` (one line, no POS bill). An optional signature slip prints after the charge.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { bT } from '../../i18n/areas/hotel-billing-r7';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { chargeOrderToRoom, chargePosToRoom, inHouseRooms } from '../../lib/hotel/charge-to-room';
import { formatMoney } from '../../lib/utils';
import { hotelDb } from '../../lib/hotel/hotel-store';
import { errText, printHtml } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { escHtml as esc } from '../../lib/html-esc';


export default function RoomPicker({ order, record, onDone, notify }: { order?: string; record?: InvoiceRecord; onDone: () => void; notify: (m: string, tone?: 'success' | 'error') => void }) {
  useT();
  const rooms = inHouseRooms();
  const pick = (i: number) => {
    const r = rooms[i];
    if (!r) return;
    try {
      const f = order ? hotelDb.folios().find((x) => x.id === chargeOrderToRoom(order, r).folio_id) : chargePosToRoom(record!, r);
      const l = f?.lines[f.lines.length - 1];
      notify(bT('charged', { r: r.room }));
      if (l && window.confirm(bT('sig'))) printHtml(`<h3>${hT('room')} ${esc(r.room)} · ${esc(r.guest)}</h3><p>${esc(l.desc)}: ${formatMoney(l.amount)}</p><p><br>${hT('signature')}: ________________</p>`, `room-${r.room}`);
      onDone();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <select className={controls.select} value="" onChange={(e) => e.target.value && pick(Number(e.target.value))} aria-label={bT('roomCharge')} data-room-tender>
      <option value="">{rooms.length ? `${hT('room')} →` : bT('noRooms')}</option>
      {rooms.map((r, i) => <option key={r.lineId} value={i}>{r.room} · {r.guest}</option>)}
    </select>
  );
}
