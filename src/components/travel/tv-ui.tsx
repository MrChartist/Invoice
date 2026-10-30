/** R15: the UI bits the Trips desk views and rows share (a labelled field, a list select); props / runner in `tv-run.ts`. */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';
import { tvList } from '../../i18n/areas/travel-r15b';
import { SelectField } from '../ui/SelectField';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;

/** A select over `ids` labelled from the comma list `list`. */
export function ListSelect<T extends string>({ list, ids, value, onChange, attr }: { list: Parameters<typeof tvList>[0]; ids: readonly T[]; value: T; onChange: (v: T) => void; attr?: string }) {
  return (
    <SelectField className={controls.select} value={value} onChange={(e) => onChange(e.target.value as T)} {...(attr ? { [attr]: '' } : {})}>
      {ids.map((k) => <option key={k} value={k}>{tvList(list, ids, k)}</option>)}
    </SelectField>
  );
}
