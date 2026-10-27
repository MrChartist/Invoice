import { useState } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { DEFAULT_BANK_ID, bankAccountsDb, maskAccountNo, type BankAccount, liveBankAccountUsage } from '../../lib/bank-accounts';
import { bnkT } from '../../i18n/areas/banking';
import type { BankStatement } from '../../lib/bank-recon';
import { generateId } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import bank from './reconcile.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

interface Props {
  accounts: BankAccount[];
  statements: BankStatement[];
  payments: { bank_account_id?: string }[];
  onChange: (next: BankAccount[]) => void;
  notify: Notify;
}

interface Draft {
  id: string;
  name: string;
  number: string;
  opening: string;
  opening_as_of: string;
  od: boolean;
  od_limit: string;
  cm: boolean;
  account_no: string;
  ifsc: string;
  branch: string;
}

const toDraft = (a?: BankAccount): Draft => ({
  id: a?.id ?? '',
  name: a?.name ?? '',
  number: a?.number ?? '',
  opening: a?.opening === undefined ? '' : String(a.opening),
  opening_as_of: a?.opening_as_of ?? '',
  od: !!a?.od,
  cm: !!(a as { client_money?: boolean } | undefined)?.client_money,
  od_limit: a?.od_limit === undefined ? '' : String(a.od_limit),
  account_no: a?.account_no ?? '',
  ifsc: a?.ifsc ?? '',
  branch: a?.branch ?? '',
});

/**
 * Statements tab → Bank accounts (multi-account BRS). With one account nothing changes; add a
 * second and the BRS, imports and payment forms let you choose the account.
 */
