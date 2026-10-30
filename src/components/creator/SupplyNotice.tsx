import { AlertTriangle, FileClock, Info } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import {
  COMPOSITION_DECLARATION,
  EXEMPT_KIND_LABELS,
  compositionWarnings,
  isComposition,
  senderCompositionRate,
} from '../../lib/bill-of-supply';
import { amendmentLabel } from '../../lib/amendments';
import { isOwnGstin } from '../../lib/gstin';
import type { ExemptKind } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import styles from './SupplyNotice.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * Composition / Bill of Supply notices for the editor (roadmap 5.9): the scheme in force, non-blocking
 * warnings (tax invoice by a composition dealer, inter-state supply of goods, taxed lines on a Bill of
 * Supply), the Table 8 column of a regular taxpayer's Bill of Supply, and the amendment marker.
 */
export function SupplyNotice() {
  useT(); // re-render on a language switch (5.4)
  const s = useInvoiceStore(useShallow((st) => pick(st, ['amends', 'client', 'doc_type', 'exempt_kind', 'issue_date', 'items', 'patch', 'place_of_supply', 'sender'])));
  const composition = isComposition(s.sender);
  const bos = s.doc_type === 'BILL_OF_SUPPLY';
  const warnings = compositionWarnings(s);
  // QA-3 F10: billing your own GSTIN (a B2B row to yourself) — warn, never block.
  const ownGstin = isOwnGstin(s.client?.gstin, s.sender?.companyGstin);
  if (!composition && !bos && !s.amends && !ownGstin) return null;
  const rate = senderCompositionRate(s.sender, s.issue_date);

  return (
    <div className={styles.wrap} role="status" data-supply-notice>
      {composition && (
        <p className={styles.line}>
          <Info size={14} aria-hidden="true" />
          <span>
            {edT('snComposition', { rate: rate !== null ? edT('snRate', { rate }) : '', declaration: COMPOSITION_DECLARATION })}
          </span>
        </p>
      )}
      {!composition && bos && (
        <label className={styles.kind}>
          <span>{edT('snBosFor')}</span>
          <SelectField
            className={controls.select}
            value={s.exempt_kind ?? 'EXEMPT'}
            onChange={(e) => s.patch({ exempt_kind: e.target.value as ExemptKind })}
            aria-label={edT('snKindAria')}
          >
            {(Object.keys(EXEMPT_KIND_LABELS) as ExemptKind[]).map((k) => (
              <option key={k} value={k}>{edT(`exempt.${k}`)}</option>
            ))}
          </SelectField>
          <span className={styles.muted}>{edT('snReported')}</span>
        </label>
      )}
      {ownGstin && (
        <p className={styles.warn} data-own-gstin>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{edT('snOwnGstin')}</span>
        </p>
      )}
      {warnings.map((w) => (
        <p key={w.code} className={styles.warn}>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{w.message}</span>
        </p>
      ))}
      {s.amends && (
        <p className={styles.line}>
          <FileClock size={14} aria-hidden="true" />
          <span>{amendmentLabel(s.amends)} {edT('snOriginal')}</span>
        </p>
      )}
    </div>
  );
}
