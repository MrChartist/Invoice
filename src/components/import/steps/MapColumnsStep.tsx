import type { Dispatch } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { IMPORT_PRESETS, IMPORT_SCHEMAS, type ColumnMapping, type ImportKind } from '../../../lib/import-mapping';
import type { ImportTable } from '../../../lib/importers';
import type { WizardAction } from '../wizard-state';
import ctl from '../../../styles/controls.module.css';
import styles from '../ImportWizard.module.css';

interface Props {
  kind: ImportKind;
  table: ImportTable;
  mapping: ColumnMapping;
  confidence: Record<string, number>;
  presetId: string;
  missing: { label: string }[];
  amountMissing: boolean;
  dispatch: Dispatch<WizardAction>;
}

/** Step 2: match each field to one of the file's columns. */
export function MapColumnsStep({ kind, table, mapping, confidence, presetId, missing, amountMissing, dispatch }: Props) {
  const schema = IMPORT_SCHEMAS[kind];
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <div className={ctl.field}>
          <label className={ctl.label} htmlFor="import-preset">
            Source / saved mapping
          </label>
          <select id="import-preset" className={cn(ctl.input, ctl.select)} value={presetId} onChange={(e) => dispatch({ type: 'applyPreset', presetId: e.target.value })}>
            {IMPORT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className={ctl.hint}>{IMPORT_PRESETS.find((p) => p.id === presetId)?.description}</span>
        </div>
        <p className={styles.mapNote}>
          Columns were matched automatically. Check the low-confidence ones and fix anything that is wrong.
        </p>
      </div>

      {(missing.length > 0 || amountMissing) && (
        <p className={ctl.error} role="alert">
          <AlertTriangle size={14} />
          {missing.length > 0
            ? `Map a column for: ${missing.map((f) => f.label).join(', ')}.`
            : 'Map an invoice total, a taxable value, or line-item name and rate columns.'}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.mapTable}>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Your column</th>
              <th scope="col">Match</th>
              <th scope="col">Sample values</th>
            </tr>
          </thead>
          <tbody>
            {schema.map((f) => {
              const col = mapping[f.key];
              const mapped = col !== undefined && col >= 0;
              const conf = confidence[f.key] ?? 0;
              const samples = mapped
                ? table.rows.map((r) => r[col!]).filter(Boolean).slice(0, 3)
                : [];
              const selectId = `map-${f.key}`;
              return (
                <tr key={f.key}>
                  <th scope="row">
                    <label htmlFor={selectId}>
                      {f.label}
                      {f.required && <span className={styles.req} aria-label="required"> *</span>}
                    </label>
                    {f.hint && <span className={styles.fieldHint}>{f.hint}</span>}
                  </th>
                  <td>
                    <select
                      id={selectId}
                      className={cn(ctl.input, ctl.select, f.required && !mapped && ctl.inputInvalid)}
                      value={mapped ? String(col) : ''}
                      onChange={(e) => dispatch({ type: 'setColumn', key: f.key, col: e.target.value === '' ? undefined : Number(e.target.value) })}
                    >
                      <option value="">— not mapped —</option>
                      {table.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {mapped && (
                      <span className={cn(styles.conf, conf >= 0.85 ? styles.confHigh : conf >= 0.6 ? styles.confMid : styles.confLow)}>
                        {conf >= 1 && presetId !== 'generic' ? 'Preset' : `${Math.round(conf * 100)}%`}
                      </span>
                    )}
                  </td>
                  <td className={styles.samples}>
                    {samples.length ? samples.map((s, i) => <code key={i}>{s}</code>) : <span className={ctl.hint}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
