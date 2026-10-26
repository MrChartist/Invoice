import { lazy, Suspense, useMemo } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { DB_PREFIX, getJson, getTable } from '../../lib/storage';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { amountInWords } from '../../lib/amount-in-words';
import { cn, currencySymbol, formatCurrency } from '../../lib/utils';
import type { GstMode } from '../../types/invoice';
import { amountInWordsHi } from '../../lib/amount-in-words-hi';
import { amountInWordsIn, isWordsLang } from '../../lib/amount-in-words-in';
import { useT, type MessageKey } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import controls from '../../styles/controls.module.css';
import styles from './SummaryPanel.module.css';

// WP-9: loyalty redemption, loaded only while the programme is switched on.
const EditorLoyalty = lazy(() => import('../loyalty/EditorLoyalty'));
const LOYALTY_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
// 7U: sales agent, bill-value offer, prescription — loaded only once one of them is in use.
const EditorExtras = lazy(() => import('../extras7u/EditorExtras'));
// 8.102: live gross margin (hidden from viewers, never printed) — its own chunk.
const MarginChip = lazy(() => import('../invoicing-ux/MarginChip'));
// A3: payment mode + "Fully paid" on Amount received.
const PayModeChips = lazy(() => import('../invoicing-ux/PayModeChips'));

