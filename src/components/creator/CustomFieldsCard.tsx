import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { customFieldsDb, fieldsFor, readValues, setSnapshotValue, type CustomFieldValue } from '../../lib/custom-fields';
import type { CustomFieldDef } from '../../types/custom-fields';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import styles from './CustomFieldsCard.module.css';
import { TypedInput } from '../ui/TypedInput';

type Row = Pick<CustomFieldDef, 'id' | 'label' | 'type' | 'print'> & { scope?: 'party'; stored?: CustomFieldValue };

/**
 * Document custom fields (6.23) in the editor. Inputs follow the current definitions; a value
 * already on the document keeps the label it was entered with (snapshot), and values whose
 * field was since deleted stay visible so they can still be edited or cleared.
 */
export function CustomFieldsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  useT(); // re-render on a language switch (5.4)
  const values = useInvoiceStore((s) => s.custom_values);
  const patch = useInvoiceStore((s) => s.patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defs = useMemo(() => customFieldsDb.all(), [refreshKey]);

  const rows = useMemo<Row[]>(() => {
    const stored = readValues(values);
    const byId = new Map(stored.map((v) => [v.id, v]));
    const out: Row[] = [];
    for (const d of fieldsFor(defs, 'document')) out.push({ ...d, stored: byId.get(d.id) });
    for (const d of fieldsFor(defs, 'party')) out.push({ ...d, scope: 'party', stored: byId.get(d.id) });
    for (const v of stored) if (!out.some((r) => r.id === v.id)) out.push({ id: v.id, label: v.label, type: v.type, print: v.print, scope: v.scope, stored: v });
    return out;
  }, [defs, values]);

  if (rows.length === 0) return null;

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span>{edT('cfTitle')}</span>
        <Link to="/settings?tab=fields" className={styles.manage}>{edT('cfManage')}</Link>
      </div>
      <div className={surface.cardBody}>
        <div className={styles.grid}>
          {rows.map((row) => {
            const label = row.stored?.label || row.label;
            const print = row.stored ? row.stored.print : row.print;
            const id = `cf-${row.id}`;
            return (
              <div key={row.id} className={controls.field}>
                <label className={controls.label} htmlFor={id}>
                  {label}
                  {print && <Printer size={12} className={styles.printIcon} aria-label={edT('cfPrinted')} />}
                  {row.scope === 'party' && <span className={styles.tag}>{edT('cfClient')}</span>}
                </label>
                <TypedInput
                  id={id}
                  className={row.type === 'number' ? controls.inputNumeric : controls.input}
                  type={row.type === 'date' ? 'date' : 'text'}
                  inputMode={row.type === 'number' ? 'decimal' : undefined}
                  value={row.stored?.value ?? ''}
                  onChange={(e) => patch({ custom_values: emptyToUndefined(setSnapshotValue(values, row, e.target.value)) })}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const emptyToUndefined = (list: CustomFieldValue[]) => (list.length ? list : undefined);
