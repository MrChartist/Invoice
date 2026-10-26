/** R5-C4 FCRA desk: FCRA bank flags, administrative ledgers, warnings, the FC-4 working paper and the Sec 11 tracker. */
import { useMemo, useState } from 'react';
import type { Ledger } from '../../lib/ledger/postings';
import { bankAccountsDb, type BankAccount } from '../../lib/bank-accounts';
import { localDb } from '../../lib/localDb';
import { donationFcraIssues, ledgerFcraIssues, type FcraIssue } from '../../lib/nonprofit/fcra-checks';
import { buildFc4, fc4Csv } from '../../lib/nonprofit/fc4';
import { applicationFor } from '../../lib/nonprofit/application';
import { loadDonations } from '../../lib/nonprofit/donations';
import type { Fund } from '../../lib/nonprofit/funds';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, C, S, T } from '../institutions/Views';
import { attempt, csv, fyNow, num, rs, type Notify } from '../institutions/ui';

export function Fc4Panel({ ledger, funds, notify, refresh }: { ledger: Ledger; funds: readonly Fund[]; notify: Notify; refresh: () => void }) {
  const [fy, setFy] = useState(fyNow() - 1);
  const banks = bankAccountsDb.all().filter((b) => !b.clearing);
  const st = localDb.settings.get();
  const admin = st.npo_admin_accounts ?? [];
  const issues: FcraIssue[] = useMemo(() => [...donationFcraIssues(loadDonations(), funds, banks), ...ledgerFcraIssues(ledger, funds, banks, { start: `${fy}-04-01`, end: `${fy + 1}-03-31` }, admin)], [ledger, funds, fy]); // eslint-disable-line react-hooks/exhaustive-deps
  const fc4 = useMemo(() => buildFc4(ledger, funds, banks, fy), [ledger, funds, fy]); // eslint-disable-line react-hooks/exhaustive-deps
  const app = applicationFor(ledger, fy, st.npo_accumulated?.[fy] ?? 0);
  const save = (fn: () => void) => attempt(notify, () => { fn(); refresh(); });
  const setSt = (x: Partial<typeof st>) => save(() => localDb.settings.save({ ...localDb.settings.get(), ...x }));
  const text = (i: FcraIssue) => (i.kind === 'transfer' ? iT('fcra.transfer', { number: i.number, date: i.date, amount: rs(i.amount) }) : i.kind === 'adminCap' ? iT('fcra.adminCap', { admin: rs(i.admin), cap: rs(i.cap), pct: i.pct }) : iT(`fcra.${i.kind}`, { number: i.donation.number }));
  const L = { rp: 'Receipts & payments (FCRA accounts)', open: iT('opening'), rec: iT('receipts'), pay: iT('payments'), close: iT('closing'), ie: 'Income & expenditure (FCRA funds)', inc: iT('income'), exp: iT('used'), bs: 'Balance sheet extract', assets: 'Assets bought from FC', interest: 'Interest on FC', purpose: 'Purpose-wise utilisation', cert: iT('fc4Cert') };
  return (
    <div className={styles.stack} data-fc4>
      <S l="FY" v={fy} o={[0, 1, 2, 3].map((k) => [fyNow() - k, `${fyNow() - k}-${String(fyNow() - k + 1).slice(2)}`] as const)} on={(v) => setFy(+v)} />
      {banks.map((b) => <S key={b.id} l={b.name} v={b.fcra ?? ''} o={[['', '—'], ['designated', iT('fcraDesignated')], ['utilisation', iT('fcraUtil')]]} on={(v) => save(() => { const { fcra: _f, ...rest } = b; void _f; bankAccountsDb.save(v ? { ...rest, fcra: v as BankAccount['fcra'] } : rest); })} />)}
      <details><summary>{iT('adminAccounts')}</summary>
        {ledger.accounts.filter((a) => ['INDIRECT_EXPENSES', 'EMPLOYEE', 'FINANCE', 'DIRECT_EXPENSES'].includes(a.group)).map((a) => <C key={a.id} l={a.name} v={admin.includes(a.id)} on={(on) => setSt({ npo_admin_accounts: on ? [...admin, a.id] : admin.filter((x) => x !== a.id) })} />)}
      </details>
      {issues.map((i, k) => <p key={k} className={styles.warn}>{text(i)}</p>)}
      <p>FC-4 · {iT('receipts')} {rs(fc4.bankReceipts)} · {iT('payments')} {rs(fc4.bankPayments)} · {iT('closing')} {rs(fc4.bankClosing)} · {L.interest} {rs(fc4.interest)}</p>
      <p className={styles.note}>{iT('fc4Note', { due: fc4.dueBy })}</p>
      <div><B l={iT('csv')} on={() => csv(`FC-4-FY${fy}.csv`, fc4Csv(fc4, L))} /></div>
      <h3>{iT('application')}</h3>
      <p>{iT('appLine', { income: rs(app.income), applied: rs(app.applied), pct: app.pct, threshold: app.threshold, short: rs(app.shortfall) })}</p>
      <T l={iT('accumulated')} v={app.accumulated || ''} on={(v) => setSt({ npo_accumulated: { ...st.npo_accumulated, [fy]: num(v) } })} />
    </div>
  );
}
