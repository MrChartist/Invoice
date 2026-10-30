import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GstinInput } from '../ui/GstinInput';
import { Typeahead } from '../ui/Typeahead';
import { localDb } from '../../lib/localDb';
import { DB_PREFIX, KEYS, readRaw } from '../../lib/storage';
import { clientExtras, makeSuggester } from '../../lib/suggest';
import { PartyBookPickers } from '../clients/PartyBookPickers';
import { applyPartyDefaults } from '../clients/party-defaults';
import { clientToParty } from '../../store/invoice-defaults';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { WALK_IN_NAME } from '../../lib/counter-receipt';
import { uxT } from '../../i18n/areas/invoicing-ux';
import { INDIAN_STATES, formatPlaceOfSupply, stateByCode } from '../../lib/india-states';
import type { Client, SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import controls from '../../styles/controls.module.css';
import styles from './PartiesSection.module.css';

// R3-B5 / B6: party defaults (once, with Undo) + repeat last bill / usual items — lazy, loads on a party pick.
const PartyHabitsStrip = lazy(() => import('./PartyHabitsStrip'));

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
  const [picked, setPicked] = useState<{ client: Client; seq: number } | null>(null); // R3-B
  // PERF-2: the directory is folded once per snapshot, not per keystroke; an unchanged table keeps its snapshot.
  const directoryRaw = useRef<string | null | undefined>(undefined);
  const refreshDirectory = () => {
    const raw = readRaw(DB_PREFIX + KEYS.clients);
    if (raw === directoryRaw.current) return;
    directoryRaw.current = raw;
    setDirectory(localDb.clients.getAll());
  };
  const clientSuggestions = useMemo(
    () =>
      makeSuggester(directory, {
        label: (c) => c.name,
        extra: clientExtras, // R2-B4: also contact persons' names / phones
        sub: (c) => [c.city, c.gstin].filter(Boolean).join(' · '),
      }),
    [directory],
  );

  const missingSender = !sender?.companyName?.trim();
  // A5: address, company, e-mail and ship-to sit behind "More details" (open when a ship-to is set).
  const [more, setMore] = useState(() => !!shipTo);
  // A6: walk-in cash sale — the POS walk-in name, no address, fully paid in cash.
  const cashSale = () => {
    setClient({ id: undefined, name: WALK_IN_NAME, company: '', address: '', city: '', zip: '', gstin: '', email: '', phone: '' });
    useInvoiceStore.setState({ pay_mode: 'Cash', fully_paid: true });
    setMore(false);
  };

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
          <div data-key-field="picker" data-picker="party">{/* R20-B: Alt+C new party, Ctrl+Enter alter (Tally keys) */}
          <Typeahead
            className={controls.input}
            value={client.name}
            onChange={(name) => setClient({ name })}
            onFocus={refreshDirectory}
            getSuggestions={clientSuggestions}
            onPick={(c) => {
              setClient(clientToParty(c));
              applyPartyDefaults(c); // R2-B4: default ship-to + primary contact on a new document
              setPicked((p) => ({ client: c, seq: (p?.seq ?? 0) + 1 })); // R3-B5 / B6
            }}
            placeholder={t('parties.clientNamePh')}
            aria-label={t('parties.clientName')}
          />
          </div>
          {/* A6: walk-in counter sale — no address, paid in cash in full. */}
          <div className={controls.row}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-pressed={client.name === WALK_IN_NAME} onClick={cashSale} data-cash-sale>
              {uxT('cashSale')}
            </button>
          </div>
          <div className={controls.field}>
            <GstinInput value={client.gstin ?? ''} onChange={(v) => setClient({ gstin: v })} placeholder={t('parties.clientGstinPh')} ariaLabel={t('parties.clientGstinPh')} />
          </div>
          <input className={controls.input} type="tel" value={client.phone ?? ''} onChange={(e) => setClient({ phone: e.target.value })} placeholder={t('parties.phone')} aria-label={t('parties.clientPhone')} />
          {/* R2-B4: Kind attn. + ship-to from the party's address book */}
          <PartyBookPickers />
          {picked && <Suspense fallback={null}><PartyHabitsStrip key={picked.seq} party={picked.client} /></Suspense>}
          {/* A5: name, GSTIN and phone first; the rest behind "More details". */}
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-expanded={more} onClick={() => setMore((m) => !m)} data-party-more>
            {more ? uxT('lessDetails') : uxT('moreDetails')}
          </button>
          {more && (
            <>
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
                  {s.code} : {s.name}
                </option>
              ))}
            </select>
          </div>
          <input className={controls.input} type="email" value={client.email} onChange={(e) => setClient({ email: e.target.value })} placeholder={t('parties.email')} aria-label={t('parties.clientEmail')} />
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
                    {s.code} : {s.name}
                  </option>
                ))}
              </select>
              <GstinInput value={shipTo.gstin ?? ''} onChange={(v) => setShip({ gstin: v })} placeholder={t('parties.consigneeGstinPh')} />
            </fieldset>
          )}
            </>
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
                {s.code} : {s.name}
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
