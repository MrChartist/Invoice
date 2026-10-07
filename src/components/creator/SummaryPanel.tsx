import { NumberInput } from '../ui/NumberInput';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { amountInWords } from '../../lib/amount-in-words';
import { cn, currencySymbol, formatCurrency } from '../../lib/utils';
import type { GstMode } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './SummaryPanel.module.css';

const GST_MODES: { id: GstMode; label: string }[] = [
  { id: 'CGST_SGST', label: 'CGST + SGST (same state)' },
  { id: 'IGST', label: 'IGST (other state)' },
  { id: 'SINGLE', label: 'Single “Tax” line' },
  { id: 'NONE', label: 'No tax' },
];

function Row({ label, children, tone, strong }: { label: React.ReactNode; children: React.ReactNode; tone?: 'good' | 'muted'; strong?: boolean }) {
  return (
    <div className={cn(styles.row, strong && styles.strong, tone === 'good' && styles.good, tone === 'muted' && styles.muted)}>
      <span>{label}</span>
      <span className={styles.value}>{children}</span>
    </div>
  );
}

export function SummaryPanel() {
  const s = useInvoiceStore();
  const t = s.totals;
  const cur = s.currency;
  const sym = currencySymbol(cur);
  const money = (n: number) => formatCurrency(n, cur);
  const challan = s.doc_type === 'DELIVERY_CHALLAN';

  return (
    <div className={styles.panel}>
      <Row label="Subtotal">{money(t.subtotal)}</Row>
      {t.line_discount_total > 0 && (
        <Row label="Line discounts" tone="good">
          −{money(t.line_discount_total)}
        </Row>
      )}

      <div className={styles.inputRow}>
        <span>Extra discount</span>
        <div className={styles.inline}>
          <div className={controls.segment}>
            <button type="button" className={s.discount_type === 'PERCENT' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => s.setDiscount('PERCENT', s.discount_rate)} aria-pressed={s.discount_type === 'PERCENT'}>
              %
            </button>
            <button type="button" className={s.discount_type === 'AMOUNT' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => s.setDiscount('AMOUNT', s.discount_rate)} aria-pressed={s.discount_type === 'AMOUNT'}>
              {sym || '₹'}
            </button>
          </div>
          <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.discount_rate} onChange={(n) => s.setDiscount(s.discount_type, n)} placeholder="0" aria-label="Extra discount" />
        </div>
      </div>
      {t.invoice_discount_amount > 0 && (
        <Row label="Discount applied" tone="good">
          −{money(t.invoice_discount_amount)}
        </Row>
      )}

      <Row label="Taxable value" tone="muted">
        {money(t.taxable_value)}
      </Row>

      {!challan && (
        <div className={styles.inputRow}>
          <span>GST treatment</span>
          <select className={cn(controls.select, styles.gstSelect)} value={s.gst_mode} onChange={(e) => s.setGstMode(e.target.value as GstMode)} aria-label="GST treatment">
            {GST_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {s.gst_mode === 'CGST_SGST' && (
        <>
          <Row label="CGST">{money(t.cgst_amount)}</Row>
          <Row label="SGST">{money(t.sgst_amount)}</Row>
        </>
      )}
      {s.gst_mode === 'IGST' && <Row label="IGST">{money(t.igst_amount)}</Row>}
      {s.gst_mode === 'SINGLE' && <Row label="Tax">{money(t.tax_amount)}</Row>}

      <div className={styles.inputRow}>
        <span>Shipping</span>
        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.shipping} onChange={s.setShipping} placeholder="0.00" aria-label="Shipping" />
      </div>
      <div className={styles.inputRow}>
        <span>Other charges</span>
        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.other_charges} onChange={s.setOtherCharges} placeholder="0.00" aria-label="Other charges" />
      </div>

      <label className={cn(controls.check, styles.checkRow)}>
        <input type="checkbox" checked={s.round_off_enabled} onChange={(e) => s.setRoundOff(e.target.checked)} />
        Round off to the nearest rupee
        {t.round_off !== 0 && <span className={styles.roundVal}>{t.round_off > 0 ? '+' : '−'}{Math.abs(t.round_off).toFixed(2)}</span>}
      </label>

      {!challan && (
        <>
          <div className={styles.total}>
            <span>Total</span>
            <span>{money(t.total)}</span>
          </div>
          <p className={styles.words}>{amountInWords(t.total, cur)}</p>

          <div className={styles.inputRow}>
            <span>Amount received</span>
            <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.amount_paid} onChange={s.setAmountPaid} placeholder="0.00" aria-label="Amount received" />
          </div>
          {s.amount_paid > 0 && (
            <Row label="Balance due" strong>
              {money(t.balance_due)}
            </Row>
          )}
        </>
      )}
    </div>
  );
}
