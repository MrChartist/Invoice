import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Store, Trash2 } from 'lucide-react';
import type { MsmeCategory, PurchaseRecord, Vendor } from '../../types/purchases';
import { INDIAN_STATES, stateByCode } from '../../lib/india-states';
import { searchVendors, validateVendor, vendorBalances, vendorsDb } from '../../lib/vendors';
import { formatCurrency } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { GstinInput } from '../ui/GstinInput';
import { Modal } from '../ui/Modal';
import { CustomFieldInputs } from '../custom-fields/CustomFieldInputs';
import { cleanValueMap, customFieldsDb } from '../../lib/custom-fields';
import { useT } from '../../i18n';
import { purT } from '../../i18n/areas/purchases';
import { wireT } from '../../i18n/areas/wiring';
import { isValidIfsc } from '../../lib/validators';
import { cleanVendorTds, deducteeTypeFromPan, vendorTdsProblem } from '../../lib/tds-payables';
import { DEDUCTEE_TYPES, TDS_PAYABLE_SECTIONS, type DeducteeType } from '../../lib/tds-rules';
import { o7T } from '../../i18n/areas/gst-tds-7o';
import { r7T } from '../../i18n/areas/gst-tds-7r';
import { tdsT } from '../../i18n/areas/tds';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import tabStyles from './VendorsTab.module.css';

export interface VendorsTabProps {
  vendors: Vendor[];
  purchases: PurchaseRecord[];
  onChanged: (message?: string, tone?: 'success' | 'error') => void;
}

