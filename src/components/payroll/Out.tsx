import { Download } from 'lucide-react';
import controls from '../../styles/controls.module.css';
import styles from './Payroll.module.css';
import { exportRows, type Rows } from './shared';

/** CSV + Excel export buttons for a working paper (7P screens); rows are built on click. */
export function Out({ base, rows, sheet }: { base: string; rows: () => Rows; sheet: string }) {
  return (
    <span className={styles.inline}>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportRows(base, rows(), 'csv', sheet)}><Download size={14} /> CSV</button>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportRows(base, rows(), 'xlsx', sheet)}><Download size={14} /> Excel</button>
    </span>
  );
}
