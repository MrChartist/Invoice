import type { ProductionOrderStatus } from '../../types/production-r4';
import { pT } from '../../i18n/areas/production-r4';
import styles from './production.module.css';

const KEY = { planned: 'stPlanned', released: 'stReleased', in_progress: 'stInProgress', completed: 'stCompleted', closed: 'stClosed', cancelled: 'stCancelled' } as const;

/** Status pill of a production order. */
export function StatusBadge({ status }: { status: ProductionOrderStatus }) {
  return <span className={`${styles.status} ${styles[status] ?? ''}`}>{pT(KEY[status])}</span>;
}
