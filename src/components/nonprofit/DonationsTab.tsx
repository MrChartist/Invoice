/**
 * Receivables → Donations (R5-C3): numbered 80G / 35 donation receipts (`DON/FY…`), print / share, cancel, and the
 * Form 10BD / 10BE desk. Lazy; listed with the `nonprofit` pack. Working paper — verify with your CA.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Donation } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { whatsappLink } from '../../lib/share';
import { cancelDonation, loadDonations } from '../../lib/nonprofit/donations';
import { donationReceiptHtml, donationSectionText } from '../../lib/nonprofit/donation-receipt';
import { ensureGeneralFund } from '../../lib/nonprofit/funds';
import { DONATION_CASH_LIMIT_RULES, ruleAt } from '../../lib/r5c-rules';
import { useT } from '../../i18n';
import { ita25Words } from '../../i18n/areas/ita2025';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import controls from '../../styles/controls.module.css';
import styles from '../institutions/institutions.module.css';
import { B, Shell, Tbl } from '../institutions/Views';
import { attempt, printPage, rs, today, useView, type Notify } from '../institutions/ui';
import { DonationForm } from './DonationForm';
import { Form10bdPanel } from './Form10bdPanel';

const VIEWS = ['receipts', 'form10bd'] as const;

export default function DonationsTab({ notify }: { notify: Notify }) {
  useT();
  const [view, go] = useView(VIEWS);
  // The default "General fund" is created once, the first time the tab opens with the pack on.
  const [tick, setTick] = useState(() => {
    if (isPackOn(localDb.settings.get(), 'nonprofit')) attempt(notify, () => ensureGeneralFund());
    return 0;
  });
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => [...loadDonations()].sort((a, b) => b.number.localeCompare(a.number)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = useMemo(() => new Map(localDb.clients.getAll().map((c) => [c.id, c])), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const print = (d: Donation) => printPage(donationReceiptHtml(d, clients.get(d.donor_id), localDb.settings.activeProfile() ?? null, { labels: { mode: iT(`mode.${d.mode}`), type: iT(`type.${d.type}`) }, cashLimit: ruleAt(DONATION_CASH_LIMIT_RULES, d.date) }), `${d.number.replace(/\//g, '-')}.html`);

  return (
    <Shell pack="nonprofit" views={VIEWS} view={view} go={go} label={(v) => iT(`don.${v}`)} note={iT('npoNote')} d="donations-tab">
      {view === 'receipts' && (
        <div className={styles.stack}>
          {adding ? <DonationForm notify={notify} onSaved={() => { setAdding(false); refresh(); }} /> : <div><B p l={iT('newDonation')} d="donation-new" on={() => setAdding(true)} /></div>}
          <Tbl d="donation-list" h={[iT('number'), iT('date'), iT('donor'), iT('section'), iT('mode'), iT('amount'), '']} rows={list.map((d) => {
            const donor = clients.get(d.donor_id);
            return [`${d.number}${d.cancelled ? ` · ${iT('cancelled')}` : ''}`, d.date, d.anonymous ? iT('anonymous') : donor?.name, donationSectionText(d.section, d.date, ita25Words()), iT(`mode.${d.mode}`), rs(d.amount), <>
              <B sm l={iT('print')} on={() => print(d)} />
              {donor?.phone && <a className={`${controls.btnOutline} ${controls.btnSm}`} href={whatsappLink(donor.phone, iT('thanks', { name: donor.name, amount: rs(d.amount), number: d.number }))} target="_blank" rel="noreferrer">WhatsApp</a>}
              {!d.cancelled && <B g sm l={iT('cancel')} on={() => { const why = window.prompt(iT('reason')); if (why) attempt(notify, () => { cancelDonation(d.id, why, today()); refresh(); }, iT('saved')); }} />}
            </>];
          })} />
        </div>
      )}
      {view === 'form10bd' && <Form10bdPanel notify={notify} tick={tick} refresh={refresh} />}
    </Shell>
  );
}
