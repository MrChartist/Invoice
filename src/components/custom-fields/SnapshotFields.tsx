import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { customFieldsDb, fieldsFor, readValues, setSnapshotValue, type CustomFieldValue } from '../../lib/custom-fields';
import type { CustomFieldDef } from '../../types/custom-fields';
import { useT } from '../../i18n';
import { fldT } from '../../i18n/areas/fields';
import controls from '../../styles/controls.module.css';
import styles from './custom-fields.module.css';

type Row = Pick<CustomFieldDef, 'id' | 'label' | 'type' | 'print'> & { stored?: CustomFieldValue };

/**
 * PENDING #25: snapshot inputs (6.23) for records that keep `custom_values` — purchase bills / expenses and recurring
 * templates (`document` fields), and one invoice line (`item` fields). Inputs follow the current definitions; a value
 * already saved keeps its label (snapshot), and values whose field was deleted stay editable. Renders nothing when there
 * is nothing to show. Callers finalise with `finalizeValues` on save.
 */
export function SnapshotFields({ scope, values, onChange, idPrefix, compact }: {
  scope: 'document' | 'item';
  values: readonly CustomFieldValue[] | undefined;
  onChange: (next: CustomFieldValue[] | undefined) => void;
  idPrefix: string;
  compact?: boolean;
}) {
  useT(); // re-render on a language switch (5.4)
  const defs = useMemo(() => fieldsFor(customFieldsDb.all(), scope), [scope]);
  const rows = useMemo<Row[]>(() => {
    const stored = readValues(values).filter((v) => v.scope !== 'party');
    const byId = new Map(stored.map((v) => [v.id, v]));
    const out: Row[] = defs.map((d) => ({ ...d, stored: byId.get(d.id) }));
    for (const v of stored) if (!out.some((r) => r.id === v.id)) out.push({ id: v.id, label: v.label, type: v.type, print: v.print, stored: v });
    return out;
  }, [defs, values]);
  if (!rows.length) return null;
  const inputs = (
    <div className={styles.grid}>
      {rows.map((row) => {
        const id = `${idPrefix}-cf-${row.id}`;
        const label = row.stored?.label || row.label;
        return (
          <div key={row.id} className={controls.field}>
            <label className={controls.label} htmlFor={id}>
              {label}
              {(row.stored ? row.stored.print : row.print) && <Printer size={12} className={styles.printIcon} aria-label={fldT('printed')} />}
            </label>
            <input
              id={id}
              className={row.type === 'number' ? controls.inputNumeric : controls.input}
              type={row.type === 'date' ? 'date' : 'text'}
              inputMode={row.type === 'number' ? 'decimal' : undefined}
              value={row.stored?.value ?? ''}
              onChange={(e) => {
                const next = setSnapshotValue(values, row, e.target.value);
                onChange(next.length ? next : undefined);
              }}
              data-cf-input={row.id}
            />
          </div>
        );
      })}
    </div>
  );
  if (compact) return <div data-cf-line>{inputs}</div>;
  return (
    <fieldset className={styles.group} data-cf-snapshot={scope}>
      <legend className={styles.legend}>{fldT('moreDetails')}</legend>
      {inputs}
    </fieldset>
  );
}

export default SnapshotFields;
