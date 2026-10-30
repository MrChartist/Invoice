/**
 * R4-C1 Settings → Business → Export: IEC / AD code / AD bank on the sender profile (saved with the profile) and the
 * LUT register (saved at once, its own table). Lazy inside the profile editor.
 */
import { useState } from 'react';
import { Globe, Trash2 } from 'lucide-react';
import type {} from '../../types/trade-r4';
import type { SenderProfile } from '../../types/invoice';
import type { LutRow } from '../../types/trade-r4';
import { adCodeProblem, cleanAdCode, cleanIec, iecProblem } from '../../lib/trade/exporter';
import { fyOf, lutDb } from '../../lib/trade/lut-register';
import { formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import settings from '../settings/Settings.module.css';
import styles from './trade.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

interface Props {
  profile: SenderProfile;
  onChange: (patch: Partial<SenderProfile>) => void;
}

const fyChoices = (): string[] => {
  const now = fyOf(todayInput());
  const y = 2000 + Number(now.slice(2, 4));
  return [y + 1, y, y - 1, y - 2].map((s) => `FY${String(s).slice(2)}-${String(s + 1).slice(2)}`);
};

export default function ExportSettingsPanel({ profile, onChange }: Props) {
  useT();
  const [rows, setRows] = useState<LutRow[]>(() => lutDb.all());
  const [draft, setDraft] = useState<Partial<LutRow>>(() => ({ fy: fyOf(todayInput()), gstin: profile.companyGstin ?? '' }));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const iecBad = iecProblem(profile.iec);
  const adBad = adCodeProblem(profile.ad_code);

  const save = () => {
    try {
      lutDb.save(draft);
      setRows(lutDb.all());
      setDraft({ fy: draft.fy, gstin: draft.gstin });
      setMsg({ text: trT('lutSaved') });
    } catch (err) {
      setMsg({ text: trErr(err), bad: true });
    }
  };
  const remove = (id: string) => {
    try {
      lutDb.remove(id);
      setRows(lutDb.all());
      setMsg({ text: trT('lutRemoved') });
    } catch (err) {
      setMsg({ text: trErr(err), bad: true });
    }
  };

  return (
    <fieldset className={settings.group} id="export" data-export-settings>
      <legend><Globe size={14} aria-hidden="true" /> {trT('exportLegend')}</legend>
      <div className={controls.row3}>
        <label className={controls.field}>
          <span className={controls.label}>{trT('iec')}</span>
          <input className={`${controls.input} ${controls.inputMono} ${iecBad ? controls.inputInvalid : ''}`} maxLength={10} value={profile.iec ?? ''} onChange={(e) => onChange({ iec: cleanIec(e.target.value) })} />
          {iecBad ? <span className={controls.error}>{trT('iecBad')}</span> : <span className={controls.hint}>{trT('iecHint')}</span>}
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{trT('adCode')}</span>
          <input className={`${controls.input} ${controls.inputMono} ${adBad ? controls.inputInvalid : ''}`} inputMode="numeric" maxLength={14} value={profile.ad_code ?? ''} onChange={(e) => onChange({ ad_code: cleanAdCode(e.target.value) })} />
          {adBad ? <span className={controls.error}>{trT('adBad')}</span> : <span className={controls.hint}>{trT('adHint')}</span>}
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{trT('adBank')}</span>
          <input className={controls.input} value={profile.ad_bank ?? ''} placeholder={trT('adBankPh')} onChange={(e) => onChange({ ad_bank: e.target.value || undefined })} />
        </label>
      </div>

      <div className={styles.panel} aria-label={trT('lutTitle')}>
        <strong>{trT('lutTitle')}</strong>
        <p className={styles.muted}>{trT('lutIntro')}</p>
        {rows.length === 0 ? <p className={styles.muted}>{trT('lutNone')}</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="lut-table">
              <thead><tr><th>{trT('lutFy')}</th><th>{trT('lutGstin')}</th><th>{trT('lutArn')}</th><th>{trT('lutFiled')}</th><th>{trT('lutFrom')}</th><th>{trT('lutTo')}</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.fy}</td>
                    <td>{r.gstin || trT('lutAllGstins')}</td>
                    <td className={controls.inputMono}>{r.arn}</td>
                    <td>{formatDate(r.filed_on)}</td>
                    <td>{formatDate(r.valid_from)}</td>
                    <td>{formatDate(r.valid_to)}</td>
                    <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={trT('lutRemove', { arn: r.arn })} onClick={() => remove(r.id)}><Trash2 size={14} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.inline}>
          <label className={`${controls.field} ${styles.narrow}`}>
            <span className={controls.label}>{trT('lutFy')}</span>
            <SelectField className={controls.select} value={draft.fy ?? ''} onChange={(e) => setDraft({ ...draft, fy: e.target.value })}>
              {fyChoices().map((f) => <option key={f} value={f}>{f}</option>)}
            </SelectField>
          </label>
          <label className={`${controls.field} ${styles.grow}`}>
            <span className={controls.label}>{trT('lutGstin')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={draft.gstin ?? ''} placeholder={trT('lutAllGstins')} onChange={(e) => setDraft({ ...draft, gstin: e.target.value.toUpperCase() })} />
          </label>
          <label className={`${controls.field} ${styles.grow}`}>
            <span className={controls.label}>{trT('lutArn')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} maxLength={20} value={draft.arn ?? ''} onChange={(e) => setDraft({ ...draft, arn: e.target.value.toUpperCase() })} />
          </label>
          <label className={`${controls.field} ${styles.narrow}`}>
            <span className={controls.label}>{trT('lutFiled')}</span>
            <DateField className={controls.input} value={draft.filed_on ?? ''} onChange={(e) => setDraft({ ...draft, filed_on: e.target.value })} />
          </label>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={save}>{trT('lutAdd')}</button>
        </div>
        {msg && <p className={msg.bad ? controls.error : controls.hint} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      </div>
    </fieldset>
  );
}
