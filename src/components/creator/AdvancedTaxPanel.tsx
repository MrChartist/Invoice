import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency } from '../../lib/utils';
import {
  SUPPLY_TYPE_LABELS,
  TCS_PRESETS,
  TDS_SECTIONS,
  type RoundMode,
  type SupplyType,
} from '../../types/invoice';
import styles from './AdvancedTaxPanel.module.css';

const ROUND_LABELS: Record<RoundMode, string> = {
  nearest: 'Nearest rupee',
  up: 'Round up',
  down: 'Round down',
  none: 'No rounding',
};

/**
 * Collapsible "Advanced tax" block (supply type, tax-inclusive pricing, TCS, TDS,
 * rounding). Closed by default so simple invoices stay uncluttered.
 * Mount under the totals in the creator: <AdvancedTaxPanel />.
 */
export function AdvancedTaxPanel() {
  const s = useInvoiceStore();
  const money = (n: number) => formatCurrency(n, s.currency);
  const roundMode: RoundMode = s.round_mode ?? (s.round_off_enabled ? 'nearest' : 'none');
  const t = s.totals;
  const active =
    s.tcs_enabled || s.tds_enabled || s.price_includes_tax || (s.supply_type ?? 'B2B') !== 'B2B';

  return (
    <details className={styles.wrap} open={active || undefined}>
      <summary className={styles.summary}>Advanced tax (TCS, TDS, export, cess)</summary>
      <div className={styles.body}>
        <div className={styles.group}>
          <div className={styles.groupTitle}>Nature of supply</div>
          <select
            className={styles.field}
            aria-label="Nature of supply"
            value={s.supply_type ?? 'B2B'}
            onChange={(e) => s.setSupplyType(e.target.value as SupplyType)}
          >
            {(Object.keys(SUPPLY_TYPE_LABELS) as SupplyType[]).map((k) => (
              <option key={k} value={k}>{SUPPLY_TYPE_LABELS[k]}</option>
            ))}
          </select>
          {(s.supply_type === 'EXPORT_LUT' || s.supply_type === 'SEZ_WITHOUT_PAYMENT') && (
            <div className={styles.row}>
              <input className={styles.field} aria-label="LUT / bond number" placeholder="LUT / bond number" value={s.lut_number ?? ''}
                onChange={(e) => s.setLut(e.target.value, s.lut_date ?? '')} />
              <input className={styles.field} type="date" aria-label="LUT date" value={s.lut_date ?? ''}
                onChange={(e) => s.setLut(s.lut_number ?? '', e.target.value)} />
            </div>
          )}
          <p className={styles.hint}>
            Supply without payment charges no GST. With payment charges IGST (refundable).
          </p>
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(s.price_includes_tax)}
            onChange={(e) => s.setPriceIncludesTax(e.target.checked)} />
          Rates include GST (tax-inclusive pricing)
        </label>

        <div className={styles.group}>
          <label className={styles.check}>
            <input type="checkbox" checked={Boolean(s.tcs_enabled)}
              onChange={(e) => s.setTcs({ enabled: e.target.checked })} />
            Collect TCS (Tax Collected at Source)
          </label>
          {s.tcs_enabled && (
            <div className={styles.row}>
              <select className={styles.field} aria-label="TCS preset" value="" onChange={(e) => e.target.value && s.setTcs({ rate: Number(e.target.value) })}>
                <option value="">Preset…</option>
                {TCS_PRESETS.map((p) => <option key={p.label} value={p.rate}>{p.label}</option>)}
              </select>
              <input className={styles.field} type="number" min={0} step="0.01" value={s.tcs_rate ?? 0}
                aria-label="TCS rate %" onChange={(e) => s.setTcs({ rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              <select className={styles.field} aria-label="TCS base" value={s.tcs_base ?? 'total'}
                onChange={(e) => s.setTcs({ base: e.target.value as 'taxable' | 'total' })}>
                <option value="total">On invoice value (incl. GST)</option>
                <option value="taxable">On taxable value</option>
              </select>
              <input className={styles.field} value={s.tcs_label ?? 'TCS'} aria-label="TCS label"
                onChange={(e) => s.setTcs({ label: e.target.value })} />
            </div>
          )}
        </div>

        <div className={styles.group}>
          <label className={styles.check}>
            <input type="checkbox" checked={Boolean(s.tds_enabled)}
              onChange={(e) => s.setTds({ enabled: e.target.checked })} />
            Customer deducts TDS
          </label>
          {s.tds_enabled && (
            <>
              <div className={styles.row}>
                <select className={styles.field} aria-label="TDS section" value={s.tds_section ?? '194J'}
                  onChange={(e) => {
                    const sec = TDS_SECTIONS.find((x) => x.section === e.target.value);
                    s.setTds({ section: e.target.value, ...(sec && sec.section !== 'CUSTOM' ? { rate: sec.rate } : {}) });
                  }}>
                  {TDS_SECTIONS.map((x) => <option key={x.section} value={x.section}>{x.label}</option>)}
                </select>
                <input className={styles.field} type="number" min={0} step="0.01" value={s.tds_rate ?? 0}
                  aria-label="TDS rate %" onChange={(e) => s.setTds({ rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)), section: 'CUSTOM' })} />
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={s.tds_on_taxable !== false}
                  onChange={(e) => s.setTds({ onTaxable: e.target.checked })} />
                Compute on taxable value (before GST)
              </label>
              <p className={styles.hint}>
                TDS does not change the invoice total; it reduces the balance you collect and is
                tracked as a tax credit.
              </p>
            </>
          )}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Rounding</div>
          <select className={styles.field} aria-label="Rounding" value={roundMode} onChange={(e) => s.setRoundMode(e.target.value as RoundMode)}>
            {(Object.keys(ROUND_LABELS) as RoundMode[]).map((k) => <option key={k} value={k}>{ROUND_LABELS[k]}</option>)}
          </select>
        </div>

        {(t.cess_amount > 0 || t.tcs_amount > 0 || t.tds_amount > 0) && (
          <div className={styles.group}>
            {t.cess_amount > 0 && <div className={styles.result}><span>Cess</span><span>{money(t.cess_amount)}</span></div>}
            {t.tcs_amount > 0 && <div className={styles.result}><span>{s.tcs_label || 'TCS'}</span><span>{money(t.tcs_amount)}</span></div>}
            {t.tds_amount > 0 && <div className={styles.result}><span>TDS ({s.tds_section})</span><span>-{money(t.tds_amount)}</span></div>}
            <div className={`${styles.result} ${styles.resultStrong}`}><span>Net payable</span><span>{money(t.payable)}</span></div>
          </div>
        )}
      </div>
    </details>
  );
}
