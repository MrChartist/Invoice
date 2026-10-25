import { Download, FileSpreadsheet, Info, Printer } from 'lucide-react';
import { downloadCsv } from '../download';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { caNote } from './format';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';

/** Toolbar with the "verify with your CA" badge, Print and CSV buttons. Hidden when printing. */
export function StatementToolbar({ csv, xlsx, filename, children }: {
  csv?: () => string;
  /** Optional Excel export (the dependency-free writer is loaded on click). */
  xlsx?: () => void;
  filename: string;
  children?: React.ReactNode;
}) {
  useT();
  return (
    <div className={`${books.toolbar} no-print`}>
      <div className={books.toolbarGroup}>
        <span className={books.indicative}>
          <Info size={13} aria-hidden="true" /> {ledgerT('verifyCa')}
        </span>
        {children}
      </div>
      <div className={books.toolbarGroup}>
        <button type="button" className={controls.btnOutline} onClick={() => window.print()}>
          <Printer size={16} /> {ledgerT('print')}
        </button>
        {csv && (
          <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(filename, csv())}>
            <Download size={16} /> {ledgerT('exportCsv')}
          </button>
        )}
        {xlsx && (
          <button type="button" className={controls.btnOutline} onClick={xlsx}>
            <FileSpreadsheet size={16} /> {ledgerT('exportExcel')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Title block that only shows on paper. */
export function PrintTitle({ title, sub }: { title: string; sub: string }) {
  useT();
  return (
    <div className={styles.printTitle}>
      {title}
      <div className={books.muted}>{sub} · {caNote()}</div>
    </div>
  );
}
