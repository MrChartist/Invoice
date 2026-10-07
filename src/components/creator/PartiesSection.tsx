import { AlertTriangle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GstinInput } from '../ui/GstinInput';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { INDIAN_STATES, formatPlaceOfSupply, stateByCode } from '../../lib/india-states';
import type { SenderProfile } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './PartiesSection.module.css';

interface Props {
  profiles: SenderProfile[];
  onSearchClients: () => void;
}

export function PartiesSection({ profiles, onSearchClients }: Props) {
  const sender = useInvoiceStore((s) => s.sender);
  const client = useInvoiceStore((s) => s.client);
  const placeOfSupply = useInvoiceStore((s) => s.place_of_supply);
  const gstMode = useInvoiceStore((s) => s.gst_mode);
  const { setSender, setClient, setPlaceOfSupply } = useInvoiceStore.getState();

  const missingSender = !sender?.companyName?.trim();

  return (
    <div className={styles.grid}>
      <div className={styles.col}>
        <div className={styles.colHead}>
          <span className={controls.label}>From</span>
          {profiles.length > 1 && (
            <select
              className={`${controls.select} ${styles.profileSelect}`}
              value={sender?.id ?? ''}
              onChange={(e) => {
                const p = profiles.find((x) => x.id === e.target.value);
                if (p) setSender(p);
              }}
              aria-label="Issue as"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName || 'Untitled profile'}
                </option>
              ))}
            </select>
          )}
        </div>

        {missingSender ? (
          <div className={styles.warn} role="alert">
            <AlertTriangle size={16} />
            <div>
              <strong>Add your business details first</strong>
              <p>
                Your name, GSTIN and payment details are printed on every document.{' '}
                <Link to="/settings">Open settings</Link>
              </p>
            </div>
          </div>
        ) : (
          <div className={styles.card}>
            <div className={styles.name}>{sender!.companyName}</div>
            {sender!.companyTagline && <div className={styles.tag}>{sender!.companyTagline}</div>}
            <div className={styles.lines}>
              {sender!.companyAddress?.split('\n').filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
              {sender!.companyGstin && <div className={styles.mono}>GSTIN {sender!.companyGstin}</div>}
              {[sender!.companyPhone, sender!.companyEmail].filter(Boolean).length > 0 && (
                <div>{[sender!.companyPhone, sender!.companyEmail].filter(Boolean).join(' · ')}</div>
              )}
            </div>
            {!sender!.companyGstin && (
              <p className={styles.hint}>No GSTIN on this profile — documents are issued without tax details.</p>
            )}
          </div>
        )}
      </div>

      <div className={styles.col}>
        <div className={styles.colHead}>
          <span className={controls.label}>Bill to</span>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={onSearchClients}>
            <Search size={14} /> Find client
          </button>
        </div>

        <div className={styles.form}>
          <input className={controls.input} value={client.name} onChange={(e) => setClient({ name: e.target.value })} placeholder="Client name *" aria-label="Client name" />
          <input className={controls.input} value={client.company ?? ''} onChange={(e) => setClient({ company: e.target.value })} placeholder="Company (optional)" aria-label="Company" />
          <textarea className={controls.textarea} rows={2} value={client.address} onChange={(e) => setClient({ address: e.target.value })} placeholder="Billing address" aria-label="Billing address" />
          <div className={controls.row}>
            <input className={controls.input} value={client.city} onChange={(e) => setClient({ city: e.target.value })} placeholder="City" aria-label="City" />
            <select
              className={controls.select}
              value={client.state_code ?? ''}
              onChange={(e) => setClient({ state_code: e.target.value, state: stateByCode(e.target.value)?.name ?? '' })}
              aria-label="Client state"
            >
              <option value="">State</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <GstinInput value={client.gstin ?? ''} onChange={(v) => setClient({ gstin: v })} placeholder="Client GSTIN (optional)" />
          </div>
          <div className={controls.row}>
            <input className={controls.input} type="email" value={client.email} onChange={(e) => setClient({ email: e.target.value })} placeholder="Email" aria-label="Client email" />
            <input className={controls.input} type="tel" value={client.phone ?? ''} onChange={(e) => setClient({ phone: e.target.value })} placeholder="Phone" aria-label="Client phone" />
          </div>
        </div>
      </div>

      <div className={styles.supply}>
        <label className={controls.field}>
          <span className={controls.label}>Place of supply</span>
          <select className={controls.select} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
            <option value="">Not set</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.supplyNote}>
          {gstMode === 'CGST_SGST' && `Supply within ${stateByCode(placeOfSupply)?.name ?? 'the same state'} — CGST + SGST apply.`}
          {gstMode === 'IGST' && `Supply to ${formatPlaceOfSupply(placeOfSupply) || 'another state'} — IGST applies.`}
          {gstMode === 'SINGLE' && 'Issued with a single combined tax line.'}
          {gstMode === 'NONE' && 'No GST is being charged on this document.'}
        </p>
      </div>
    </div>
  );
}
