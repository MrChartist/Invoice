import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { customFieldsDb, fieldsFor, type CustomFieldScope } from '../../lib/custom-fields';
import { useT } from '../../i18n';
import { fldT } from '../../i18n/areas/fields';
import controls from '../../styles/controls.module.css';
import styles from './custom-fields.module.css';

interface Props {
  scope: CustomFieldScope;
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string>) => void;
  idPrefix: string;
}

/**
 * Inputs for the custom fields defined for clients / vendors (`party`) or catalogue items (`item`).
 * Renders nothing when no field is defined for the scope. Values are cleaned on save
 * (`cleanValueMap`), so half-typed numbers are kept while typing.
 */
export function CustomFieldInputs({ scope, value, onChange, idPrefix }: Props) {
  useT(); // re-render on a language switch (5.4)
  const defs = useMemo(() => fieldsFor(customFieldsDb.all(), scope), [scope]);
  if (defs.length === 0) return null;
  const map = value ?? {};
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{fldT('moreDetails')}</legend>
      <div className={styles.grid}>
        {defs.map((d) => {
          const id = `${idPrefix}-cf-${d.id}`;
          return (
            <div key={d.id} className={controls.field}>
              <label className={controls.label} htmlFor={id}>
                {d.label}
                {d.print && <Printer size={12} className={styles.printIcon} aria-label={fldT('printed')} />}
              </label>
              <input
                id={id}
                className={d.type === 'number' ? controls.inputNumeric : controls.input}
                type={d.type === 'date' ? 'date' : 'text'}
                inputMode={d.type === 'number' ? 'decimal' : undefined}
                value={map[d.id] ?? ''}
                onChange={(e) => {
                  const next = { ...map };
                  if (e.target.value) next[d.id] = e.target.value;
                  else delete next[d.id];
                  onChange(next);
                }}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
