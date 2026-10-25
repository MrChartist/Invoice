import { useCallback, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GstinInput } from '../ui/GstinInput';
import { Typeahead } from '../ui/Typeahead';
import { localDb } from '../../lib/localDb';
import { suggest } from '../../lib/suggest';
import { clientToParty } from '../../store/invoice-defaults';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { INDIAN_STATES, formatPlaceOfSupply, stateByCode } from '../../lib/india-states';
import type { Client, SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import controls from '../../styles/controls.module.css';
import styles from './PartiesSection.module.css';

interface Props {
  profiles: SenderProfile[];
  onSearchClients: () => void;
}

export function PartiesSection({ profiles, onSearchClients }: Props) {
  const { t } = useT();
  const sender = useInvoiceStore((s) => s.sender);
  const client = useInvoiceStore((s) => s.client);
  const placeOfSupply = useInvoiceStore((s) => s.place_of_supply);
  const shipTo = useInvoiceStore((s) => s.ship_to);
  const patch = useInvoiceStore((s) => s.patch);
  const setShip = (p: Partial<NonNullable<typeof shipTo>>) => patch({ ship_to: { ...shipTo, ...p } });
  const gstMode = useInvoiceStore((s) => s.gst_mode);
  const { setSender, setClient, setPlaceOfSupply } = useInvoiceStore.getState();
  // Directory snapshot, refreshed whenever the name field gains focus.
  const [directory, setDirectory] = useState<Client[]>([]);
  const clientSuggestions = useCallback(
    (q: string) =>
      suggest(q, directory, {
        label: (c) => c.name,
        extra: (c) => [c.company, c.gstin, c.city],
        sub: (c) => [c.city, c.gstin].filter(Boolean).join(' · '),
      }),
    [directory],
  );

  const missingSender = !sender?.companyName?.trim();

  return (
    <div className={styles.grid}>
      <div className={styles.col}>
        <div className={styles.colHead}>
          <span className={controls.label}>{t('parties.from')}</span>
          {profiles.length > 1 && (
            <select
              className={`${controls.select} ${styles.profileSelect}`}
              value={sender?.id ?? ''}
              onChange={(e) => {
                const p = profiles.find((x) => x.id === e.target.value);
                if (p) setSender(p);
              }}
              aria-label={t('parties.issueAs')}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName || t('parties.untitled')}
                </option>
              ))}
            </select>
          )}
        </div>

        {missingSender ? (
          <div className={styles.warn} role="alert">
            <AlertTriangle size={16} />
            <div>
              <strong>{t('parties.addBusinessTitle')}</strong>
              <p>
                {t('parties.addBusinessText')}{' '}
                <Link to="/settings">{t('parties.openSettings')}</Link>
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
              <p className={styles.hint}>{t('parties.noGstin')}</p>
            )}
          </div>
        )}
      </div>

      <div className={styles.col}>
        <div className={styles.colHead}>
          <span className={controls.label}>{t('parties.billTo')}</span>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={onSearchClients}>
            <Search size={14} /> {t('parties.findClient')}
          </button>
        </div>

        <div className={styles.form}>
          <Typeahead
            className={controls.input}
            value={client.name}
            onChange={(name) => setClient({ name })}
            onFocus={() => setDirectory(localDb.clients.getAll())}
            getSuggestions={clientSuggestions}
            onPick={(c) => setClient(clientToParty(c))}
            placeholder={t('parties.clientNamePh')}
            aria-label={t('parties.clientName')}
          />
          <input className={controls.input} value={client.company ?? ''} onChange={(e) => setClient({ company: e.target.value })} placeholder={t('parties.companyPh')} aria-label={t('parties.company')} />
          <textarea className={controls.textarea} rows={2} value={client.address} onChange={(e) => setClient({ address: e.target.value })} placeholder={t('parties.billingAddress')} aria-label={t('parties.billingAddress')} />
          <div className={controls.row}>
            <input className={controls.input} value={client.city} onChange={(e) => setClient({ city: e.target.value })} placeholder={t('parties.city')} aria-label={t('parties.city')} />
            <select
              className={controls.select}
              value={client.state_code ?? ''}
              onChange={(e) => setClient({ state_code: e.target.value, state: stateByCode(e.target.value)?.name ?? '' })}
              aria-label={t('parties.clientState')}
            >
              <option value="">{t('parties.state')}</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <GstinInput value={client.gstin ?? ''} onChange={(v) => setClient({ gstin: v })} placeholder={t('parties.clientGstinPh')} ariaLabel={t('parties.clientGstinPh')} />
          </div>
          <div className={controls.row}>
            <input className={controls.input} type="email" value={client.email} onChange={(e) => setClient({ email: e.target.value })} placeholder={t('parties.email')} aria-label={t('parties.clientEmail')} />
            <input className={controls.input} type="tel" value={client.phone ?? ''} onChange={(e) => setClient({ phone: e.target.value })} placeholder={t('parties.phone')} aria-label={t('parties.clientPhone')} />
          </div>
          <label className={styles.shipToggle}>
            <input
              type="checkbox"
              checked={!!shipTo}
              onChange={(e) => patch({ ship_to: e.target.checked ? { name: client.name, state_code: client.state_code } : undefined })}
            />
            {t('parties.shipDifferent')}
          </label>
          {shipTo && (
            <fieldset className={styles.shipFields}>
              <legend className={controls.label}>{t('parties.shipLegend')}</legend>
              <input className={controls.input} value={shipTo.name ?? ''} onChange={(e) => setShip({ name: e.target.value })} placeholder={t('parties.consigneeName')} aria-label={t('parties.shipName')} />
              <textarea className={controls.textarea} rows={2} value={shipTo.address ?? ''} onChange={(e) => setShip({ address: e.target.value })} placeholder={t('parties.deliveryAddress')} aria-label={t('parties.shipAddress')} />
              <div className={controls.row}>
                <input className={controls.input} value={shipTo.city ?? ''} onChange={(e) => setShip({ city: e.target.value })} placeholder={t('parties.city')} aria-label={t('parties.shipCity')} />
                <input className={controls.input} inputMode="numeric" maxLength={6} value={shipTo.zip ?? ''} onChange={(e) => setShip({ zip: e.target.value.replace(/\D/g, '') })} placeholder={t('parties.pin')} aria-label={t('parties.shipPin')} />
              </div>
              <select className={controls.select} value={shipTo.state_code ?? ''} onChange={(e) => setShip({ state_code: e.target.value })} aria-label={t('parties.shipState')}>
                <option value="">{t('parties.state')}</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
              <GstinInput value={shipTo.gstin ?? ''} onChange={(v) => setShip({ gstin: v })} placeholder={t('parties.consigneeGstinPh')} />
            </fieldset>
          )}
        </div>
      </div>

      <div className={styles.supply}>
        <label className={controls.field}>
          <span className={controls.label}>{t('parties.placeOfSupply')}</span>
          <select className={controls.select} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
            <option value="">{t('parties.notSet')}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.supplyNote}>
          {gstMode === 'CGST_SGST' && t('parties.supplyIntra', { state: stateByCode(placeOfSupply)?.name ?? t('parties.sameState') })}
          {gstMode === 'IGST' && t('parties.supplyInter', { state: formatPlaceOfSupply(placeOfSupply) || t('parties.anotherState') })}
          {gstMode === 'SINGLE' && t('parties.supplySingle')}
          {gstMode === 'NONE' && t('parties.supplyNone')}
        </p>
      </div>
    </div>
  );
}
