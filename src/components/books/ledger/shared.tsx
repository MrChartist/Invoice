import { Download, Info, Printer } from 'lucide-react';
import { downloadCsv } from '../download';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { CA_NOTE } from './format';

/** Toolbar with the "verify with your CA" badge, Print and CSV buttons. Hidden when printing. */
export function StatementToolbar({ csv, filename, children }: { csv?: () => string; filename: string; children?: React.ReactNode }) {
  return (
    <div className={`${books.toolbar} no-print`}>
      <div className={books.toolbarGroup}>
        <span className={books.indicative}>
          <Info size={13} aria-hidden="true" /> Verify with your CA
        </span>
        {children}
      </div>
      <div className={books.toolbarGroup}>
        <button type="button" className={controls.btnOutline} onClick={() => window.print()}>
          <Printer size={16} /> Print
        </button>
        {csv && (
          <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(filename, csv())}>
            <Download size={16} /> Export CSV
          </button>
        )}
      </div>
    </div>
  );
}

/** Title block that only shows on paper. */
export function PrintTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className={styles.printTitle}>
      {title}
      <div className={books.muted}>{sub} · {CA_NOTE}</div>
    </div>
  );
}
