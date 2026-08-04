import { cn, currencySymbol, formatMoney, formatQuantity } from '../../../lib/utils';
import type { CalcTotals } from '../../../lib/invoice-calc';
import type { InvoiceRecord } from '../../../types/invoice';
import type { TemplateTableStyle } from '../registry';
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
  const lines = totals.lines;
  const symbol = currencySymbol(invoice.currency);
  const taxed = invoice.gst_mode !== 'NONE' && totals.tax_amount > 0;
  const showHsn = lines.some((l) => l.hsn);
  const showDiscount = totals.line_discount_total > 0;
  const showUnit = lines.some((l) => l.unit);

  return (
    <table className={cn(styles.items, STYLE_CLASS[tableStyle])}>
      <thead>
        <tr>
          <th className={styles.center} style={{ width: 26 }}>
            #
          </th>
          <th>Description</th>
          {showHsn && <th className={styles.center} style={{ width: 66 }}>HSN/SAC</th>}
          <th className={styles.right} style={{ width: showUnit ? 74 : 50 }}>
            Qty
          </th>
          <th className={styles.right} style={{ width: 78 }}>
            Rate
          </th>
          {showDiscount && <th className={styles.right} style={{ width: 52 }}>Disc</th>}
          {taxed && <th className={styles.right} style={{ width: 82 }}>Taxable</th>}
          {taxed && <th className={styles.right} style={{ width: 46 }}>GST</th>}
          <th className={styles.right} style={{ width: 92 }}>
            Amount ({symbol})
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
                {line.unit ? ` ${line.unit}` : ''}
              </td>
              <td className={cn(styles.right, styles.num)}>{formatMoney(line.rate, invoice.currency)}</td>
              {showDiscount && (
                <td className={cn(styles.right, styles.num)}>
                  {source?.discount_percent ? `${source.discount_percent}%` : '—'}
                </td>
              )}
              {taxed && (
                <td className={cn(styles.right, styles.num)}>
                  {formatMoney(line.taxable, invoice.currency)}
                </td>
              )}
              {taxed && <td className={cn(styles.right, styles.num)}>{line.tax_rate}%</td>}
              <td className={cn(styles.right, styles.num)} style={{ fontWeight: 700 }}>
                {formatMoney(taxed ? line.total : line.taxable, invoice.currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
