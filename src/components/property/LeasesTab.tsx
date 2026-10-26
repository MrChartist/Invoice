/**
 * Recurring → Leases (R5-C5 / C6): leases (each bills through an ordinary recurring schedule with escalation),
 * properties & units, the rent roll and the security deposits register. Lazy; listed with the `leases` pack.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Lease } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { loadProperties } from '../../lib/property/properties';
import { endLease, loadLeases, rentRoll } from '../../lib/property/leases';
import { loadDeposits } from '../../lib/property/deposits';
import { useT } from '../../i18n';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, Shell } from '../institutions/Views';
import { attempt, rs, today, useView, type Notify } from '../institutions/ui';
import { LeaseForm } from './LeaseForm';
import { PropertiesPanel } from './PropertiesPanel';
import { RentRoll } from './RentRoll';
import { DepositsPanel } from './DepositsPanel';

const VIEWS = ['leases', 'properties', 'rentroll', 'deposits'] as const;

export default function LeasesTab({ notify }: { notify: Notify }) {
  useT();
  const [view, go] = useView(VIEWS);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const d = useMemo(() => ({ props: loadProperties(), leases: loadLeases(), deposits: loadDeposits(), clients: localDb.clients.getAll() }), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<Lease | null>();
  return (
    <Shell pack="leases" views={VIEWS} view={view} go={go} label={(v) => iT(`leases.${v}`)} note={iT('leasesNote')} d="leases-tab">
      {view === 'leases' && (editing !== undefined ? (
        <LeaseForm key={editing?.id ?? 'new'} lease={editing ?? undefined} props={d.props} notify={notify} onSaved={() => { setEditing(undefined); refresh(); }} />
      ) : (
        <div className={styles.lines}>
          <div><B p l={iT('newLease')} d="lease-new" dis={!d.props.length} on={() => setEditing(null)} /></div>
          {d.leases.map((l) => (
            <div key={l.id} className={styles.line}>
              <strong>{d.clients.find((c) => c.id === l.tenant_id)?.name}</strong>
              <span className={styles.note}>{d.props.find((p) => p.id === l.property_id)?.name} · {l.start} – {l.end} · {rs(l.rent)} · {iT(`cls.${l.gst_class}`)} · {iT(`status.${l.status}`)}</span>
              <B sm l={iT('edit')} on={() => setEditing(l)} />
            </div>
          ))}
        </div>
      ))}
      {view === 'properties' && <PropertiesPanel props={d.props} notify={notify} refresh={refresh} />}
      {view === 'rentroll' && <RentRoll rows={rentRoll(d.leases, d.props, d.clients, localDb.invoices.getAll(), d.deposits, today())} onEnd={(r, t) => {
        const on = window.prompt(iT('endOn'), today());
        if (on) attempt(notify, () => { endLease(r.lease.id, on, t); refresh(); }, iT('saved'));
      }} />}
      {view === 'deposits' && <DepositsPanel deposits={d.deposits} leases={d.leases} notify={notify} refresh={refresh} />}
    </Shell>
  );
}