export function VendorsTab({ vendors, purchases, onChanged }: VendorsTabProps) {
  useT(); // re-render on a language switch (5.4)
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);

  const balances = useMemo(() => vendorBalances(purchases), [purchases]);
  const rows = useMemo(() => searchVendors(vendors, query), [vendors, query]);

  return (
    <section className={surface.card}>
      <div className={tabStyles.toolbar}>
        <label className={tabStyles.search}>
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={purT('vSearchPh')}
            aria-label={purT('vSearch')}
          />
        </label>
        <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
          <Plus size={16} /> {purT('addVendor')}
        </button>
      </div>

      {vendors.length === 0 ? (
        <EmptyState icon={Store} title={purT('noVendors')} text={purT('noVendorsText')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title={purT('noMatches')} text={purT('tryOtherSearch')} />
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{purT('thVendor')}</th>
                <th className={tabStyles.hideSm}>{purT('thGstin')}</th>
                <th className={tabStyles.hideSm}>{purT('thState')}</th>
                <th className={`${surface.numeric} ${tabStyles.hideSm}`}>{purT('thBills')}</th>
                <th className={surface.numeric}>{purT('thOutstanding')}</th>
                <th aria-label={purT('thActions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const b = balances.get(v.id);
                return (
                  <tr key={v.id}>
                    <td>
                      <div className={tabStyles.name}>
                        <Avatar name={v.name} size={28} square />
                        <div>
                          <div>{v.name}</div>
                          {(v.phone || v.email || v.msme_category) && (
                            <div className={tabStyles.sub}>
                              {[v.msme_category && purT('msmeTag', { category: purT(v.msme_category === 'MICRO' ? 'msmeMicro' : v.msme_category === 'SMALL' ? 'msmeSmall' : 'msmeMedium').toLowerCase() }), v.phone || v.email].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${surface.mono} ${tabStyles.hideSm}`}>{v.gstin || '—'}</td>
                    <td className={tabStyles.hideSm}>{stateByCode(v.state_code)?.name ?? '—'}</td>
                    <td className={`${surface.numeric} ${tabStyles.hideSm}`}>{b?.bills ?? 0}</td>
                    <td className={surface.numeric}>{formatCurrency(b?.outstanding ?? 0)}</td>
                    <td>
                      <div className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} title={purT('edit')} aria-label={purT('editNamed', { name: v.name })} onClick={() => setEditing(v)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className={controls.btnDanger} title={purT('delete')} aria-label={purT('deleteNamed', { name: v.name })} onClick={() => setDeleting(v)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? purT('addVendor') : purT('editVendor')}
        size="md"
      >
        {editing !== null && (
          <VendorForm
            key={editing === 'new' ? 'new' : editing.id}
            vendor={editing === 'new' ? undefined : editing}
            onClose={() => setEditing(null)}
            onSaved={(m) => onChanged(m)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        destructive
        title={purT('vDeleteTitle')}
        message={purT('vDeleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={purT('delete')}
        onConfirm={() => {
          if (deleting) {
            vendorsDb.remove(deleting.id);
            onChanged(purT('deleted', { name: deleting.name }));
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function VendorForm({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: (m: string) => void }) {
  const [draft, setDraft] = useState<Vendor>(vendor ?? { id: '', name: '' });
  const [error, setError] = useState('');
  const set = (patch: Partial<Vendor>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const problem = validateVendor(draft);
    if (problem) return setError(problem);
    if (draft.bank_ifsc?.trim() && !isValidIfsc(draft.bank_ifsc.trim().toUpperCase())) return setError(wireT('ifscInvalid'));
    const tdsProblem = vendorTdsProblem(draft);
    if (tdsProblem) return setError(tdsProblem);
    try {
      const bank = {
        bank_account_no: draft.bank_account_no?.replace(/\s+/g, '') || undefined,
        bank_ifsc: draft.bank_ifsc?.trim().toUpperCase() || undefined,
        bank_name: draft.bank_name?.trim() || undefined,
        beneficiary_name: draft.beneficiary_name?.trim() || undefined,
      };
      const saved = vendorsDb.save({ ...draft, ...bank, ...cleanVendorTds(draft), id: vendor?.id, custom_fields: cleanValueMap(draft.custom_fields, customFieldsDb.all()) });
      onSaved(vendor ? purT('updated', { name: saved.name }) : purT('added', { name: saved.name }));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-name">{purT('vendorName')}</label>
        <input id="v-name" className={controls.input} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-gstin">{purT('thGstin')}</label>
          <GstinInput id="v-gstin" value={draft.gstin ?? ''} onChange={(gstin) => set({ gstin })} onStateCode={(state_code) => set({ state_code })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-state">{purT('state')}</label>
          <select id="v-state" className={controls.select} value={draft.state_code ?? ''} onChange={(e) => set({ state_code: e.target.value })}>
            <option value="">{purT('notSpecified')}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-phone">{purT('phone')}</label>
          <input id="v-phone" type="tel" className={controls.input} value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-email">{purT('email')}</label>
          <input id="v-email" type="email" className={controls.input} value={draft.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-msme">{purT('msmeCategory')}</label>
          <select id="v-msme" className={controls.select} value={draft.msme_category ?? ''} onChange={(e) => set({ msme_category: (e.target.value || undefined) as MsmeCategory | undefined })}>
            <option value="">{purT('notMsme')}</option>
            <option value="MICRO">{purT('msmeMicro')}</option>
            <option value="SMALL">{purT('msmeSmall')}</option>
            <option value="MEDIUM">{purT('msmeMedium')}</option>
          </select>
          <span className={controls.hint}>{purT('msmeHint')}</span>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-udyam">{purT('udyam')}</label>
          <input id="v-udyam" className={controls.input} placeholder="UDYAM-MH-01-0000001" value={draft.msme_udyam ?? ''} onChange={(e) => set({ msme_udyam: e.target.value })} />
        </div>
      </div>
      <fieldset className={tabStyles.bankSet}>
        <legend className={controls.label}>{wireT('vendorBank')}</legend>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-bank-ac">{wireT('bankAccountNo')}</label>
            <input id="v-bank-ac" className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" autoComplete="off" value={draft.bank_account_no ?? ''} onChange={(e) => set({ bank_account_no: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-bank-ifsc">{wireT('bankIfsc')}</label>
            <input id="v-bank-ifsc" className={`${controls.input} ${controls.inputMono}`} placeholder="HDFC0001234" maxLength={11} autoComplete="off" value={draft.bank_ifsc ?? ''} onChange={(e) => set({ bank_ifsc: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-bank-name">{wireT('bankName')}</label>
            <input id="v-bank-name" className={controls.input} value={draft.bank_name ?? ''} onChange={(e) => set({ bank_name: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-bank-ben">{wireT('beneficiary')}</label>
            <input id="v-bank-ben" className={controls.input} value={draft.beneficiary_name ?? ''} onChange={(e) => set({ beneficiary_name: e.target.value })} />
          </div>
        </div>
      </fieldset>
      <fieldset className={tabStyles.bankSet} data-vendor-tds>
        <legend className={controls.label}>{o7T('vTdsLegend')}</legend>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-pan">{tdsT('pan')}</label>
            <input id="v-pan" className={`${controls.input} ${controls.inputMono}`} maxLength={10} autoComplete="off" placeholder="ABCDE1234F" value={draft.pan ?? ''} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-deductee">{o7T('vDeductee')}</label>
            <select id="v-deductee" className={controls.select} value={draft.deductee_type ?? ''} onChange={(e) => set({ deductee_type: (e.target.value || undefined) as DeducteeType | undefined })}>
              <option value="">{o7T('vDeducteeAuto', { type: deducteeTypeFromPan(draft.pan) ? o7T(`dt${deducteeTypeFromPan(draft.pan)}` as 'dtOTHER') : '—' })}</option>
              {DEDUCTEE_TYPES.map((t) => <option key={t} value={t}>{o7T(`dt${t}` as 'dtOTHER')}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-tds-sec">{o7T('vSection')}</label>
            <select id="v-tds-sec" className={controls.select} value={draft.tds_section ?? ''} onChange={(e) => set({ tds_section: e.target.value || undefined })}>
              <option value="">{tdsT('noTds')}</option>
              {TDS_PAYABLE_SECTIONS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.check}>
              <input type="checkbox" checked={!!draft.tds_non_filer} onChange={(e) => set({ tds_non_filer: e.target.checked })} /> {tdsT('nonFiler')}
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={!!draft.non_resident} onChange={(e) => set({ non_resident: e.target.checked })} /> {o7T('vNonResident')}
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={!!draft.rcm_maker} onChange={(e) => set({ rcm_maker: e.target.checked || undefined })} /> {purT('rcmMaker')}
            </label>
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-cert">{tdsT('lowerCert')}</label>
            <input id="v-cert" className={`${controls.input} ${controls.inputMono}`} autoComplete="off" value={draft.tds_lower_cert ?? ''} onChange={(e) => set({ tds_lower_cert: e.target.value })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-cert-rate">{tdsT('lowerRate')}</label>
            <input id="v-cert-rate" type="number" min={0} max={100} step="0.01" className={controls.input} value={draft.tds_lower_rate ?? ''} onChange={(e) => set({ tds_lower_rate: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-cert-limit">{o7T('vCertLimit')}</label>
            <input id="v-cert-limit" type="number" min={0} step="0.01" className={controls.input} value={draft.tds_lower_limit ?? ''} onChange={(e) => set({ tds_lower_limit: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-cert-from">{o7T('vCertFrom')}</label>
            <input id="v-cert-from" type="date" className={controls.input} value={draft.tds_lower_from ?? ''} onChange={(e) => set({ tds_lower_from: e.target.value || undefined })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="v-cert-to">{o7T('vCertTo')}</label>
            <input id="v-cert-to" type="date" className={controls.input} value={draft.tds_lower_to ?? ''} onChange={(e) => set({ tds_lower_to: e.target.value || undefined })} />
          </div>
        </div>
        <span className={controls.hint}>{o7T('vTdsHint')}</span>
        {draft.non_resident && (
          // 7R (7.120): non-resident details for Form 27Q / DTAA (the treaty rate needs a TRC and Form 10F).
          <div data-vendor-nr>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-country">{r7T('vNrCountry')}</label>
                <input id="v-nr-country" className={controls.input} maxLength={60} value={draft.nr_country ?? ''} onChange={(e) => set({ nr_country: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-tin">{r7T('vNrTin')}</label>
                <input id="v-nr-tin" className={`${controls.input} ${controls.inputMono}`} maxLength={40} autoComplete="off" value={draft.nr_tin ?? ''} onChange={(e) => set({ nr_tin: e.target.value })} />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-trc">{r7T('vNrTrc')}</label>
                <input id="v-nr-trc" className={`${controls.input} ${controls.inputMono}`} maxLength={40} autoComplete="off" value={draft.nr_trc_no ?? ''} onChange={(e) => set({ nr_trc_no: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-trc-to">{r7T('vNrTrcTo')}</label>
                <input id="v-nr-trc-to" type="date" className={controls.input} value={draft.nr_trc_to ?? ''} onChange={(e) => set({ nr_trc_to: e.target.value || undefined })} />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-dtaa">{r7T('vNrDtaaRate')}</label>
                <input id="v-nr-dtaa" type="number" min={0} max={100} step="0.01" className={controls.input} value={draft.nr_dtaa_rate ?? ''} onChange={(e) => set({ nr_dtaa_rate: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="v-nr-art">{r7T('vNrDtaaArticle')}</label>
                <input id="v-nr-art" className={controls.input} maxLength={40} value={draft.nr_dtaa_article ?? ''} onChange={(e) => set({ nr_dtaa_article: e.target.value })} />
              </div>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={!!draft.nr_form10f} onChange={(e) => set({ nr_form10f: e.target.checked })} /> {r7T('vNr10f')}
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={!!draft.nr_no_pe} onChange={(e) => set({ nr_no_pe: e.target.checked })} /> {r7T('vNrNoPe')}
            </label>
            <span className={controls.hint}>{r7T('vNrHint')}</span>
          </div>
        )}
      </fieldset>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-addr">{purT('address')}</label>
        <textarea id="v-addr" className={controls.textarea} value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-notes">{purT('notes')}</label>
        <textarea id="v-notes" className={controls.textarea} value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      <CustomFieldInputs scope="party" idPrefix="vendor" value={draft.custom_fields} onChange={(custom_fields) => set({ custom_fields })} />
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{purT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{vendor ? purT('saveChanges') : purT('addVendor')}</button>
      </div>
    </form>
  );
}
