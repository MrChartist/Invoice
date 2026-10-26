/** R5-C3 donation receipt form: donor (with id), amount, mode, type, fund, section — warnings live, never blocks. */
import { useMemo, useState } from 'react';
import type { DonorIdCode } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { bankAccountsDb } from '../../lib/bank-accounts';
import { ID_CODES, MODES, SECTIONS, TYPES, donationWarnings, donorIdValid, fyOf, loadDonations, saveDonation, type DonationInput } from '../../lib/nonprofit/donations';
import { loadFunds } from '../../lib/nonprofit/funds';
import { donationSectionText } from '../../lib/nonprofit/donation-receipt';
import { ita25Words } from '../../i18n/areas/ita2025';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, C, S, T } from '../institutions/Views';
import { attempt, num, opts, today, type Notify } from '../institutions/ui';

export function DonationForm({ notify, onSaved }: { notify: Notify; onSaved: () => void }) {
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const funds = useMemo(() => loadFunds(), []);
  const banks = useMemo(() => bankAccountsDb.active(), []);
  const [d, setD] = useState<DonationInput>({ date: today(), donor_id: '', amount: 0, mode: 'electronic', type: 'others', section: '80G', fund_id: funds[0]?.id });
  const [n, setN] = useState({ name: '', code: 'pan' as DonorIdCode, no: '', address: '' });
  const set = (x: Partial<DonationInput>) => setD({ ...d, ...x });
  const known = clients.find((c) => c.id === d.donor_id);
  const warns = donationWarnings({ ...d, amount: Number(d.amount) || 0 }, known ?? { donor: { id_code: n.code, id_no: n.no } }, loadDonations().filter((x) => !x.cancelled && fyOf(x.date) === fyOf(d.date || today())));
  const save = () => attempt(notify, () => {
    const no = n.no.trim().toUpperCase();
    const id = d.donor_id || (n.name.trim() ? localDb.clients.upsert({ name: n.name.trim(), email: '', address: n.address, city: '', zip: '', ...(no ? { donor: { id_code: n.code, id_no: no }, ...(n.code === 'pan' ? { pan: no } : {}) } : {}) }) : '');
    saveDonation({ ...d, donor_id: id }, known?.name ?? n.name.trim());
    onSaved();
  }, iT('saved'));
  return (
    <div className={styles.stack} data-donation-form>
      <div className={styles.toolbar}>
        <T l={iT('date')} t="date" v={d.date} on={(date) => set({ date })} />
        <S l={iT('donor')} v={d.donor_id} o={[['', iT('newDonor')], ...clients.map((c) => [c.id!, c.name] as const)]} on={(donor_id) => set({ donor_id })} />
        {!d.donor_id && (<>
          <T l={iT('name')} v={n.name} on={(name) => setN({ ...n, name })} d="donor-name" />
          <S l={iT('idCode')} v={n.code} o={opts(ID_CODES, 'id.')} on={(v) => setN({ ...n, code: v as DonorIdCode })} />
          <T l={iT('idNo')} v={n.no} bad={!!n.no && !donorIdValid(n.code, n.no)} on={(no) => setN({ ...n, no })} d="donor-id" />
          <T l={iT('address')} v={n.address} on={(address) => setN({ ...n, address })} />
        </>)}
        <T l={iT('amount')} v={d.amount || ''} on={(v) => set({ amount: num(v) })} d="donation-amount" />
        <S l={iT('mode')} v={d.mode} o={opts(MODES, 'mode.')} on={(v) => set({ mode: v as DonationInput['mode'] })} />
        {d.mode !== 'cash' && d.mode !== 'kind' && banks.length > 1 && <S l={iT('bank')} v={d.bank_account_id} o={banks.map((b) => [b.id, `${b.name}${b.fcra ? ' (FCRA)' : ''}`] as const)} on={(v) => set({ bank_account_id: v })} />}
        <T l={iT('ref')} v={d.reference} on={(reference) => set({ reference })} />
        <S l={iT('type')} v={d.type} o={opts(TYPES, 'type.')} on={(v) => set({ type: v as DonationInput['type'] })} />
        <S l={iT('fund')} v={d.fund_id} o={[['', '—'], ...funds.map((f) => [f.id, f.name] as const)]} on={(v) => set({ fund_id: v || undefined })} />
        <S l={iT('section')} v={d.section} o={SECTIONS.map((x) => [x, x === 'none' ? '—' : donationSectionText(x, d.date, ita25Words())] as const)} on={(v) => set({ section: v as DonationInput['section'] })} />
        <T l={iT('purpose')} v={d.purpose} on={(purpose) => set({ purpose })} />
        <C l={iT('anonymous')} v={d.anonymous} on={(anonymous) => set({ anonymous })} />
      </div>
      {warns.map((w) => <p key={w} className={styles.warn}>{iT(`warn.${w}`)}</p>)}
      <div><B p l={iT('save')} d="donation-save" on={save} /></div>
    </div>
  );
}
