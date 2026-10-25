/**
 * Ledger Creation / Alteration / Display (Tally "Accounts Info → Ledgers"). Fields in Tally order:
 * Name, (alias), Under, then the opening balance with Dr / Cr. A ledger under Sundry Debtors is a
 * client and one under Sundry Creditors a vendor (parties keep living in their own masters); every
 * other ledger is a chart account. Built-in accounts only take an opening balance.
 */
import { useId, useMemo, useState } from 'react';
import { can } from '../../lib/access';
import { localDb } from '../../lib/localDb';
import { vendorsDb } from '../../lib/vendors';
import {
  findLedger,
  isGroupId,
  loadBooksBegin,
  loadMasters,
  loadOpenings,
  openingBalance,
  partyLedgerId,
  primaryOf,
  saveOpenings,
  saveUserAccount,
  type LedgerInterestParams,
  type MastersSnapshot,
  type PrimaryGroupId,
} from '../../lib/ledger';
import { billsTotal, openingBillsFor } from '../../lib/opening-bills';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { DrCrAmount, GroupSelect, MasterFrame } from './shared';
import { paiseText, parsePaise } from './masters-utils';
import controls from '../../styles/controls.module.css';
import styles from './masters.module.css';

export interface SavedLedger {
  id: string;
  name: string;
}

