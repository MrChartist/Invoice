/**
 * AG-C4 item form row (lazy; mounted by the stock item form only with the `mill` or `agri` pack): agri class, pack
 * size and "pre-packaged and labelled", with the class / rate the 25 kg rule suggests for a sale of this item.
 */
import type { AgClass } from '../../types/agri-r12';
import { useT } from '../../i18n';
import { suggestLine } from '../../lib/agri/ag-packing';
import { Num, Sel } from './mill-ui';
import { T, row } from './mill-kit';
import controls from '../../styles/controls.module.css';

export interface PackFields { ag_class?: AgClass; ag_pack_kg?: number; ag_labelled?: boolean }

/** The mill classes (AG-A's full list stays in the catalogue / bill panels). */
const CLASSES: readonly AgClass[] = ['paddy', 'cereal_loose', 'cereal_packed_25', 'broken_rice', 'flour_loose', 'flour_packed_25', 'pulses_loose', 'pulses_packed_25', 'rice_bran_feed', 'rice_bran_other', 'dorb', 'rice_husk', 'edible_oil', 'oil_cake_feed', 'oil_cake_other', 'cattle_feed'];

export default function PackSizeRow({ value, unit, onChange }: { value: PackFields; unit?: string; onChange: (v: PackFields) => void }) {
  useT();
  const s = suggestLine({ ...value, unit });
  return (
    <div data-ml-pack>
      <div style={row}>
        <Sel l={T('agClass')} v={value.ag_class ?? ''} set={(x) => onChange({ ...value, ag_class: (x || undefined) as AgClass | undefined })} o={[['', '—'], ...CLASSES.map((c) => [c, c] as const)]} x={200} d="ag-class" />
        <Num l={T('packSize')} v={value.ag_pack_kg === undefined ? '' : String(value.ag_pack_kg)} set={(x) => onChange({ ...value, ag_pack_kg: x === '' ? undefined : Number(x) })} x={150} d="pack-kg" />
        <label className={controls.check}><input type="checkbox" checked={!!value.ag_labelled} onChange={(e) => onChange({ ...value, ag_labelled: e.target.checked || undefined })} data-ml="labelled" /> {T('labelled')}</label>
      </div>
      {s && <p className={controls.hint} data-ml-suggest={s.rate}>{T('suggestion', { cls: s.ag_class, rate: s.rate, hsn: s.hsn })}{s.note ? ` — ${T('packNote')}` : ''}</p>}
    </div>
  );
}
