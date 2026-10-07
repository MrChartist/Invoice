import { cn, currencySymbol, formatQuantity } from '../../../lib/utils';
import type { CalcTotals } from '../../../lib/invoice-calc';
import type { InvoiceRecord } from '../../../types/invoice';
import type { TemplateTableStyle } from '../registry';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

interface ItemsTableProps {
  invoice: InvoiceRecord;
  totals: CalcTotals;
  tableStyle: TemplateTableStyle;
}

const STYLE_CLASS: Record<TemplateTableStyle, string | undefined> = {
  lines: undefined,
  zebra: styles.itemsZebra,
  boxed: styles.itemsBoxed,
  band: styles.itemsBand,
};

/**
 * Columns adapt to the document: HSN/SAC, discount and GST columns only appear
 * when they carry information, so a simple service bill stays uncluttered while
 * a GST invoice shows everything a tax invoice must.
 */
export function PaperItemsTable({ invoice, totals, tableStyle }: ItemsTableProps) {
  const { t, money, col } = usePaper();
  const lines = totals.lines;
  const symbol = currencySymbol(invoice.currency);
  const taxed = invoice.gst_mode !== 'NONE' && totals.tax_amount > 0;
  const showHsn = col.hsn && lines.some((l) => l.hsn);
  const showDiscount = col.discount && totals.line_discount_total > 0;
  const showUnit = col.unit && lines.some((l) => l.unit);
  const showTaxable = taxed && col.taxable;
  const showGst = taxed && col.taxRate;

  return (
    <table className={cn(styles.items, STYLE_CLASS[tableStyle])}>
      <thead>
        <tr>
          <th className={styles.center} style={{ width: 26 }}>
            #
          </th>
          <th>{t('desc')}</th>
          {showHsn && <th className={styles.center} style={{ width: 66 }}>{t('hsn')}</th>}
          <th className={styles.right} style={{ width: showUnit ? 74 : 50 }}>
            {t('qty')}
          </th>
          <th className={styles.right} style={{ width: 78 }}>
            {t('rate')}
          </th>
          {showDiscount && <th className={styles.right} style={{ width: 52 }}>{t('disc')}</th>}
          {showTaxable && <th className={styles.right} style={{ width: 82 }}>{t('taxable')}</th>}
          {showGst && <th className={styles.right} style={{ width: 46 }}>{t('gst')}</th>}
          <th className={styles.right} style={{ width: 92 }}>
            {t('amount')} ({symbol})
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => {
          const source = invoice.items.find((i) => i.id === line.id);
          return (
            <tr key={line.id}>
              <td className={cn(styles.center, styles.num)}>{index + 1}</td>
              <td>
                <div className={styles.itemName}>{line.name || '—'}</div>
                {source?.description && <div className={styles.itemDesc}>{source.description}</div>}
              </td>
              {showHsn && <td className={cn(styles.center, styles.num)}>{line.hsn || '—'}</td>}
              <td className={cn(styles.right, styles.num)}>
                {formatQuantity(line.quantity)}
                {col.unit && line.unit ? ` ${line.unit}` : ''}
              </td>
              <td className={cn(styles.right, styles.num)}>{money(line.rate, invoice.currency)}</td>
              {showDiscount && (
                <td className={cn(styles.right, styles.num)}>
                  {source?.discount_percent ? `${source.discount_percent}%` : '—'}
                </td>
              )}
              {showTaxable && (
                <td className={cn(styles.right, styles.num)}>
                  {money(line.taxable, invoice.currency)}
                </td>
              )}
              {showGst && <td className={cn(styles.right, styles.num)}>{line.tax_rate}%</td>}
              <td className={cn(styles.right, styles.num)} style={{ fontWeight: 700 }}>
                {money(taxed ? line.total : line.taxable, invoice.currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
