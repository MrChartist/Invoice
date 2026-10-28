/** R7-C report block shared by GST → Hotel and the hotel reports (in the pack's chunk). */
import type { ReactNode } from 'react';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { cT } from '../../i18n/areas/hotel-compliance-r7';
import { B, csvDownload } from '../transport/shared';
import { Row, Tbl } from './FrontDesk';
import styles from './hotel.module.css';

/** A table with CSV / Excel export (existing writers; the XLSX writer loads on demand); `bars` adds a CSS-width bar. */
export function Report({ title, file, head, rows, extra, bars }: { title: string; file: string; head: string[]; rows: (string | number)[][]; extra?: ReactNode; bars?: number[] }) {
  const all = [head, ...rows.map((r) => r.map(String))];
  const xlsx = () => import('../../lib/xlsx').then((x) => x.downloadXlsx(`${file}.xlsx`, [{ name: title.slice(0, 31), rows: x.csvRowsToCells(all) }]));
  return (
    <section className={styles.stack} data-hotel-report={file}>
      <Row>
        <strong>{title}</strong>
        <button type="button" className={B.os} onClick={() => csvDownload(`${file}.csv`, all)}>{hT('csv')}</button>
        <button type="button" className={B.os} onClick={() => void xlsx()}>{cT('xlsx')}</button>
        {extra}
      </Row>
      <Tbl head={bars ? [...head, ''] : head} rows={bars ? rows.map((r, i) => [...r, <span key="b" className={styles.meter} style={{ width: `${Math.min(100, bars[i]) * 0.06}rem` }} />]) : rows} />
    </section>
  );
}
