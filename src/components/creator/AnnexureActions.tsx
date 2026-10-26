import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type {} from '../../types/service-r3';
import { annexureRows, billedRefs, buildAnnexure, tieOut } from '../../lib/annexure';
import { annexureContext, readTimePrefs, timeDb } from '../../lib/timesheets';
import { purchasesDb } from '../../lib/purchases';
import { localDb } from '../../lib/localDb';
import { isLocked } from '../../lib/period-lock';
import { can } from '../../lib/access';
import { downloadText, toCsv } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './DocumentActions.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';

const stem = (n: string) => (n || 'invoice').replace(/[^\w-]+/g, '-');

/**
 * R3-B4 document actions for an invoice with a timesheet annexure: download it (CSV / XLSX), see whether
 * it still ties to the lines (editor only, never on paper) and refresh it from the billed rows on request.
 */
export default function AnnexureActions({ invoice, onChanged }: { invoice: InvoiceRecord; onChanged: () => void }) {
  useT();
  const [error, setError] = useState('');
  const a = invoice.annexure;
  const tie = useMemo(() => (a ? tieOut(a, invoice.items ?? []) : null), [a, invoice.items]);
  if (!a) return null;

  const download = async (format: 'csv' | 'xlsx') => {
    const rows = annexureRows(a);
    const base = `annexure-${stem(invoice.invoice_number)}`;
    if (format === 'csv') return downloadText(`${base}.csv`, '﻿' + toCsv(rows), 'text/csv');
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`${base}.xlsx`, [{ name: 'Annexure', rows }]);
  };

  const refresh = () => {
    try {
      const refs = billedRefs(invoice.items ?? []);
      const sel = { time: timeDb.all().filter((e) => refs.has(e.id)), expenses: purchasesDb.all().filter((p) => refs.has(p.id)) };
      const annexure = buildAnnexure(sel, readTimePrefs(), annexureContext());
      localDb.invoices.save({ ...invoice, annexure });
      setError('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const money = (n: number) => formatCurrency(n, invoice.currency);
  return (
    <div className={styles.row} role="group" aria-label={svcT('annexure')} data-annexure-actions>
      <span>{svcT('annexure')} · {svcT('annexureRows', { n: a.rows.length, e: a.expenses?.length ?? 0 })}</span>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void download('csv')} data-download-annexure>
        <Download size={15} /> {svcT('downloadAnnexure')} CSV
      </button>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void download('xlsx')}>
        <FileSpreadsheet size={15} /> Excel
      </button>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} disabled={isLocked(invoice) || !can('doc.edit')} onClick={refresh}>
        <RefreshCw size={15} /> {svcT('refreshAnnexure')}
      </button>
      {tie && !tie.ok && <span role="status" data-annexure-mismatch>{svcT('annexureMismatch', { a: money(tie.annexure_amount), l: money(tie.line_amount) })}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
