import { lazy, Suspense } from 'react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../lib/utils';
import {
  SUPPLY_TYPE_LABELS,
  type RoundMode,
  type SupplyType,
} from '../../types/invoice';

const ROUND_MODES: RoundMode[] = ['nearest', 'up', 'down', 'none'];
// R4-C1: LUT auto-fill from the register + hint (lazy, zero-rated supplies without payment only).
const LutHint = lazy(() => import('../trade/LutHint'));
import { tcsPresets, tdsSections } from '../../lib/tax-rules';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import { ita25Words } from '../../i18n/areas/ita2025';
import { sectionText, withActRef } from '../../lib/ita2025';
import styles from './AdvancedTaxPanel.module.css';


/**
 * Collapsible "Advanced tax" block (supply type, tax-inclusive pricing, TCS, TDS,
 * rounding). Closed by default so simple invoices stay uncluttered.
 * Mount under the totals in the creator: <AdvancedTaxPanel />.
 */
export function AdvancedTaxPanel() {
  useT(); // re-render on a language switch (5.4)
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['currency', 'issue_date', 'lut_date', 'lut_number', 'price_includes_tax', 'round_mode', 'round_off_enabled', 'setLut', 'setPriceIncludesTax', 'setRoundMode', 'setSupplyType', 'setTcs', 'setTds', 'supply_type', 'tcs_base', 'tcs_enabled', 'tcs_label', 'tcs_rate', 'tds_enabled', 'tds_on_taxable', 'tds_rate', 'tds_section', 'totals'])),
  );
  const money = (n: number) => formatCurrency(n, s.currency);
  const roundMode: RoundMode = s.round_mode ?? (s.round_off_enabled ? 'nearest' : 'none');
  const t = s.totals;
  const TCS_PRESETS = tcsPresets(s.issue_date);
  const TDS_SECTIONS = tdsSections(s.issue_date);
  const active =
    s.tcs_enabled || s.tds_enabled || s.price_includes_tax || (s.supply_type ?? 'B2B') !== 'B2B';

  return (
    <details className={styles.wrap} open={active || undefined}>
      <summary className={styles.summary}>{edT('atSummary')}</summary>
      <div className={styles.body}>
        <div className={styles.group}>
          <div className={styles.groupTitle}>{edT('atNature')}</div>
          <select
            className={styles.field}
            aria-label={edT('atNature')}
            value={s.supply_type ?? 'B2B'}
            onChange={(e) => s.setSupplyType(e.target.value as SupplyType)}
          >
            {(Object.keys(SUPPLY_TYPE_LABELS) as SupplyType[]).map((k) => (
              <option key={k} value={k}>{edT(`supply.${k}`)}</option>
            ))}
          </select>
          {(s.supply_type === 'EXPORT_LUT' || s.supply_type === 'SEZ_WITHOUT_PAYMENT') && (
            <div className={styles.row}>
              <input className={styles.field} aria-label={edT('atLut')} placeholder={edT('atLut')} value={s.lut_number ?? ''}
                onChange={(e) => s.setLut(e.target.value, s.lut_date ?? '')} />
              <input className={styles.field} type="date" aria-label={edT('atLutDate')} value={s.lut_date ?? ''}
                onChange={(e) => s.setLut(s.lut_number ?? '', e.target.value)} />
            </div>
          )}
          {(s.supply_type === 'EXPORT_LUT' || s.supply_type === 'SEZ_WITHOUT_PAYMENT') && <Suspense fallback={null}><LutHint /></Suspense>}
          <p className={styles.hint}>
            {edT('atLutHint')}
          </p>
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(s.price_includes_tax)}
            onChange={(e) => s.setPriceIncludesTax(e.target.checked)} />
          {edT('atInclusive')}
        </label>

        <div className={styles.group}>
          <label className={styles.check}>
            <input type="checkbox" checked={Boolean(s.tcs_enabled)}
              onChange={(e) => s.setTcs({ enabled: e.target.checked })} />
            {edT('atTcs')}
          </label>
          {s.tcs_enabled && (
            <div className={styles.row}>
              <select className={styles.field} aria-label={edT('atTcsPreset')} value="" onChange={(e) => e.target.value && s.setTcs({ rate: Number(e.target.value) })}>
                <option value="">{edT('atPreset')}</option>
                {TCS_PRESETS.map((p) => <option key={p.label} value={p.rate}>{withActRef(p.label, p.label, s.issue_date, ita25Words())}</option>)}
              </select>
              <input className={styles.field} type="number" min={0} step="0.01" value={s.tcs_rate ?? 0}
                aria-label={edT('atTcsRate')} onChange={(e) => s.setTcs({ rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              <select className={styles.field} aria-label={edT('atTcsBase')} value={s.tcs_base ?? 'total'}
                onChange={(e) => s.setTcs({ base: e.target.value as 'taxable' | 'total' })}>
                <option value="total">{edT('atOnTotal')}</option>
                <option value="taxable">{edT('atOnTaxable')}</option>
              </select>
              <input className={styles.field} value={s.tcs_label ?? 'TCS'} aria-label={edT('atTcsLabel')}
                onChange={(e) => s.setTcs({ label: e.target.value })} />
            </div>
          )}
        </div>

        <div className={styles.group}>
          <label className={styles.check}>
            <input type="checkbox" checked={Boolean(s.tds_enabled)}
              onChange={(e) => s.setTds({ enabled: e.target.checked })} />
            {edT('atTds')}
          </label>
          {s.tds_enabled && (
            <>
              <div className={styles.row}>
                <select className={styles.field} aria-label={edT('atTdsSection')} value={s.tds_section ?? '194J'}
                  onChange={(e) => {
                    const sec = TDS_SECTIONS.find((x) => x.section === e.target.value);
                    s.setTds({ section: e.target.value, ...(sec && sec.section !== 'CUSTOM' ? { rate: sec.rate } : {}) });
                  }}>
                  {TDS_SECTIONS.map((x) => <option key={x.section} value={x.section}>{withActRef(x.label, x.section, s.issue_date, ita25Words())}</option>)}
                </select>
                <input className={styles.field} type="number" min={0} step="0.01" value={s.tds_rate ?? 0}
                  aria-label={edT('atTdsRate')} onChange={(e) => s.setTds({ rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)), section: 'CUSTOM' })} />
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={s.tds_on_taxable !== false}
                  onChange={(e) => s.setTds({ onTaxable: e.target.checked })} />
                {edT('atTdsTaxable')}
              </label>
              <p className={styles.hint}>
                {edT('atTdsHint')}
              </p>
            </>
          )}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>{edT('atRounding')}</div>
          <select className={styles.field} aria-label={edT('atRounding')} value={roundMode} onChange={(e) => s.setRoundMode(e.target.value as RoundMode)}>
            {ROUND_MODES.map((k) => <option key={k} value={k}>{edT(`round.${k}`)}</option>)}
          </select>
        </div>

        {(t.cess_amount > 0 || t.tcs_amount > 0 || t.tds_amount > 0) && (
          <div className={styles.group}>
            {t.cess_amount > 0 && <div className={styles.result}><span>{edT('atCess')}</span><span>{money(t.cess_amount)}</span></div>}
            {t.tcs_amount > 0 && <div className={styles.result}><span>{s.tcs_label || 'TCS'}</span><span>{money(t.tcs_amount)}</span></div>}
            {t.tds_amount > 0 && <div className={styles.result}><span>TDS ({sectionText(s.tds_section, s.issue_date, ita25Words())})</span><span>-{money(t.tds_amount)}</span></div>}
            <div className={`${styles.result} ${styles.resultStrong}`}><span>{edT('atNet')}</span><span>{money(t.payable)}</span></div>
          </div>
        )}
      </div>
    </details>
  );
}