export function BankAccountsCard({ accounts, statements, payments, onChange, notify }: Props) {
  useT(); // re-render on a language switch (5.4)
  const [draft, setDraft] = useState<Draft | null>(null);
  // R14 (PS-B3): the client-money tick, for a law firm / CA firm (packs `legal`, `cafirm`) or an account already marked.
  const [cmOn] = useState(() => ((s: { industry_packs?: unknown }) => Array.isArray(s.industry_packs) && s.industry_packs.some((p) => p === 'legal' || p === 'cafirm'))(localDb.settings.get() as never));
  // Advances, refunds, cheques and supplier payments count too (liveBankAccountUsage).
  const inUse = (id: string) => statements.some((s) => s.bank_account_id === id) || payments.some((p) => p.bank_account_id === id) || liveBankAccountUsage(id).length > 0;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const opening = draft.opening.trim() === '' ? undefined : Number(draft.opening);
    if (opening !== undefined && !Number.isFinite(opening)) return notify(bankT('errOpening'), 'error');
    if (opening !== undefined && !draft.opening_as_of) return notify(bankT('errOpeningDate'), 'error');
    try {
      const existing = accounts.find((a) => a.id === draft.id);
      bankAccountsDb.save({
        ...(existing ?? { active: true }),
        id: draft.id || generateId(),
        name: draft.name,
        number: draft.number.trim() || undefined,
        opening,
        opening_as_of: opening === undefined ? undefined : draft.opening_as_of,
        od: draft.id !== DEFAULT_BANK_ID && draft.od ? true : undefined,
        od_limit: draft.od && Number(draft.od_limit) > 0 ? Number(draft.od_limit) : undefined,
        account_no: draft.account_no.replace(/\s+/g, '') || undefined,
        ifsc: draft.ifsc.trim().toUpperCase() || undefined,
        branch: draft.branch.trim() || undefined,
        ...{ client_money: draft.id !== DEFAULT_BANK_ID && draft.cm ? true : undefined }, // R14 (PS-B3)
      });
      onChange(bankAccountsDb.all());
      setDraft(null);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const toggle = (a: BankAccount) => {
    try {
      bankAccountsDb.save({ ...a, active: a.active === false });
      onChange(bankAccountsDb.all());
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const remove = (a: BankAccount) => {
    try {
      bankAccountsDb.remove(a.id, inUse(a.id));
      onChange(bankAccountsDb.all());
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card} aria-labelledby="bank-accounts-title" style={{ marginBottom: '1rem' }}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="bank-accounts-title">
          <Landmark size={16} /> {bankT('bankAccounts')}
        </span>
        {!draft && (
          <button type="button" className={controls.btnOutline} onClick={() => setDraft(toDraft())}>
            <Plus size={16} /> {bankT('addAccount')}
          </button>
        )}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote} style={{ marginTop: 0 }}>
          {bankT('accountsNote')} {bnkT('ledgerNote')}
        </p>
        <div className={bank.stack}>
          {accounts.map((a) => (
            <div key={a.id} className={bank.toolbar}>
              <span>
                <strong>{a.name}</strong>
                {a.number ? ` · ${a.number}` : a.account_no ? ` · ${maskAccountNo(a.account_no)}` : ''}
                {a.od ? bnkT('odTag') : ''}
                {a.opening !== undefined && a.opening_as_of ? bankT('openingOn', { amount: `₹${formatMoney(a.opening)}`, date: a.opening_as_of }) : ''}
                {a.active === false ? bankT('inactive') : ''}
              </span>
              <span className={bank.toolbarGroup}>
                <button type="button" className={controls.btnOutline} onClick={() => setDraft(toDraft(a))}>{bankT('edit')}</button>
                {a.id !== DEFAULT_BANK_ID && (
                  <button type="button" className={controls.btnOutline} onClick={() => toggle(a)}>{a.active === false ? bankT('reactivate') : bankT('deactivate')}</button>
                )}
                {a.id !== DEFAULT_BANK_ID && !inUse(a.id) && (
                  <button type="button" className={controls.btnOutline} onClick={() => remove(a)}>{bankT('delete')}</button>
                )}
              </span>
            </div>
          ))}
        </div>
        {draft && (
          <form onSubmit={save} className={bank.stack} style={{ marginTop: '1rem' }}>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-name">{bankT('accountName')}</label>
                <input id="ba-name" className={controls.input} value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={bankT('accountNamePh')} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-number">{bankT('accountNumber')}</label>
                <input id="ba-number" className={controls.input} value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} placeholder={bankT('accountNumberPh')} />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-opening">{bankT('openingBalance')}</label>
                <input id="ba-opening" className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={draft.opening}
                  onChange={(e) => setDraft({ ...draft, opening: e.target.value.replace(/[^0-9.-]/g, '') })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-asof">{bankT('asOf')}</label>
                <input id="ba-asof" type="date" className={controls.input} value={draft.opening_as_of} onChange={(e) => setDraft({ ...draft, opening_as_of: e.target.value })} />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-accno">{bnkT('fullAccountNo')}</label>
                <input id="ba-accno" className={`${controls.input} ${controls.inputMono}`} autoComplete="off" value={draft.account_no} onChange={(e) => setDraft({ ...draft, account_no: e.target.value.replace(/[^0-9A-Za-z ]/g, '') })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-ifsc">{bnkT('ifsc')}</label>
                <input id="ba-ifsc" className={`${controls.input} ${controls.inputMono}`} maxLength={11} value={draft.ifsc} onChange={(e) => setDraft({ ...draft, ifsc: e.target.value.toUpperCase() })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-branch">{bnkT('branch')}</label>
                <input id="ba-branch" className={controls.input} value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} />
              </div>
            </div>
            {draft.id !== DEFAULT_BANK_ID && (
              <div className={controls.row}>
                <label className={controls.check}>
                  <input type="checkbox" checked={draft.od} onChange={(e) => setDraft({ ...draft, od: e.target.checked })} /> {bnkT('od')}
                </label>
                {(draft.cm || cmOn) && <label className={controls.check}>
                  <input type="checkbox" checked={draft.cm} onChange={(e) => setDraft({ ...draft, cm: e.target.checked })} data-ps-client-money /> {bnkT('clientMoney')}
                </label>}
                {draft.od && (
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ba-odlimit">{bnkT('odLimit')}</label>
                    <input id="ba-odlimit" className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={draft.od_limit} onChange={(e) => setDraft({ ...draft, od_limit: e.target.value.replace(/[^0-9.]/g, '') })} />
                  </div>
                )}
              </div>
            )}
            <div className={bank.toolbarGroup}>
              <button type="submit" className={controls.btnPrimary}>{bankT('saveAccount')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setDraft(null)}>{bankT('cancel')}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
