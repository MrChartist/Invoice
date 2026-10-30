/** R19: the UI bits the Shipments desk views share (props, a labelled field, a select over a list, layout). */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';
import { TypedInput } from '../ui/TypedInput';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface LgViewProps { notify: Notify }

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;

/** A labelled select over `ids` (labels by `name`); `blank` adds an empty first option. */
export function Pick({ label, value, ids, name, onChange, blank, attr }: { label: string; value: string; ids: readonly string[]; name: (id: string) => string; onChange: (v: string) => void; blank?: string; attr?: string }) {
  return (
    <Field label={label}>
      <SelectField className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} data-lg-field={attr}>
        {blank !== undefined && <option value="">{blank}</option>}
        {ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </SelectField>
    </Field>
  );
}

/** A labelled text / number / date input; numbers come back as numbers (blank → undefined). */
export function In({ label, value, onChange, type = 'text', attr }: { label: string; value: string | number | undefined; onChange: (v: string) => void; type?: 'text' | 'number' | 'date'; attr?: string }) {
  return <Field label={label}><TypedInput className={controls.input} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} data-lg-field={attr} /></Field>;
}
