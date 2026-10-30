/** R14 PS-B1: the "Disbursement" row of the expense form (lazy; professional companies only). Working paper — PS3. */
import { useT } from '../../i18n';
import { psbT } from '../../i18n/areas/prof-r14b';
import { DISB_KINDS, disbursementPatch, onBehalfByDefault, psOfPurchase, type DisbKind } from '../../lib/prof/ps-disb';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export interface DisbValue {
  ps?: Record<string, unknown>;
  pure_agent?: boolean;
  markup_percent?: number;
  itc_eligible?: boolean;
}

/** `value` is the expense's current `ps`; `onChange` gets the fields to save (client and matter come from the form). */
export default function DisbursementRow({ ps, date, itc, onChange }: { ps: unknown; date: string; itc: boolean; onChange: (v: DisbValue) => void }) {
  useT();
  const cur = psOfPurchase({ ps });
  const set = (kind: DisbKind | '', onBehalf?: boolean) => {
    if (!kind) {
      const { disb: _d, on_behalf: _o, ...rest } = cur;
      return onChange({ ps: rest as Record<string, unknown> });
    }
    const { billable_to_client_id: _c, ...p } = disbursementPatch({ date, itc_eligible: itc, ps: cur }, kind, '', { onBehalf: onBehalf ?? onBehalfByDefault(kind, date) });
    onChange({ ...p, ps: { ...cur, ...p.ps } as Record<string, unknown> });
  };
  return (
    <div className={controls.row} data-ps-disb>
      <label className={controls.field}>
        <span className={controls.label}>{psbT('disb')}</span>
        <SelectField className={controls.select} value={cur.disb ?? ''} onChange={(e) => set(e.target.value as DisbKind | '')}>
          <option value="">{psbT('disb.none')}</option>
          {DISB_KINDS.map((k) => <option key={k} value={k}>{psbT(`k.${k}`)}</option>)}
        </SelectField>
      </label>
      {cur.disb && (
        <label className={controls.check}>
          <input type="checkbox" checked={!!cur.on_behalf} onChange={(e) => set(cur.disb!, e.target.checked)} /> {psbT('onBehalf')}
        </label>
      )}
    </div>
  );
}
