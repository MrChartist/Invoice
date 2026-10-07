import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { GstinInput } from '../ui/GstinInput';
import { INDIAN_STATES } from '../../lib/india-states';
import { imageToDataUrl } from '../../lib/image';
import { panFromGstin } from '../../lib/gstin';
import { isValidIfsc, isValidPan, isValidUpi } from '../../lib/validators';
import type { SenderProfile } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './Settings.module.css';

interface Props {
  profile: SenderProfile;
  onChange: (patch: Partial<SenderProfile>) => void;
  onError: (message: string) => void;
}

function ImageSlot({
  label,
  hint,
  value,
  maxDimension,
  onPick,
  onClear,
  onError,
}: {
  label: string;
  hint: string;
  value?: string;
  maxDimension: number;
  onPick: (dataUrl: string) => void;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      onPick(await imageToDataUrl(file, maxDimension));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={styles.slot}>
      <div className={styles.slotPreview}>
        {value ? <img src={value} alt={`${label} preview`} /> : <ImagePlus size={22} />}
      </div>
      <div className={styles.slotBody}>
        <div className={controls.label}>{label}</div>
        <p className={controls.hint}>{hint}</p>
        <div className={styles.slotActions}>
          <button type="button" className={controls.btnOutline + ' ' + controls.btnSm} onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={14} /> {value ? 'Replace' : 'Upload'}
          </button>
          {value && (
            <button type="button" className={controls.btnGhost + ' ' + controls.btnSm} onClick={onClear}>
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}

export function ProfileEditor({ profile, onChange, onError }: Props) {
  const gstinPan = panFromGstin(profile.companyGstin);
  const upiBad = !!profile.upiId && !isValidUpi(profile.upiId);
  const ifscBad = !!profile.ifsc && !isValidIfsc(profile.ifsc);
  const panBad = !!profile.pan && !isValidPan(profile.pan);

  return (
    <div className={styles.editor}>
      <fieldset className={styles.group}>
        <legend>Business identity</legend>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Name on invoices *</span>
            <input className={controls.input} value={profile.companyName} onChange={(e) => onChange({ companyName: e.target.value })} placeholder="Rohit Singh" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Tagline / designation</span>
            <input className={controls.input} value={profile.companyTagline} onChange={(e) => onChange({ companyTagline: e.target.value })} placeholder="Research Analyst" />
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Registration line (optional)</span>
          <input className={controls.input} value={profile.regLine ?? ''} onChange={(e) => onChange({ regLine: e.target.value })} placeholder="SEBI Reg. No. INH000015297" />
          <span className={controls.hint}>Printed under your address — use it for SEBI, ICAI, MCA or similar registrations.</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>Address</span>
          <textarea className={controls.textarea} rows={3} value={profile.companyAddress} onChange={(e) => onChange({ companyAddress: e.target.value })} placeholder={'Street, area\nCity, State PIN'} />
        </label>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>Phone</span>
            <input className={controls.input} type="tel" value={profile.companyPhone} onChange={(e) => onChange({ companyPhone: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Email</span>
            <input className={controls.input} type="email" value={profile.companyEmail} onChange={(e) => onChange({ companyEmail: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Website</span>
            <input className={controls.input} value={profile.companyWebsite} onChange={(e) => onChange({ companyWebsite: e.target.value })} placeholder="mrchartist.com" />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Tax registration</legend>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="p-gstin">GSTIN</label>
            <GstinInput
              id="p-gstin"
              value={profile.companyGstin}
              onChange={(v) => onChange({ companyGstin: v })}
              onStateCode={(code) => onChange({ stateCode: code, pan: profile.pan || panFromGstin(profile.companyGstin) })}
            />
          </div>
          <label className={controls.field}>
            <span className={controls.label}>PAN</span>
            <input
              className={`${controls.input} ${controls.inputMono} ${panBad ? controls.inputInvalid : ''}`}
              value={profile.pan ?? ''}
              maxLength={10}
              placeholder={gstinPan || 'ABCDE1234F'}
              onChange={(e) => onChange({ pan: e.target.value.toUpperCase() })}
            />
            {panBad && <span className={controls.error}>PAN should look like ABCDE1234F</span>}
          </label>
          <label className={controls.field}>
            <span className={controls.label}>State of business</span>
            <select className={controls.select} value={profile.stateCode ?? ''} onChange={(e) => onChange({ stateCode: e.target.value })}>
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={controls.hint}>Leave GSTIN empty if you are not GST-registered — tax lines are then hidden from your invoices. Your state decides CGST + SGST vs IGST.</p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Payment details</legend>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Account holder</span>
            <input className={controls.input} value={profile.accountName} onChange={(e) => onChange({ accountName: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Bank &amp; branch</span>
            <input className={controls.input} value={profile.bankName} onChange={(e) => onChange({ bankName: e.target.value })} placeholder="HDFC Bank, Thane" />
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Account number</span>
            <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" value={profile.accountNumber} onChange={(e) => onChange({ accountNumber: e.target.value.replace(/\s/g, '') })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>IFSC</span>
            <input className={`${controls.input} ${controls.inputMono} ${ifscBad ? controls.inputInvalid : ''}`} maxLength={11} value={profile.ifsc} onChange={(e) => onChange({ ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0000123" />
            {ifscBad && <span className={controls.error}>IFSC should look like HDFC0000123</span>}
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>UPI ID</span>
          <input className={`${controls.input} ${upiBad ? controls.inputInvalid : ''}`} value={profile.upiId} onChange={(e) => onChange({ upiId: e.target.value.trim() })} placeholder="name@bank" autoCapitalize="none" />
          {upiBad ? <span className={controls.error}>UPI ID should look like name@bank</span> : <span className={controls.hint}>Drives the scannable “Scan to pay” QR on every invoice.</span>}
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Branding &amp; numbering</legend>
        <div className={styles.slots}>
          <ImageSlot label="Logo" hint="PNG with a transparent background looks best." value={profile.logo} maxDimension={480} onPick={(logo) => onChange({ logo })} onClear={() => onChange({ logo: '' })} onError={onError} />
          <ImageSlot label="Signature" hint="Printed above “Authorized signatory”." value={profile.signature} maxDimension={420} onPick={(signature) => onChange({ signature })} onClear={() => onChange({ signature: '' })} onError={onError} />
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Number prefix (optional)</span>
            <input className={`${controls.input} ${controls.inputMono}`} maxLength={8} value={profile.invoicePrefix ?? ''} onChange={(e) => onChange({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="INV" />
            <span className={controls.hint}>Numbers look like {profile.invoicePrefix || 'INV'}/FY25-26/0001.</span>
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Default terms for this profile</span>
          <textarea className={controls.textarea} rows={3} value={profile.defaultTerms ?? ''} onChange={(e) => onChange({ defaultTerms: e.target.value })} placeholder="Leave empty to use the global default terms." />
        </label>
      </fieldset>
    </div>
  );
}
