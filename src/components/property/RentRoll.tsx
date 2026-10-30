/** R5-C5 rent roll: unit, tenant, current rent, next escalation, deposit held, dues (+ informational interest); CSV. */
import { lateInterest, rentRollCsv, type RentRow } from '../../lib/property/leases';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, Tbl } from '../institutions/Views';
import { csv, rs } from '../institutions/ui';

export function RentRoll({ rows, onEnd }: { rows: readonly RentRow[]; onEnd: (r: RentRow, terminate: boolean) => void }) {
  const h = [iT('property'), iT('unit'), iT('tenant'), iT('start'), iT('end'), iT('rent'), iT('nextEsc'), iT('rent'), iT('deposit'), iT('due'), iT('status')];
  return (
    <div className={styles.stack} data-rent-roll>
      <div><B l={iT('csv')} on={() => csv('rent-roll.csv', rentRollCsv(rows, h))} /></div>
      <Tbl h={[iT('property'), iT('tenant'), iT('rent'), iT('nextEsc'), iT('deposit'), iT('due'), '']} rows={rows.map((r) => [
        `${r.property?.name ?? ''} · ${r.units}`, r.tenant, rs(r.rent), r.next ? `${r.next.date}: ${rs(r.next.from)} → ${rs(r.next.to)}` : '-', rs(r.deposit),
        `${rs(r.dues)}${r.lease.late_fee_pct && r.dues ? ` (+${rs(lateInterest(r.dues, r.lease.late_fee_pct, 30))} / 30 d, info)` : ''}`,
        r.lease.status === 'active' ? <><B g sm l={iT('endLease')} on={() => onEnd(r, false)} /><B g sm l={iT('terminate')} on={() => onEnd(r, true)} /></> : iT(`status.${r.lease.status}`),
      ])} />
    </div>
  );
}