const GST_MODES: { id: GstMode; label: MessageKey }[] = [
  { id: 'CGST_SGST', label: 'summary.modeCgstSgst' },
  { id: 'IGST', label: 'summary.modeIgst' },
  { id: 'SINGLE', label: 'summary.modeSingle' },
  { id: 'NONE', label: 'summary.modeNone' },
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
  const { t: tr, lang } = useT();
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['amount_paid', 'charges_taxable', 'patch', 'currency', 'discount_rate', 'discount_type', 'doc_type', 'gst_mode', 'other_charges', 'round_off_enabled', 'setAmountPaid', 'setDiscount', 'setGstMode', 'setOtherCharges', 'setRoundOff', 'setShipping', 'shipping', 'tcs_label', 'tds_section', 'totals'])),
  );
  const t = s.totals;
  const cur = s.currency;
  const sym = currencySymbol(cur);
  const money = (n: number) => formatCurrency(n, cur);
  const challan = s.doc_type === 'DELIVERY_CHALLAN';
  // Cheap check of the stored programme flag; the loyalty module itself loads only when it is on.
  const loyaltyOn = useMemo(() => getJson<{ enabled?: boolean } | null>(`${DB_PREFIX}loyalty_program`, null)?.enabled === true, []);
  const extrasOn = useMemo(
    () => getTable('sales_agents').length > 0 || getTable<{ kind?: string }>('schemes').some((x) => x?.kind === 'bill_value') || getJson<{ enabled?: boolean } | null>(`${DB_PREFIX}pharma_settings`, null)?.enabled === true,
    [],
  );

  return (
    <div className={styles.panel}>
      <Row label={tr('summary.subtotal')}>{money(t.subtotal)}</Row>
      {t.line_discount_total > 0 && (
        <Row label={tr('summary.lineDiscounts')} tone="good">
          −{money(t.line_discount_total)}
        </Row>
      )}

      <div className={styles.inputRow}>
        <span>{tr('summary.extraDiscount')}</span>
        <div className={styles.inline}>
          <div className={controls.segment}>
            <button type="button" className={s.discount_type === 'PERCENT' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => s.setDiscount('PERCENT', s.discount_rate)} aria-pressed={s.discount_type === 'PERCENT'}>
              %
            </button>
            <button type="button" className={s.discount_type === 'AMOUNT' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => s.setDiscount('AMOUNT', s.discount_rate)} aria-pressed={s.discount_type === 'AMOUNT'}>
              {sym || '₹'}
            </button>
          </div>
          <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.discount_rate} onChange={(n) => s.setDiscount(s.discount_type, n)} placeholder="0" aria-label={tr('summary.extraDiscount')} />
        </div>
      </div>
      {loyaltyOn && LOYALTY_DOCS.has(s.doc_type) && (
        <Suspense fallback={null}>
          <EditorLoyalty />
        </Suspense>
      )}
      {extrasOn && (
        <Suspense fallback={null}>
          <EditorExtras />
        </Suspense>
      )}
      {t.invoice_discount_amount > 0 && (
        <Row label={tr('summary.discountApplied')} tone="good">
          −{money(t.invoice_discount_amount)}
        </Row>
      )}

      <Row label={tr('summary.taxable')} tone="muted">
        {money(t.taxable_value)}
      </Row>

      {s.doc_type === 'BILL_OF_SUPPLY' && <Row label={tr('summary.gst')} tone="muted">{tr('summary.notCharged')}</Row>}
      {!challan && s.doc_type !== 'BILL_OF_SUPPLY' && (
        <div className={styles.inputRow}>
          <span>{tr('summary.gstTreatment')}</span>
          <select className={cn(controls.select, styles.gstSelect)} value={s.gst_mode} onChange={(e) => s.setGstMode(e.target.value as GstMode)} aria-label={tr('summary.gstTreatment')}>
            {GST_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {tr(m.label)}
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
      {s.gst_mode === 'SINGLE' && <Row label={tr('summary.tax')}>{money(t.tax_amount)}</Row>}

      {t.cess_amount > 0 && <Row label={tr('summary.cess')}>{money(t.cess_amount)}</Row>}
      {t.rcm_tax > 0 && (
        <Row label={tr('summary.rcmTax')} tone="muted">
          {tr('summary.rcmTaxValue', { amount: money(t.rcm_tax) })}
        </Row>
      )}
      {t.tcs_amount > 0 && <Row label={s.tcs_label || 'TCS'}>{money(t.tcs_amount)}</Row>}

      <div className={styles.inputRow}>
        <span>{tr('summary.shipping')}</span>
        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.shipping} onChange={s.setShipping} placeholder="0.00" aria-label={tr('summary.shipping')} />
      </div>
      <div className={styles.inputRow}>
        <span>{tr('summary.otherCharges')}</span>
        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.other_charges} onChange={s.setOtherCharges} placeholder="0.00" aria-label={tr('summary.otherCharges')} />
      </div>
      {!challan && (s.shipping !== 0 || s.other_charges !== 0 || s.charges_taxable) && (
        <label className={cn(controls.check, styles.checkRow)} title={tr('summary.chargesTitle')}>
          <input type="checkbox" checked={Boolean(s.charges_taxable)} onChange={(e) => s.patch({ charges_taxable: e.target.checked || undefined })} />
          {tr('summary.chargesGst')}
          {t.charges_line && <span className={styles.roundVal}>@ {t.charges_line.tax_rate}%</span>}
        </label>
      )}

      <label className={cn(controls.check, styles.checkRow)}>
        <input type="checkbox" checked={s.round_off_enabled} onChange={(e) => s.setRoundOff(e.target.checked)} />
        {tr('summary.roundOff')}
        {t.round_off !== 0 && <span className={styles.roundVal}>{t.round_off > 0 ? '+' : '−'}{Math.abs(t.round_off).toFixed(2)}</span>}
      </label>

      {!challan && (
        <>
          <div className={styles.total}>
            <span>{tr('editor.total')}</span>
            <span>{money(t.total)}</span>
          </div>
          <Suspense fallback={null}>
            <MarginChip />
          </Suspense>
          {/* QA-3 F21: no bare "Zero" under an empty bill — words appear once there is an amount. */}
          {t.total !== 0 && (
            <>
              <p className={styles.words}>{amountInWords(t.total, cur)}</p>
              {lang === 'hi' && <p className={styles.words} lang="hi">{amountInWordsHi(t.total, cur)}</p>}
              {isWordsLang(lang) && <p className={styles.words} lang={lang}>{amountInWordsIn(lang, t.total, cur)}</p>}
            </>
          )}

          <div className={styles.inputRow}>
            <span>{tr('summary.amountReceived')}</span>
            <NumberInput className={cn(controls.input, controls.inputNumeric, styles.small)} value={s.amount_paid} onChange={s.setAmountPaid} placeholder="0.00" aria-label={tr('summary.amountReceived')} />
          </div>
          <Suspense fallback={null}>
            <PayModeChips />
          </Suspense>
          {t.tds_amount > 0 && (
            <Row label={tr('summary.lessTds', { section: s.tds_section && s.tds_section !== 'CUSTOM' ? ` (${s.tds_section})` : '' })} tone="good">
              −{money(t.tds_amount)}
            </Row>
          )}
          {(s.amount_paid > 0 || t.tds_amount > 0) && (
            <Row label={tr('summary.balanceDue')} strong>
              {money(t.balance_due)}
            </Row>
          )}
        </>
      )}
    </div>
  );
}
