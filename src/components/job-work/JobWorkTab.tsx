import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MfgContext } from '../manufacturing/context';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { unitsDb } from '../../lib/units';
import { vendorsDb } from '../../lib/vendors';
import {
  challanBalances, jobWorkAlerts, jobWorkOrdersDb, materialInDb, materialOutDb, principalDb,
} from '../../lib/job-work';
import type { Client } from '../../types/invoice';
import { jwT } from '../../i18n/areas/job-work';
import { OrdersPanel } from './OrdersPanel';
import { MaterialOutPanel } from './MaterialOutPanel';
import { MaterialInPanel } from './MaterialInPanel';
import { PrincipalPanel } from './PrincipalPanel';
import { ClocksPanel } from './ClocksPanel';
import { Itc04Panel } from './Itc04Panel';
import type { JwData } from './lines';
import { qtyText } from './lines';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

type Section = 'orders' | 'out' | 'in' | 'principal' | 'clocks' | 'itc04';
const SECTIONS: Section[] = ['out', 'in', 'orders', 'principal', 'clocks', 'itc04'];
const LABEL = { orders: 'secOrders', out: 'secOut', in: 'secIn', principal: 'secPrincipal', clocks: 'secClocks', itc04: 'secItc04' } as const;

/** /manufacturing?tab=jobwork — job work out / in, return clocks and ITC-04 (Phase 7M). */
export function JobWorkTab({ ctx }: { ctx: MfgContext }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('jw') as Section | null;
  const section: Section = raw && SECTIONS.includes(raw) ? raw : 'out';
  const setSection = useCallback((s: Section) => setParams((p) => { p.set('jw', s); return p; }, { replace: true }), [setParams]);

  const data = useMemo((): JwData => {
    void ctx.version;
    const today = todayInput();
    const outs = materialOutDb.all();
    const ins = materialInDb.all();
    return {
      ctx, today, outs, ins,
      orders: jobWorkOrdersDb.all(),
      principal: principalDb.all(),
      balances: challanBalances(outs, ins, today),
      units: unitsDb.stored(),
      ownGodowns: ctx.godowns.filter((g) => !g.job_worker),
      jwGodowns: ctx.godowns.filter((g) => g.job_worker),
      parties: vendorsDb.all().map((v) => ({ id: v.id, name: v.name, gstin: v.gstin, state_code: v.state_code })),
      clients: getTable<Client>('clients').filter((c) => c?.id && c.name).map((c) => ({ id: c.id as string, name: c.name, gstin: c.gstin, state_code: c.state_code })),
    };
  }, [ctx]);
  const alerts = useMemo(() => jobWorkAlerts(data.balances), [data.balances]);
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const itemUnit = (id: string) => ctx.items.find((i) => i.id === id)?.unit ?? '';

  return (
    <>
      <p className={styles.muted} style={{ margin: '0 0 0.75rem' }}>{jwT('intro')}</p>
      {alerts.length > 0 && (
        <ul className={styles.alerts} aria-label={jwT('alertsTitle')}>
          {alerts.slice(0, 6).map((a) => {
            const l = a.line;
            const vars = { number: l.number, qty: qtyText(l.pending), unit: itemUnit(l.item_id), item: itemName(l.item_id), party: l.party, date: l.deadline, sent: l.date, days: l.daysLeft ?? 0 };
            return (
              <li key={`${l.lineId}`} className={`${styles.notice} ${a.level === 'danger' ? styles.danger : ''}`} role={a.level === 'danger' ? 'alert' : 'status'}>
                {a.level === 'danger' ? jwT('alertDanger', vars) : jwT('alertWarning', vars)}
              </li>
            );
          })}
        </ul>
      )}
      <div className={`${controls.segment} ${styles.tabs}`} role="tablist" aria-label={jwT('sections')}>
        {SECTIONS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setSection(s)}>
            {jwT(LABEL[s])}
          </button>
        ))}
      </div>
      {!ctx.canBooks && <p className={styles.muted}>{jwT('readOnly')}</p>}
      {section === 'orders' && <OrdersPanel data={data} goTo={setSection} />}
      {section === 'out' && <MaterialOutPanel data={data} />}
      {section === 'in' && <MaterialInPanel data={data} />}
      {section === 'principal' && <PrincipalPanel data={data} />}
      {section === 'clocks' && <ClocksPanel data={data} />}
      {section === 'itc04' && <Itc04Panel data={data} />}
    </>
  );
}
