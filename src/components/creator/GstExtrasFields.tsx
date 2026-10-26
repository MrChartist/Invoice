import { useState } from 'react';
import { AlertTriangle, Store, Truck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { ECO_SECTION_LABELS, ecoWarnings } from '../../lib/eco';
import type { ChallanPurpose, EcoSection } from '../../types/invoice';
import { reachT } from '../../i18n/areas/reach';
import { edT } from '../../i18n/areas/editor';
import controls from '../../styles/controls.module.css';
import styles from './SupplyNotice.module.css';

const ECO_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

const CHALLAN_PURPOSE_LABELS: Record<ChallanPurpose, string> = {
  JOB_WORK: 'Job work (GSTR-1 Table 13, doc 9)',
  APPROVAL: 'Supply on approval (doc 10)',
  LIQUID_GAS: 'Liquid gas, quantity not known (doc 11)',
  OTHER_THAN_SUPPLY: 'Other than by way of supply (doc 12)',
  ANTICIPATION: 'Goods sent ahead of the tax invoice (not in Table 13)',
};

/**
 * Optional GST fields of a document (roadmap 5.9 follow-up): the e-commerce operator a supply was made through
 * (GSTR-1 Table 14, GSTR-3B 3.1.1) and a delivery challan's Rule 55 purpose (GSTR-1 Table 13).
 */
export function GstExtrasFields() {
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['doc_type', 'eco_gstin', 'eco_section', 'challan_purpose', 'challan_hide_amounts', 'challan_returnable', 'challan_return_by', 'issue_date', 'sender', 'items', 'gst_mode', 'patch'])),
  );
  const [ecoOpen, setEcoOpen] = useState(false);

  if (s.doc_type === 'DELIVERY_CHALLAN') {
    return (
      <div className={styles.wrap} data-gst-extras>
        <label className={styles.kind}>
          <Truck size={14} aria-hidden="true" />
          <span>Challan purpose</span>
          <select
            className={controls.select}
            value={s.challan_purpose ?? ''}
            onChange={(e) => s.patch({ challan_purpose: (e.target.value || undefined) as ChallanPurpose | undefined })}
            aria-label="Delivery challan purpose (Rule 55)"
          >
            <option value="">Not specified (not in Table 13)</option>
            {(Object.keys(CHALLAN_PURPOSE_LABELS) as ChallanPurpose[]).map((k) => (
              <option key={k} value={k}>{CHALLAN_PURPOSE_LABELS[k]}</option>
            ))}
          </select>
        </label>
        {/* 8H: print without amounts; returnable challan (with an expected return date). */}
        <label className={styles.kind}>
          <input type="checkbox" checked={!!s.challan_hide_amounts} onChange={(e) => s.patch({ challan_hide_amounts: e.target.checked || undefined })} />
          <span>{reachT('chHide')}</span>
        </label>
        <label className={styles.kind}>
          <input
            type="checkbox"
            checked={!!s.challan_returnable}
            onChange={(e) => s.patch({ challan_returnable: e.target.checked || undefined, ...(e.target.checked ? {} : { challan_return_by: undefined }) })}
          />
          <span>{reachT('chReturnable')}</span>
        </label>
        {s.challan_returnable && (
          <label className={styles.kind}>
            <span>{reachT('chReturnBy')}</span>
            <input className={controls.input} type="date" value={s.challan_return_by ?? ''} onChange={(e) => s.patch({ challan_return_by: e.target.value || undefined })} />
          </label>
        )}
      </div>
    );
  }
  if (!ECO_DOCS.has(s.doc_type)) return null;

  const on = ecoOpen || !!s.eco_gstin;
  const warnings = ecoWarnings(s);
  return (
    <div className={styles.wrap} data-gst-extras>
      <label className={styles.kind}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setEcoOpen(e.target.checked);
            if (!e.target.checked) s.patch({ eco_gstin: undefined, eco_section: undefined });
          }}
        />
        <Store size={14} aria-hidden="true" />
        <span>{edT('ecoSold')}</span>
      </label>
      {on && (
        <div className={styles.kind}>
          <input
            className={`${controls.input} ${controls.inputMono}`}
            style={{ width: '16ch' }}
            maxLength={15}
            value={s.eco_gstin ?? ''}
            placeholder={edT('ecoGstinPh')}
            aria-label={edT('ecoGstinAria')}
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/\s/g, '');
              s.patch({ eco_gstin: v || undefined, eco_section: v ? s.eco_section : undefined });
            }}
          />
          <select
            className={controls.select}
            value={s.eco_section ?? 'TCS_52'}
            onChange={(e) => s.patch({ eco_section: e.target.value as EcoSection })}
            aria-label={edT('ecoHowAria')}
          >
            {(Object.keys(ECO_SECTION_LABELS) as EcoSection[]).map((k) => (
              <option key={k} value={k}>{ECO_SECTION_LABELS[k]}</option>
            ))}
          </select>
          <span className={styles.muted}>{edT(s.eco_section === 'PAY_9_5' ? 'ecoTable14b' : 'ecoTable14a')}</span>
        </div>
      )}
      {warnings.map((w) => (
        <p key={w.code} className={styles.warn}>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{w.message}</span>
        </p>
      ))}
    </div>
  );
}
