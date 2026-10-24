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
import type { ExemptKind } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './SupplyNotice.module.css';

/**
 * Composition / Bill of Supply notices for the editor (roadmap 5.9): the scheme in force, non-blocking
 * warnings (tax invoice by a composition dealer, inter-state supply of goods, taxed lines on a Bill of
 * Supply), the Table 8 column of a regular taxpayer's Bill of Supply, and the amendment marker.
 */
export function SupplyNotice() {
  const s = useInvoiceStore(useShallow((st) => pick(st, ['amends', 'doc_type', 'exempt_kind', 'issue_date', 'items', 'patch', 'place_of_supply', 'sender'])));
  const composition = isComposition(s.sender);
  const bos = s.doc_type === 'BILL_OF_SUPPLY';
  const warnings = compositionWarnings(s);
  if (!composition && !bos && !s.amends) return null;
  const rate = senderCompositionRate(s.sender, s.issue_date);

  return (
    <div className={styles.wrap} role="status" data-supply-notice>
      {composition && (
        <p className={styles.line}>
          <Info size={14} aria-hidden="true" />
          <span>
            Composition scheme{rate !== null ? ` (${rate}% of turnover, paid in CMP-08)` : ''}: no GST is charged and the document prints “{COMPOSITION_DECLARATION}”.
          </span>
        </p>
      )}
      {!composition && bos && (
        <label className={styles.kind}>
          <span>Bill of Supply for</span>
          <select
            className={controls.select}
            value={s.exempt_kind ?? 'EXEMPT'}
            onChange={(e) => s.patch({ exempt_kind: e.target.value as ExemptKind })}
            aria-label="Kind of untaxed supply (GSTR-1 Table 8)"
          >
            {(Object.keys(EXEMPT_KIND_LABELS) as ExemptKind[]).map((k) => (
              <option key={k} value={k}>{EXEMPT_KIND_LABELS[k]}</option>
            ))}
          </select>
          <span className={styles.muted}>Reported in GSTR-1 Table 8 and GSTR-3B 3.1(c) / (e).</span>
        </label>
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
          <span>{amendmentLabel(s.amends)} The original stays in its own return unchanged.</span>
        </p>
      )}
    </div>
  );
}
