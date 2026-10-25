import { Suspense, lazy, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import {
  GROUPS,
  chartOf,
  groupOf,
  loadUserAccounts,
  MANUAL_VOUCHER_TYPES,
  loadVouchers,
  nextVoucherNumber,
  rupeesToPaise,
  validateVoucher,
  type Account,
  type ManualVoucher,
  type ManualVoucherType,
} from '../../../lib/ledger';
import { money } from './format';
import { CostCentreSelect } from '../../cost-centres/CostCentreSelect';
import { useCostCentres } from '../../cost-centres/useCostCentres';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';
import { VoucherVariantFields, type VariantValue } from '../tally/VoucherVariantFields';
import { useCreateOnTheFly } from '../../masters/useCreateOnTheFly';
import { isAltC } from '../../masters/useMasterKeys';
import { EditLogButton } from '../../audit/EditLogButton';
import { wireT } from '../../../i18n/areas/wiring';
import { BranchSelect } from '../../branches/BranchSelect';
import { allocationsOf, openRefsFor, saveReceiptVoucher, validateAllocations, type ReceiptAllocation } from '../../../lib/bill-allocation';

// P0-11 (WP-1): bill-wise details on a receipt against a Sundry Debtor, loaded when needed.
const BillAllocation = lazy(() => import('../../masters/BillAllocation'));

interface Row {
  key: number;
  account_id: string;
  party: string;
  /** Cost centre (6.16), only kept on income / expense lines. */
  cc?: string;
  dr: string;
  cr: string;
}

interface Props {
  accounts: Account[];
  /** Existing voucher to edit, or null for a new one. */
  voucher: ManualVoucher | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (v: ManualVoucher) => void;
}

const PARTY_GROUPS = new Set(['TRADE_RECEIVABLES', 'TRADE_PAYABLES']);
let seq = 0;
const blank = (): Row => ({ key: ++seq, account_id: '', party: '', dr: '', cr: '' });
const toText = (p: number) => (p ? (p / 100).toFixed(2) : '');

/** Mounted per open (by the caller) so the form always starts from the stored voucher. */
export function VoucherEditor({ accounts: initialAccounts, voucher, defaultDate, onClose, onSaved }: Props) {
  useT();
  const uid = useId();
  // Alt+C on an account picker creates a ledger / party on the fly (WP-1); the chart then reloads.
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const fly = useCreateOnTheFly();
  const [type, setType] = useState<ManualVoucherType>(voucher?.type ?? 'JOURNAL');
  const [date, setDate] = useState(voucher?.date ?? defaultDate);
  const [number, setNumber] = useState(voucher?.number ?? '');
  const [narration, setNarration] = useState(voucher?.narration ?? '');
  // WP-9: branch / location of the voucher (shown once a branch exists; drives branch-wise books).
  const [branchId, setBranchId] = useState<string | undefined>(voucher?.branch_id);
  const [rows, setRows] = useState<Row[]>(() =>
    voucher
      ? voucher.lines.map((l) => ({ key: ++seq, account_id: l.account_id, party: l.party ?? '', cc: l.cost_centre_id, dr: toText(l.dr), cr: toText(l.cr) }))
      : [blank(), blank()],
  );
  const [error, setError] = useState('');
  const [alloc, setAlloc] = useState<ReceiptAllocation[]>(() => (voucher ? allocationsOf(voucher.id) : []));
  // Voucher variants (Tally parity): optional / memorandum, post-dated, reversing, class.
  const [variant, setVariant] = useState<VariantValue>({ variant: voucher?.variant, post_dated: voucher?.post_dated, reverse_on: voucher?.reverse_on, voucher_class: voucher?.voucher_class });
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const centres = useCostCentres();
  const isPnl = (id: string) => {
    const a = byId.get(id);
    const n = a ? groupOf(a.group).nature : undefined;
    return n === 'income' || n === 'expense';
  };

  const lines = rows
    .filter((r) => r.account_id || r.dr || r.cr)
    .map((r) => ({
      account_id: r.account_id,
      dr: rupeesToPaise(r.dr),
      cr: rupeesToPaise(r.cr),
      ...(r.party.trim() ? { party: r.party.trim() } : {}),
      ...(r.cc && isPnl(r.account_id) ? { cost_centre_id: r.cc } : {}),
    }));
  const dr = lines.reduce((s, l) => s + l.dr, 0);
  const cr = lines.reduce((s, l) => s + l.cr, 0);
  const preview = useMemo(() => (voucher && voucher.type === type ? voucher.number : nextVoucherNumber(loadVouchers(), type, date || defaultDate)), [voucher, type, date, defaultDate]);

  const patch = (key: number, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const createLedger = (key: number) => {
    void fly.open({ kind: 'ledger' }).then((saved) => {
      if (!saved) return;
      const chart = chartOf(loadUserAccounts());
      setAccounts(chart);
      if (saved.id.startsWith('party:debtor:')) patch(key, { account_id: 'debtors', party: saved.name });
      else if (saved.id.startsWith('party:creditor:')) patch(key, { account_id: 'creditors', party: saved.name });
      else if (chart.some((a) => a.id === saved.id)) patch(key, { account_id: saved.id });
    });
  };

  // The receipt's Sundry Debtors line (credit with a party): bill allocation applies to it.
  const debtorLine = type === 'RECEIPT' ? lines.find((l) => l.cr > 0 && l.party && byId.get(l.account_id)?.group === 'TRADE_RECEIVABLES') : undefined;
  const inBooksNow = !variant.variant && !variant.post_dated;

  const save = () => {
    const input = { id: voucher?.id, type, date, number: number.trim() || undefined, narration, lines, ...variant, reverse_on: type === 'JOURNAL' ? variant.reverse_on : undefined, ...(branchId ? { branch_id: branchId } : {}) };
    const errors = validateVoucher(input, accounts);
    if (errors.length) return setError(errors[0]);
    const useAlloc = debtorLine && inBooksNow ? alloc.filter((a) => a.amount > 0) : [];
    if (debtorLine && useAlloc.length) {
      const problems = validateAllocations(useAlloc, debtorLine.cr / 100, openRefsFor(debtorLine.party!, voucher?.id));
      if (problems.length) return setError(problems[0]);
    }
    try {
      // Voucher + bill-wise receipt rows in one step: a refused bill keeps neither (H2).
      const method = lines.some((l) => l.dr > 0 && l.account_id === 'cash') ? 'Cash' : 'Bank Transfer';
      const saved = saveReceiptVoucher(input, accounts, { party: debtorLine?.party ?? '', total: (debtorLine?.cr ?? 0) / 100, allocations: useAlloc, method });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message || ledgerT('saveFailed'));
    }
  };

  /** Fill the last line with whatever makes the voucher balance. */
  const balance = () => {
    const diff = dr - cr;
    if (!diff) return;
    const last = rows[rows.length - 1];
    const target = last && !last.dr && !last.cr ? last : null;
    const amt = (Math.abs(diff) / 100).toFixed(2);
    const fill = diff > 0 ? { cr: amt, dr: '' } : { dr: amt, cr: '' };
    if (target) patch(target.key, fill);
    else setRows((list) => [...list, { ...blank(), ...fill }]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={voucher ? ledgerT('editVoucher', { number: voucher.number }) : ledgerT('newVoucher')}
      subtitle={ledgerT('editorSubtitle')}
      footer={
        <>
          {voucher && <EditLogButton recordId={voucher.id} name={voucher.number} />}
          <button type="button" className={controls.btnOutline} onClick={onClose}>{ledgerT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={dr === 0 || dr !== cr}>
            {ledgerT('saveVoucher')}
          </button>
        </>
      }
    >
      <div className={books.stack}>
        <div className={styles.formGrid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-type`}>{ledgerT('type')}</label>
            <select id={`${uid}-type`} className={controls.select} value={type} onChange={(e) => setType(e.target.value as ManualVoucherType)}>
              {MANUAL_VOUCHER_TYPES.map((t) => (
                <option key={t} value={t}>{ledgerT(`vt${t}`)}</option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-date`}>{ledgerT('date')}</label>
            <input id={`${uid}-date`} type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-no`}>{ledgerT('number')}</label>
            <input id={`${uid}-no`} className={`${controls.input} ${controls.inputMono}`} value={number} placeholder={preview} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <BranchSelect id={`${uid}-branch`} value={branchId} onChange={setBranchId} />
        </div>
        <p className={controls.hint}>
          {type === 'JOURNAL' && ledgerT('hintJournal')}
          {type === 'CONTRA' && ledgerT('hintContra')}
          {type === 'PAYMENT' && ledgerT('hintPayment')}
          {type === 'RECEIPT' && ledgerT('hintReceipt')} {wireT('altCHint')}
        </p>

        <div className={styles.editorLines} role="group" aria-label={ledgerT('voucherLines')}>
          <div className={styles.editorHead} aria-hidden="true">
            <span>{ledgerT('account')}</span>
            <span>{centres.length ? ledgerT('partyCc') : ledgerT('partyDebtors')}</span>
            <span>{ledgerT('debitRs')}</span>
            <span>{ledgerT('creditRs')}</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const acc = byId.get(r.account_id);
            const needsParty = !!acc && PARTY_GROUPS.has(acc.group);
            return (
              <div key={r.key} className={styles.editorLine}>
                <select
                  aria-label={ledgerT('lineAccount', { n: i + 1 })}
                  aria-keyshortcuts="Alt+C"
                  className={controls.select}
                  value={r.account_id}
                  onChange={(e) => patch(r.key, { account_id: e.target.value })}
                  onKeyDown={(e) => {
                    if (!isAltC(e.nativeEvent)) return;
                    e.preventDefault();
                    createLedger(r.key);
                  }}
                >
                  <option value="">{ledgerT('chooseAccount')}</option>
                  {GROUPS.map((g) => {
                    const list = accounts.filter((a) => a.group === g.id);
                    return list.length ? (
                      <optgroup key={g.id} label={g.label}>
                        {list.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                {!needsParty && centres.length > 0 && isPnl(r.account_id) ? (
                  <CostCentreSelect id={`${uid}-cc-${r.key}`} ariaLabel={ledgerT('lineCc', { n: i + 1 })} centres={centres} value={r.cc} onChange={(v) => patch(r.key, { cc: v })} />
                ) : (
                  <input aria-label={ledgerT('lineParty', { n: i + 1 })} className={controls.input} value={r.party} disabled={!needsParty} placeholder={needsParty ? ledgerT('partyName') : '—'} onChange={(e) => patch(r.key, { party: e.target.value })} />
                )}
                <input aria-label={ledgerT('lineDebit', { n: i + 1 })} className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={r.dr} placeholder="0.00" onChange={(e) => patch(r.key, { dr: e.target.value, ...(e.target.value ? { cr: '' } : {}) })} />
                <input aria-label={ledgerT('lineCredit', { n: i + 1 })} className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={r.cr} placeholder="0.00" onChange={(e) => patch(r.key, { cr: e.target.value, ...(e.target.value ? { dr: '' } : {}) })} />
                <button type="button" className={controls.btnIcon} aria-label={ledgerT('removeLine', { n: i + 1 })} disabled={rows.length <= 2} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
        <div className={books.toolbar}>
          <div className={books.toolbarGroup}>
            <button type="button" className={controls.btnOutline} onClick={() => setRows((list) => [...list, blank()])}>
              <Plus size={16} /> {ledgerT('addLine')}
            </button>
            <button type="button" className={controls.btnGhost} onClick={balance} disabled={dr === cr}>{ledgerT('balanceLast')}</button>
          </div>
          <div className={styles.editorTotals} aria-live="polite">
            <span>Dr {money(dr)}</span>
            <span>Cr {money(cr)}</span>
            <span className={dr === cr && dr > 0 ? styles.balanced : styles.unbalanced}>
              {dr === cr ? (dr > 0 ? ledgerT('balanced') : ledgerT('enterAmounts')) : ledgerT('difference', { amount: money(Math.abs(dr - cr)) })}
            </span>
          </div>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-narr`}>{ledgerT('narration')}</label>
          <textarea id={`${uid}-narr`} className={controls.textarea} rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {debtorLine && inBooksNow && (
          <Suspense fallback={null}>
            <BillAllocation key={debtorLine.party} party={debtorLine.party!} total={debtorLine.cr / 100} voucherId={voucher?.id} value={alloc} onChange={setAlloc} />
          </Suspense>
        )}
        <VoucherVariantFields type={type} value={variant} onChange={setVariant} />
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
      {fly.node}
    </Modal>
  );
}
