import { useState } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { DEFAULT_BANK_ID, bankAccountsDb, type BankAccount } from '../../lib/bank-accounts';
import type { BankStatement } from '../../lib/bank-recon';
import { generateId } from '../../lib/storage';
import { formatMoney } from '../../lib/utils';
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
}

const toDraft = (a?: BankAccount): Draft => ({
  id: a?.id ?? '',
  name: a?.name ?? '',
  number: a?.number ?? '',
  opening: a?.opening === undefined ? '' : String(a.opening),
  opening_as_of: a?.opening_as_of ?? '',
});

/**
 * Statements tab → Bank accounts (multi-account BRS). With one account nothing changes; add a
 * second and the BRS, imports and payment forms let you choose the account.
 */
export function BankAccountsCard({ accounts, statements, payments, onChange, notify }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const inUse = (id: string) => statements.some((s) => s.bank_account_id === id) || payments.some((p) => p.bank_account_id === id);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const opening = draft.opening.trim() === '' ? undefined : Number(draft.opening);
    if (opening !== undefined && !Number.isFinite(opening)) return notify('Enter a valid opening balance.', 'error');
    if (opening !== undefined && !draft.opening_as_of) return notify('Choose the date of the opening balance.', 'error');
    try {
      const existing = accounts.find((a) => a.id === draft.id);
      bankAccountsDb.save({
        ...(existing ?? { active: true }),
        id: draft.id || generateId(),
        name: draft.name,
        number: draft.number.trim() || undefined,
        opening,
        opening_as_of: opening === undefined ? undefined : draft.opening_as_of,
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
          <Landmark size={16} /> Bank accounts
        </span>
        {!draft && (
          <button type="button" className={controls.btnOutline} onClick={() => setDraft(toDraft())}>
            <Plus size={16} /> Add account
          </button>
        )}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote} style={{ marginTop: 0 }}>
          Keep more than one bank account? Add them here: each statement, receipt and supplier payment can then name its account,
          and each account reconciles on its own. Give each account its own opening balance; the Books bank opening stays the total.
        </p>
        <div className={bank.stack}>
          {accounts.map((a) => (
            <div key={a.id} className={bank.toolbar}>
              <span>
                <strong>{a.name}</strong>
                {a.number ? ` · ${a.number}` : ''}
                {a.opening !== undefined && a.opening_as_of ? ` · opening ₹${formatMoney(a.opening)} on ${a.opening_as_of}` : ''}
                {a.active === false ? ' · inactive' : ''}
              </span>
              <span className={bank.toolbarGroup}>
                <button type="button" className={controls.btnOutline} onClick={() => setDraft(toDraft(a))}>Edit</button>
                {a.id !== DEFAULT_BANK_ID && (
                  <button type="button" className={controls.btnOutline} onClick={() => toggle(a)}>{a.active === false ? 'Reactivate' : 'Deactivate'}</button>
                )}
                {a.id !== DEFAULT_BANK_ID && !inUse(a.id) && (
                  <button type="button" className={controls.btnOutline} onClick={() => remove(a)}>Delete</button>
                )}
              </span>
            </div>
          ))}
        </div>
        {draft && (
          <form onSubmit={save} className={bank.stack} style={{ marginTop: '1rem' }}>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-name">Account name</label>
                <input id="ba-name" className={controls.input} value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. ICICI current account" />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-number">Account (last digits, optional)</label>
                <input id="ba-number" className={controls.input} value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} placeholder="e.g. ••4521" />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-opening">Opening balance (₹, optional)</label>
                <input id="ba-opening" className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={draft.opening}
                  onChange={(e) => setDraft({ ...draft, opening: e.target.value.replace(/[^0-9.-]/g, '') })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ba-asof">As of</label>
                <input id="ba-asof" type="date" className={controls.input} value={draft.opening_as_of} onChange={(e) => setDraft({ ...draft, opening_as_of: e.target.value })} />
              </div>
            </div>
            <div className={bank.toolbarGroup}>
              <button type="submit" className={controls.btnPrimary}>Save account</button>
              <button type="button" className={controls.btnOutline} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