export interface LedgerFormProps {
  mode: 'create' | 'alter' | 'display';
  /** Account id or party ledger id (`party:debtor:<id>`) to alter / display. */
  ledgerId?: string;
  initialName?: string;
  initialGroup?: string;
  onDone: (saved?: SavedLedger) => void;
  onBack: () => void;
  /** Called after saving a party with an opening balance, to open its bill-wise details. */
  onBillwise?: (ledgerId: string) => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

/** Next free numeric code in the primary's series (e.g. 6391 after 6390). */
function suggestCode(primary: PrimaryGroupId, m: MastersSnapshot): string {
  const taken = new Set(m.accounts.map((a) => a.code));
  const nums = m.accounts.filter((a) => a.group === primary && /^\d+$/.test(a.code)).map((a) => Number(a.code));
  let n = nums.length ? Math.max(...nums) + 1 : 9000;
  while (taken.has(String(n))) n++;
  return String(n);
}

export function LedgerForm({ mode, ledgerId, initialName = '', initialGroup = 'INDIRECT_EXPENSES', onDone, onBack, onBillwise, notify }: LedgerFormProps) {
  useT();
  const uid = useId();
  const masters = useMemo(() => loadMasters(), []);
  const today = todayIso();
  const booksBegin = loadBooksBegin(today);
  const existing = ledgerId ? findLedger(ledgerId, masters) : undefined;
  const account = existing?.kind === 'account' ? masters.accounts.find((a) => a.id === existing.id) : undefined;
  const client = existing?.side === 'debtor' ? masters.clients.find((c) => c.id === existing.partyId) : undefined;
  const vendor = existing?.side === 'creditor' ? masters.vendors.find((v) => v.id === existing.partyId) : undefined;
  const system = !!account?.system;
  const readOnly = mode === 'display' || !can('master.edit');
  const canOpening = mode !== 'display' && can('books.edit');

  const typed = existing ? openingBalance(existing.id, undefined, loadOpenings()) : 0;
  // A party with bills but no typed opening posts its bill total: show that.
  const opening0 =
    typed || !existing?.partyId ? typed : Math.round(billsTotal(openingBillsFor(existing.partyId, existing.side === 'creditor' ? 'payable' : 'receivable')) * 100);
  const [name, setName] = useState(existing?.name ?? initialName);
  const [alias, setAlias] = useState(account?.alias ?? '');
  const [under, setUnder] = useState(existing?.group ?? initialGroup);
  const primary = primaryOf(under, masters.userGroups) ?? 'INDIRECT_EXPENSES';
  const [code, setCode] = useState(account?.code ?? suggestCode(primary, masters));
  const [amount, setAmount] = useState(paiseText(opening0));
  const [side, setSide] = useState<'Dr' | 'Cr'>(opening0 < 0 ? 'Cr' : opening0 > 0 ? 'Dr' : primary === 'TRADE_PAYABLES' ? 'Cr' : 'Dr');
  const [rate, setRate] = useState(account?.interest ? String(account.interest.rate) : '');
  const [on, setOn] = useState<LedgerInterestParams['on']>(account?.interest?.on ?? 'dr');
  const [gstin, setGstin] = useState(client?.gstin ?? vendor?.gstin ?? '');
  const [creditDays, setCreditDays] = useState(client?.credit_days ? String(client.credit_days) : '');
  const [error, setError] = useState('');

  const isParty = primary === 'TRADE_RECEIVABLES' || primary === 'TRADE_PAYABLES';
  // A party stays a party, an account stays an account: switching kinds would need a new master.
  const lockKind = existing ? (existing.kind === 'party' ? new Set([existing.primary]) : undefined) : undefined;
  const title = mode === 'create' ? mastersT('ledgerCreation') : mode === 'alter' ? mastersT('ledgerAlteration') : mastersT('ledgerDisplay');

  const accept = () => {
    if (mode === 'display') return onBack();
    try {
      let saved: SavedLedger | undefined;
      if (!system && !readOnly) {
        if (isParty && existing?.kind !== 'account') {
          const groupId = isGroupId(under) ? undefined : under;
          if (primary === 'TRADE_RECEIVABLES') {
            const trimmed = name.trim();
            if (!trimmed) throw new Error('Enter a party name.');
            const days = parseInt(creditDays, 10);
            const id = localDb.clients.upsert({
              ...(client ?? { email: '', address: '', city: '', zip: '' }),
              id: client?.id,
              name: trimmed,
              gstin: gstin.trim().toUpperCase() || undefined,
              credit_days: days > 0 ? days : undefined,
              group_id: groupId,
            });
            saved = { id: partyLedgerId('debtor', id), name: trimmed };
          } else {
            const v = vendorsDb.save({ ...(vendor ?? {}), id: vendor?.id, name, gstin, group_id: groupId });
            saved = { id: partyLedgerId('creditor', v.id), name: v.name };
          }
        } else {
          const interest = rate.trim() ? { rate: Number(rate), on } : null;
          const a = saveUserAccount({ id: account?.id, code, name, group: under, alias, interest });
          saved = { id: a.id, name: a.name };
        }
      } else if (existing) {
        saved = { id: existing.id, name: existing.name };
      }
      if (!saved) return onBack();
      const signed = parsePaise(amount) * (side === 'Cr' ? -1 : 1);
      if (canOpening && signed !== opening0) saveOpenings([{ ledger_id: saved.id, amount: signed, party_name: isParty ? saved.name : undefined }]);
      notify?.(mastersT('saved', { name: saved.name }));
      if (isParty && signed !== 0 && onBillwise) onBillwise(saved.id);
      else onDone(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <MasterFrame
      title={title}
      keys={{ onAccept: accept, onBack }}
      actions={
        <>
          {mode !== 'display' && (
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={accept}>
              {mastersT('accept')} (Ctrl+A)
            </button>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>
            {mastersT('back')} (Esc)
          </button>
          {existing?.kind === 'party' && onBillwise && (
            <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => onBillwise(existing.id)}>
              {mastersT('billwise')}
            </button>
          )}
        </>
      }
    >
      {system && <p className={styles.note}>{mastersT('systemNote')}</p>}
      {mode !== 'display' && !can('master.edit') && <p className={styles.note}>{mastersT('readOnly')}</p>}
      <div className={styles.form}>
        <label htmlFor={`${uid}-name`}>{mastersT('name')}</label>
        <input id={`${uid}-name`} className={controls.input} value={name} readOnly={readOnly || system} autoFocus data-autofocus onChange={(e) => setName(e.target.value)} />
        {!isParty && (
          <>
            <label htmlFor={`${uid}-alias`}>{mastersT('alias')}</label>
            <input id={`${uid}-alias`} className={controls.input} value={alias} readOnly={readOnly || system} onChange={(e) => setAlias(e.target.value)} />
          </>
        )}
        <label htmlFor={`${uid}-under`}>{mastersT('under')}</label>
        <GroupSelect
          id={`${uid}-under`}
          value={under}
          onChange={(g) => {
            setUnder(g);
            if (!account) setCode(suggestCode(primaryOf(g, masters.userGroups) ?? 'INDIRECT_EXPENSES', masters));
          }}
          userGroups={masters.userGroups}
          only={lockKind}
          disabled={readOnly || system}
        />
        {!isParty && (
          <>
            <label htmlFor={`${uid}-code`}>{mastersT('code')}</label>
            <input id={`${uid}-code`} className={`${controls.input} ${controls.inputMono}`} value={code} readOnly={readOnly || system} onChange={(e) => setCode(e.target.value)} />
          </>
        )}
        {isParty && (
          <>
            <label htmlFor={`${uid}-gstin`}>{mastersT('gstin')}</label>
            <input id={`${uid}-gstin`} className={`${controls.input} ${controls.inputMono}`} value={gstin} readOnly={readOnly} onChange={(e) => setGstin(e.target.value)} />
            {primary === 'TRADE_RECEIVABLES' && (
              <>
                <label htmlFor={`${uid}-days`}>{mastersT('creditDays')}</label>
                <input id={`${uid}-days`} className={controls.input} inputMode="numeric" value={creditDays} readOnly={readOnly} onChange={(e) => setCreditDays(e.target.value)} />
              </>
            )}
          </>
        )}
        <label htmlFor={`${uid}-open`}>{mastersT('openingBalance', { date: formatDate(booksBegin) })}</label>
        <DrCrAmount id={`${uid}-open`} label={mastersT('openingBalance', { date: formatDate(booksBegin) })} amount={amount} side={side} onAmount={setAmount} onSide={setSide} disabled={!canOpening} />
        {!isParty && !system && (
          <>
            <label htmlFor={`${uid}-rate`}>{mastersT('interest')} — {mastersT('interestRate')}</label>
            <div className={styles.inline}>
              <input id={`${uid}-rate`} className={`${controls.input} ${styles.amount}`} inputMode="decimal" value={rate} readOnly={readOnly} placeholder="—" onChange={(e) => setRate(e.target.value)} />
              <select className={controls.select} aria-label={mastersT('interestOn')} value={on} disabled={readOnly} onChange={(e) => setOn(e.target.value as LedgerInterestParams['on'])}>
                <option value="dr">{mastersT('interestOnDr')}</option>
                <option value="cr">{mastersT('interestOnCr')}</option>
                <option value="both">{mastersT('interestOnBoth')}</option>
              </select>
            </div>
          </>
        )}
      </div>
      {isParty && mode === 'create' && <p className={styles.note}>{mastersT('partyNote')}</p>}
      {error && (
        <div className={controls.error} role="alert">
          {error}
        </div>
      )}
    </MasterFrame>
  );
}
