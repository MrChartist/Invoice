import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Download, Minus } from 'lucide-react';
import { downloadCsv } from '../books/download';
import controls from '../../styles/controls.module.css';
import styles from './reports.module.css';

/** Inline % bar + number, for the "share of sales" columns. */
export function Share({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <span className={styles.share}>
      <span className={styles.shareTrack} aria-hidden="true">
        <span className={styles.shareFill} style={{ width: `${w}%` }} />
      </span>
      <span>{value.toFixed(1)}%</span>
    </span>
  );
}

/** Year-on-year change with an arrow (colour is never the only signal). */
export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className={styles.muted}>—</span>;
  const cls = value > 0 ? styles.pos : value < 0 ? styles.neg : '';
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`${styles.delta} ${cls}`}>
      <Icon size={13} aria-hidden="true" />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

export function ExportButton({ filename, csv }: { filename: string; csv: () => string }) {
  return (
    <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(filename, csv())}>
      <Download size={16} /> Export CSV
    </button>
  );
}

export function InvoiceLink({ id, children }: { id: string; children: React.ReactNode }) {
  return id ? (
    <Link to={`/invoice/${id}`} className={styles.link}>{children}</Link>
  ) : (
    <>{children}</>
  );
}
