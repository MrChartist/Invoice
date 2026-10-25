import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { useT } from '../../i18n';
import { useCan } from '../../hooks/useCan';
import { localDb } from '../../lib/localDb';
import { vendorsDb } from '../../lib/vendors';
import { loadBranches } from '../../lib/branch';
import { wireT } from '../../i18n/areas/wiring';
import { chartOf, groupOf, loadUserAccounts, type Account } from '../../lib/ledger/accounts';
import { deleteVoucher, loadVouchers, nextVoucherNumber, validateVoucher, type ManualVoucherType } from '../../lib/ledger/vouchers';
import { allocationsOf, saveReceiptVoucher, voucherReceipts } from '../../lib/bill-allocation';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import { getTable } from '../../lib/storage';
import { VOUCHER_TYPES_TABLE, seriesTypeFor, typedNumber, type VoucherSeries } from '../../lib/voucher-series';
import { vtT } from '../../i18n/areas/voucher-types';
import {
  SINGLE_ENTRY_TYPES,
  billwiseLine,
  fifoRefs,
  knownClasses,
  linesToSingle,
  particularsSide,
  receiptRefsInput,
  singleToLines,
  supplierPaymentFrom,
  validateRefs,
  type BillRefRow,
  type OpenBill,
  type RefKind,
} from '../../lib/gateway/voucher-refs';
import { costCentreLabel, loadCostCentres, pickableCentres } from '../../lib/cost-centres';
import { getVoucherDate, isCalendarDay } from '../../lib/gateway/period';
import {
  ROUTE_TYPES,
  autoFill,
  entryTotals,
  filledLines,
  firstSide,
  ledgerOptions,
  lineLabel,
  linesFromVoucher,
  nextLine,
  optionKey,
  searchLedgers,
  toVoucherInput,
  typeRoute,
  type EntryLine,
  type EntrySide,
  type LedgerOption,
} from '../../lib/gateway/voucher-entry';
import type { TallyKeyId } from '../../lib/tally-keys';
import { cn, formatMoney } from '../../lib/utils';
import { useGateway, useScreenKeys, useTallyTerms } from './context';
import { ButtonBar } from './ButtonBar';
import { CreateLedgerDialog } from './CreateLedgerDialog';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Gateway.module.css';

const TYPE_LABEL: Record<ManualVoucherType, GwKey> = { CONTRA: 'contra', PAYMENT: 'payment', RECEIPT: 'receipt', JOURNAL: 'journal' };
const FKEY_TYPE: Record<string, ManualVoucherType> = { f4: 'CONTRA', f5: 'PAYMENT', f6: 'RECEIPT', f7: 'JOURNAL' };
const BAR_TYPE: Partial<Record<TallyKeyId, ManualVoucherType>> = { contra: 'CONTRA', payment: 'PAYMENT', receipt: 'RECEIPT', journal: 'JOURNAL' };

let seq = 0;
const nextKey = () => ++seq;
const blankLine = (side: EntrySide): EntryLine => ({ key: nextKey(), side, account_id: '', amount: '' });
const money = (p: number) => formatMoney(p / 100);
// P1-13: voucher-type picker, loaded only when a user type of this base exists.
const VoucherTypeSelect = lazy(() => import('../voucher-types/VoucherTypeSelect'));
const MODE_KEY = 'mrchartist_gw_entry_mode';
const readMode = (): 'single' | 'double' => {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'single' ? 'single' : 'double';
  } catch {
    return 'double';
  }
};
const REF_KINDS: RefKind[] = ['agst', 'new', 'advance', 'onacc'];
const REF_LABEL: Record<RefKind, 'agstRef' | 'newRef' | 'advance' | 'onAccount'> = { agst: 'agstRef', new: 'newRef', advance: 'advance', onacc: 'onAccount' };

/** Saved receipt rows of a voucher as editable references (Agst Ref + the labelled remainder). */
function refsOfVoucher(id: string): BillRefRow[] {
  const out: BillRefRow[] = allocationsOf(id).map((a) => ({ key: nextKey(), kind: 'agst', bill_id: a.bill_id, amount: a.amount.toFixed(2) }));
  const rest = voucherReceipts(id).find((r) => !r.invoice_id);
  if (rest) {
    const note = String(rest.note ?? '');
    const kind: RefKind = /^advance/i.test(note) ? 'advance' : /^new ref/i.test(note) ? 'new' : 'onacc';
    out.push({ key: nextKey(), kind, ...(kind === 'new' ? { name: note.replace(/^new ref\s*/i, '') } : {}), amount: (Number(rest.amount) || 0).toFixed(2) });
  }
  return out;
}

type Confirm = null | 'quit' | 'delete';

/**
 * Tally-style single-screen voucher entry (F4 Contra, F5 Payment, F6 Receipt, F7 Journal).
 * Enter walks the fields, the last line is pre-filled with the difference, Ctrl+A accepts, Esc quits
 * (asking first when something was typed), Alt+C creates a ledger / party inline, Alt+D deletes when
 * altering. Saving goes through saveVoucher: numbering, period lock, audit log and roles apply.
 */
export function VoucherEntry() {
  useT();
  const { type: typeParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useCan();
  const { notify } = useGateway();
  const terms = useTallyTerms();
  const type: ManualVoucherType = ROUTE_TYPES[typeParam ?? ''] ?? 'JOURNAL';
  const id = params.get('id');

  const [version, setVersion] = useState(0);
  const existing = useMemo(() => (id ? loadVouchers().find((v) => v.id === id) ?? null : null), [id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chart, setChart] = useState<Account[]>(() => chartOf(loadUserAccounts()));
  const [clients, setClients] = useState(() => localDb.clients.getAll());
  const [vendors, setVendors] = useState(() => vendorsDb.all());
  const [branches] = useState(() => loadBranches());
  const centres = useMemo(() => loadCostCentres(), []);
  const byId = useMemo(() => new Map(chart.map((a) => [a.id, a])), [chart]);
  const options = useMemo(() => ledgerOptions(chart, clients, vendors, type), [chart, clients, vendors, type]);

  const initialLines = () => (existing ? linesFromVoucher(existing, nextKey) : [blankLine(firstSide(type))]);
  const [date, setDate] = useState(() => existing?.date ?? getVoucherDate());
  const [number, setNumber] = useState(existing?.number ?? '');
  const [narration, setNarration] = useState(existing?.narration ?? '');
  const [branchId, setBranchId] = useState(existing?.branch_id ?? '');
  const [lines, setLines] = useState<EntryLine[]>(initialLines);
  // 7Q (P1-13 / 7.19): voucher type, voucher class, single-entry mode, bill-wise references.
  const [voucherTypeId, setVoucherTypeId] = useState<string | undefined>(existing?.voucher_type_id);
  const [voucherClass, setVoucherClass] = useState(existing?.voucher_class ?? '');
  const [mode, setMode] = useState<'single' | 'double'>(() => (SINGLE_ENTRY_TYPES.includes(type) && readMode() === 'single' && !existing ? 'single' : 'double'));
  const [accountId, setAccountId] = useState('');
  const [accountKey] = useState(() => nextKey());
  const [refs, setRefs] = useState<BillRefRow[]>(() => (existing ? refsOfVoucher(existing.id) : []));
  const [bills, setBills] = useState<{ party: string; list: OpenBill[] } | null>(null);
  const classes = useMemo(() => knownClasses(loadVouchers()), []);
  const [queries, setQueries] = useState<Record<number, string>>({});
  const [suggest, setSuggest] = useState<{ key: number; index: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [creating, setCreating] = useState<{ key: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [baseline] = useState(() => JSON.stringify({ date: existing?.date, narration: existing?.narration ?? '', lines: existing ? toVoucherInput({ type, date, narration }, initialLines(), chart).lines : [] }));
  const rootRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // Load another stored voucher when the id changes (drill-down into a different voucher).
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setDate(existing?.date ?? getVoucherDate());
    setNumber(existing?.number ?? '');
    setNarration(existing?.narration ?? '');
    setBranchId(existing?.branch_id ?? '');
    setLines(existing ? linesFromVoucher(existing, nextKey) : [blankLine(firstSide(type))]);
    setQueries({});
    setVoucherTypeId(existing?.voucher_type_id);
    setVoucherClass(existing?.voucher_class ?? '');
    setRefs(existing ? refsOfVoucher(existing.id) : []);
    setMode('double');
  }
  const single = mode === 'single' && SINGLE_ENTRY_TYPES.includes(type);
  /** Double-entry lines of what is on screen (single-entry mode adds the Account line). */
  const effective = (ls: readonly EntryLine[] = lines) => (single ? singleToLines(type, { accountId, rows: [...ls] }, accountKey) : [...ls]);
  const cashBank = useMemo(() => chart.filter((a) => isCashOrBankLedger(a)), [chart]);
  const vtId = !existing || existing.type === type ? voucherTypeId : undefined;
  const hasTypes = useMemo(() => !!vtId || getTable<VoucherSeries>(VOUCHER_TYPES_TABLE).some((t) => t?.base === type && !t.inactive), [type, vtId]);

  const field = (name: string) => rootRef.current?.querySelector<HTMLElement>(`[data-field="${name}"]`) ?? null;
  const [, bump] = useState(0);
  const focus = (name: string) => {
    pendingFocus.current = name;
    bump((x) => x + 1);
  };
  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = field(pendingFocus.current);
    pendingFocus.current = null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  });
  useEffect(() => {
    const first = lines[0];
    field(first ? `${first.key}:ledger` : 'date')?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = entryTotals(effective());
  const partyLine = billwiseLine(type, effective());
  const payableNew = partyLine?.side === 'payable' && !existing;
  const showRefs = !!partyLine && partyLine.paise > 0 && (partyLine.side === 'receivable' || payableNew);
  const billsKey = showRefs && partyLine ? `${partyLine.side}|${partyLine.party}` : '';
  useEffect(() => {
    if (!billsKey || !partyLine) return;
    let live = true;
    void import('../../lib/gateway/voucher-refs-save').then((m) => {
      if (live) setBills({ party: billsKey, list: m.openBillsFor(partyLine.side, partyLine.party, existing?.id) });
    });
    return () => {
      live = false;
    };
  }, [billsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const openBills = bills && bills.party === billsKey ? bills.list : [];
  const isPnl = (accountId: string) => {
    const a = byId.get(accountId);
    const n = a ? groupOf(a.group).nature : undefined;
    return n === 'income' || n === 'expense';
  };
  const showCc = centres.length > 0;
  const preview = useMemo(() => {
    if (existing && existing.type === type && (existing.voucher_type_id ?? '') === (vtId ?? '')) return existing.number;
    const day = isCalendarDay(date) ? date : getVoucherDate();
    const others = loadVouchers().filter((v) => v.id !== existing?.id);
    const vt = seriesTypeFor(vtId, type);
    return vt ? typedNumber(vt, day, others.map((v) => v.number)) : nextVoucherNumber(others, type, day);
  }, [existing, type, date, version, vtId]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftInput = () => ({
    ...toVoucherInput({ id: existing?.id, type, date, narration, number: number.trim() || undefined }, effective(), chart),
    ...(branchId ? { branch_id: branchId } : {}),
    ...(vtId ? { voucher_type_id: vtId } : {}),
    ...(voucherClass.trim() ? { voucher_class: voucherClass.trim() } : {}),
  });
  const dirty = existing
    ? JSON.stringify({ date, narration, lines: draftInput().lines }) !== baseline
    : filledLines(lines).length > 0 || narration.trim() !== '' || !!accountId;

  const patch = (key: number, p: Partial<EntryLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const choose = (key: number, o: LedgerOption) => {
    const filled = autoFill(
      lines.map((l) => (l.key === key ? { ...l, account_id: o.account_id, party: o.party, ...(isPnl(o.account_id) ? {} : { cost_centre_id: undefined }) } : l)),
      key,
    );
    setLines(filled);
    setQueries((q) => {
      const next = { ...q };
      delete next[key];
      return next;
    });
    setSuggest(null);
    focus(showCc && isPnl(o.account_id) ? `${key}:cc` : `${key}:amount`);
  };

  const suggestionsFor = (key: number) => searchLedgers(options, queries[key] ?? '');

  const leave = () => {
    if (location.key !== 'default' && window.history.length > 1) navigate(-1);
    else navigate('/gateway?m=vouchers');
  };

  const reset = () => {
    setLines([blankLine(single ? particularsSide(type) : firstSide(type))]);
    setRefs([]);
    setNarration('');
    setNumber('');
    setQueries({});
    setError('');
  };

  const done = () => {
    setVersion((v) => v + 1);
    if (existing) leave();
    else {
      reset();
      focus('date');
    }
  };

  const accept = () => {
    setError('');
    const input = draftInput();
    const errors = validateVoucher(input, chart);
    if (errors.length) return setError(errors[0]);
    // 7.19: bill-wise references on the party line.
    const usedRefs = showRefs && partyLine ? refs.filter((r) => Number(r.amount.replace(/,/g, '')) > 0) : [];
    if (usedRefs.length && partyLine) {
      const problems = validateRefs(usedRefs, partyLine.paise / 100, openBills);
      if (problems.length) return setError(problems[0]);
    }
    try {
      if (usedRefs.length && partyLine?.side === 'payable') {
        const sp = supplierPaymentFrom(effective(), usedRefs, { date, reference: number.trim() || narration.trim(), vendors });
        if (typeof sp === 'string') return setError(vtT('billwisePayableShape'));
        void import('../../lib/gateway/voucher-refs-save').then((m) => {
          try {
            m.saveSupplierPayment(sp);
            notify(vtT('supplierPaid', { amount: formatMoney(sp.amount), party: sp.vendorName }));
            done();
          } catch (err) {
            setError((err as Error).message);
          }
        });
        return;
      }
      // Receipt: the voucher and its bill-wise receipt rows in one step (all or nothing).
      const method = effective().some((l) => l.side === 'dr' && l.account_id === 'cash') ? 'Cash' : 'Bank Transfer';
      const receipts = partyLine?.side === 'receivable' && showRefs ? receiptRefsInput(usedRefs, partyLine.party, partyLine.paise / 100, openBills, method) : null;
      const saved = saveReceiptVoucher(input, chart, receipts);
      notify(gwT('vSaved', { number: saved.number }));
      done();
    } catch (err) {
      setError((err as Error).message || 'Could not save the voucher.');
    }
  };

  const toggleMode = () => {
    setError('');
    if (single) {
      setLines(effective().length ? effective() : [blankLine(firstSide(type))]);
      setAccountId('');
      setMode('double');
      try {
        sessionStorage.setItem(MODE_KEY, 'double');
      } catch {
        /* preference only */
      }
      return;
    }
    const view = linesToSingle(type, lines, byId);
    if (!view) return setError(vtT('singleNotPossible'));
    setAccountId(view.accountId || (seriesDefaultBank() ?? ''));
    setLines(view.rows.length ? view.rows : [blankLine(particularsSide(type))]);
    setMode('single');
    try {
      sessionStorage.setItem(MODE_KEY, 'single');
    } catch {
      /* preference only */
    }
  };

  /** Default cash / bank ledger of the chosen voucher type (P1-13). */
  const seriesDefaultBank = (id = vtId) => {
    const t = id ? getTable<VoucherSeries & { bank_account_id?: string }>(VOUCHER_TYPES_TABLE).find((x) => x?.id === id) : undefined;
    return t?.bank_account_id && byId.has(t.bank_account_id) ? t.bank_account_id : undefined;
  };

  const chooseType = (id: string | undefined) => {
    setVoucherTypeId(id);
    const bank = seriesDefaultBank(id);
    if (!bank || existing) return;
    if (single) {
      if (!accountId) setAccountId(bank);
      return;
    }
    if (lines.some((l) => isCashOrBankLedger(byId.get(l.account_id)))) return;
    const side: EntrySide = type === 'RECEIPT' ? 'dr' : 'cr';
    setLines((ls) => [...ls, { key: nextKey(), side, account_id: bank, amount: '' }]);
  };

  const remove = () => {
    if (!existing) return;
    try {
      deleteVoucher(existing.id);
      notify(gwT('vDeleted', { number: existing.number }));
      leave();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const switchType = (t: ManualVoucherType) => {
    if (t === type) return;
    if (single && !SINGLE_ENTRY_TYPES.includes(t)) {
      setLines(effective());
      setAccountId('');
      setMode('double');
    }
    setVoucherTypeId(undefined);
    if (!existing || existing.type !== t) setNumber('');
    navigate(`/gateway/voucher/${typeRoute(t)}${id ? `?id=${encodeURIComponent(id)}` : ''}`, { replace: true });
  };

  /** Enter: move to the next field the way Tally does. */
  const onEnter = (field: string): boolean => {
    if (field === 'number') return focus('date'), true;
    if (field === 'date') return focus(lines[0] ? `${lines[0].key}:${single ? 'ledger' : 'side'}` : 'narration'), true;
    if (field === 'narration') return accept(), true;
    const [k, part] = field.split(':');
    const key = Number(k);
    const idx = lines.findIndex((l) => l.key === key);
    const line = lines[idx];
    if (!line) return false;
    if (part === 'side') return focus(`${key}:ledger`), true;
    if (part === 'ledger') {
      const q = queries[key];
      if (suggest?.key === key && q !== undefined && q.trim()) {
        const hit = suggestionsFor(key)[suggest.index];
        if (hit) choose(key, hit);
        return true;
      }
      if (!line.account_id) {
        // Enter on an empty last line ends the particulars when the voucher balances.
        if (idx === lines.length - 1 && (single ? filledLines(lines).length >= 1 && !!accountId : filledLines(lines).length >= 2 && totals.diff === 0)) {
          setLines(lines.filter((l) => l.key !== key));
          focus('narration');
        }
        return true;
      }
      focus(showCc && isPnl(line.account_id) ? `${key}:cc` : `${key}:amount`);
      setLines(autoFill(lines, key));
      return true;
    }
    if (part === 'cc') return focus(`${key}:amount`), setLines(autoFill(lines, key)), true;
    if (part === 'amount') {
      const filled = autoFill(lines, key);
      if (idx < filled.length - 1) {
        setLines(filled);
        focus(`${filled[idx + 1].key}:ledger`);
        return true;
      }
      const add = single ? blankLine(particularsSide(type)) : nextLine(filled, nextKey(), type, true);
      if (add) {
        setLines([...filled, add]);
        focus(`${add.key}:ledger`);
      } else {
        setLines(filled);
        focus('narration');
      }
      return true;
    }
    return false;
  };

  const fieldOf = (t: EventTarget | null) => (t instanceof HTMLElement ? t.closest<HTMLElement>('[data-field]')?.dataset.field ?? '' : '');

  useScreenKeys((e) => {
    if (creating) return false;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const at = fieldOf(e.target);
    if (confirm) {
      if (k === 'y' || (k === 'enter' && !mod)) {
        if (confirm === 'quit') leave();
        else remove();
        setConfirm(null);
        return true;
      }
      if (k === 'n' || k === 'escape') {
        setConfirm(null);
        return true;
      }
      return false;
    }
    if (mod && !e.altKey && !e.shiftKey && k === 'a') return accept(), true;
    if (e.altKey && !mod && k === 'c') {
      const key = at.includes(':') ? Number(at.split(':')[0]) : (lines.find((l) => !l.account_id)?.key ?? lines[lines.length - 1].key);
      setCreating({ key, name: queries[key] ?? '' });
      return true;
    }
    if (e.altKey && !mod && k === 'd' && existing) return setConfirm('delete'), true;
    if (!mod && !e.altKey && !e.shiftKey && FKEY_TYPE[k]) return switchType(FKEY_TYPE[k]), true;
    if (k === 'f2' && !mod && !e.altKey) return field('date')?.focus(), true;
    if (mod || e.altKey) return false;
    const ledgerKey = at.endsWith(':ledger') ? Number(at.split(':')[0]) : null;
    if (ledgerKey !== null && suggest?.key === ledgerKey && (k === 'arrowdown' || k === 'arrowup')) {
      const n = suggestionsFor(ledgerKey).length;
      if (n) setSuggest({ key: ledgerKey, index: (suggest.index + (k === 'arrowdown' ? 1 : -1) + n) % n });
      return true;
    }
    if (k === 'escape') {
      if (suggest) return setSuggest(null), true;
      if (dirty) setConfirm('quit');
      else leave();
      return true;
    }
    if (k === 'enter' && !e.shiftKey && at) return onEnter(at);
    return false;
  });

  if (!can('books.edit')) {
    return (
      <div className={cn(styles.card, styles.voucher)}>
        <p className={styles.error} role="alert">{gwT('vDenied')}</p>
        <button type="button" className={controls.btnOutline} onClick={() => navigate('/gateway')}>{gwT('back')}</button>
      </div>
    );
  }
  if (id && !existing) {
    return (
      <div className={cn(styles.card, styles.voucher)}>
        <p className={styles.error} role="alert">{gwT('vNotFound')}</p>
        <button type="button" className={controls.btnOutline} onClick={leave}>{gwT('back')}</button>
      </div>
    );
  }

  const typeName = gwT(TYPE_LABEL[type]);
  const sideLabel = (s: EntrySide) => (terms ? gwT(s === 'dr' ? 'vBy' : 'vTo') : gwT(s === 'dr' ? 'vDr' : 'vCr'));

  const amountInput = (l: EntryLine, n: number) => (
    <input
      data-field={`${l.key}:amount`}
      className={cn(controls.input, styles.amountInput)}
      inputMode="decimal"
      value={l.amount}
      onChange={(e) => patch(l.key, { amount: e.target.value.replace(/[^0-9.,]/g, '') })}
      aria-label={`${gwT('vLine', { n })} ${l.side === 'dr' ? gwT('vDebit') : gwT('vCredit')}`}
      data-testid={`vline-${n}-amount`}
    />
  );

  return (
    <>
      <ButtonBar
        extra={[
          { id: 'accept', combo: 'mod+a', label: gwT('bbAccept'), onClick: accept, primary: true },
          { id: 'create', combo: 'alt+c', label: gwT('bbCreate'), onClick: () => setCreating({ key: lines.find((l) => !l.account_id)?.key ?? lines[lines.length - 1].key, name: '' }) },
          { id: 'quit', combo: 'escape', label: gwT('bbQuit'), onClick: () => (dirty ? setConfirm('quit') : leave()) },
          ...(existing ? [{ id: 'delete', combo: 'alt+d', label: gwT('bbDelete'), onClick: () => setConfirm('delete') }] : []),
        ]}
        onVoucherType={(tid) => {
          const t = BAR_TYPE[tid];
          if (!t) return false;
          switchType(t);
          return true;
        }}
      />
      <section ref={rootRef} className={cn(styles.card, styles.voucher)} aria-labelledby="gw-v-title">
        <div className={styles.vHead}>
          <h1 className={styles.vType} id="gw-v-title">
            {existing ? gwT('vAlter', { type: typeName, number: existing.number }) : gwT('vTitle', { type: typeName })}
          </h1>
          <div className={styles.vMeta}>
            <label className={styles.vField}>
              {gwT('vNo')}
              <input
                data-field="number"
                className={cn(controls.input, controls.inputMono)}
                value={number}
                placeholder={preview}
                onChange={(e) => setNumber(e.target.value)}
                size={18}
              />
            </label>
            {branches.length > 0 && (
              <label className={styles.vField}>
                {wireT('branch')}
                <select data-field="branch" className={controls.select} value={branchId} onChange={(e) => setBranchId(e.target.value)} data-testid="gw-v-branch">
                  <option value="">{wireT('branchAuto')}</option>
                  {branches.filter((b) => !b.inactive || b.id === branchId).map((b) => (
                    <option key={b.id} value={b.id}>{b.code ? `${b.code} · ${b.name}` : b.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.vField}>
              {gwT('vDate')}
              <input data-field="date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} aria-keyshortcuts="F2" />
            </label>
            {hasTypes && (
              <label className={styles.vField}>
                {vtT('voucherType')}
                <Suspense fallback={null}>
                  <VoucherTypeSelect id="gw-v-vtype" base={type} value={vtId} compact disabled={!!existing} onChange={(t) => chooseType(t?.id)} />
                </Suspense>
              </label>
            )}
            <label className={styles.vField} title={vtT('classHint')}>
              {vtT('voucherClass')}
              <input data-field="class" className={controls.input} list="gw-v-classes" value={voucherClass} onChange={(e) => setVoucherClass(e.target.value)} size={14} data-testid="gw-v-class" />
              <datalist id="gw-v-classes">
                {classes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            {SINGLE_ENTRY_TYPES.includes(type) && (
              <span className={styles.vField}>
                {vtT('modeLabel')}
                <button type="button" className={controls.btnOutline} onClick={toggleMode} aria-pressed={single} data-testid="gw-v-mode">
                  {single ? vtT('singleEntry') : vtT('doubleEntry')}
                </button>
              </span>
            )}
          </div>
        </div>

        {single && (
          <label className={styles.vField}>
            {vtT('account')}
            <select data-field="account" className={controls.select} value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="gw-v-account" aria-describedby="gw-v-account-hint">
              <option value="">—</option>
              {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span id="gw-v-account-hint" className={styles.hint}>{vtT('accountHint')}</span>
          </label>
        )}

        <div className={styles.tableWrap}>
          <table className={cn(styles.grid, styles.vLines)}>
            <thead>
              <tr>
                <th scope="col">{gwT('vSide')}</th>
                <th scope="col">{gwT('vParticulars')}</th>
                {showCc && <th scope="col">{gwT('vCostCentre')}</th>}
                <th scope="col" className={styles.num}>{gwT('vDebit')}</th>
                <th scope="col" className={styles.num}>{gwT('vCredit')}</th>
                <th scope="col"><span className={surface.srOnly}>{gwT('vRemoveLine', { n: '' })}</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const n = i + 1;
                const query = queries[l.key];
                const shown = query ?? lineLabel(l, byId);
                const open = suggest?.key === l.key && query !== undefined;
                const list = open ? suggestionsFor(l.key) : [];
                const listId = `gw-sug-${l.key}`;
                return (
                  <tr key={l.key}>
                    <td>
                      {single ? <span className={styles.hint}>{sideLabel(l.side)}</span> : <select
                        data-field={`${l.key}:side`}
                        className={cn(controls.select, styles.sideSel)}
                        value={l.side}
                        onChange={(e) => patch(l.key, { side: e.target.value as EntrySide })}
                        aria-label={`${gwT('vLine', { n })} ${gwT('vSide')}`}
                      >
                        <option value="dr">{sideLabel('dr')}</option>
                        <option value="cr">{sideLabel('cr')}</option>
                      </select>}
                    </td>
                    <td className={styles.ledgerCell}>
                      <input
                        data-field={`${l.key}:ledger`}
                        className={controls.input}
                        value={shown}
                        placeholder={gwT('vLedgerPlaceholder')}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={open}
                        aria-controls={listId}
                        aria-activedescendant={open && list[suggest.index] ? `${listId}-${suggest.index}` : undefined}
                        aria-label={`${gwT('vLine', { n })} ${gwT('vParticulars')}`}
                        aria-keyshortcuts="Alt+C"
                        autoComplete="off"
                        onChange={(e) => {
                          setQueries((q) => ({ ...q, [l.key]: e.target.value }));
                          setSuggest({ key: l.key, index: 0 });
                          if (l.account_id) patch(l.key, { account_id: '', party: undefined });
                        }}
                        onFocus={() => {
                          if (!l.account_id) setSuggest({ key: l.key, index: 0 });
                        }}
                        onBlur={() => setTimeout(() => setSuggest((s) => (s?.key === l.key ? null : s)), 150)}
                        data-testid={`vline-${n}-ledger`}
                      />
                      {open && (
                        <ul id={listId} role="listbox" className={styles.suggest} aria-label={gwT('vParticulars')}>
                          {list.length ? (
                            list.map((o, oi) => (
                              <li
                                key={optionKey(o.account_id, o.party)}
                                id={`${listId}-${oi}`}
                                role="option"
                                aria-selected={oi === suggest.index}
                                className={styles.option}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => choose(l.key, o)}
                              >
                                <span>{o.name}</span>
                                <span className={styles.optionSub}>{o.kind === 'account' ? o.sub : `${gwT(o.kind === 'customer' ? (terms ? 'customerTally' : 'customer') : terms ? 'vendorTally' : 'vendor')} · ${o.sub}`}</span>
                              </li>
                            ))
                          ) : (
                            <li className={styles.option} role="option" aria-selected={false} aria-disabled="true">
                              {gwT('vNoMatch', { q: query ?? '' })}
                            </li>
                          )}
                        </ul>
                      )}
                    </td>
                    {showCc && (
                      <td>
                        {isPnl(l.account_id) && (
                          <select
                            data-field={`${l.key}:cc`}
                            className={controls.select}
                            value={l.cost_centre_id ?? ''}
                            onChange={(e) => patch(l.key, { cost_centre_id: e.target.value || undefined })}
                            aria-label={`${gwT('vLine', { n })} ${gwT('vCostCentre')}`}
                          >
                            <option value="">{gwT('vUnallocated')}</option>
                            {pickableCentres(centres, l.cost_centre_id).map((c) => (
                              <option key={c.id} value={c.id}>{costCentreLabel(c, centres)}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}
                    <td className={styles.num}>{l.side === 'dr' && amountInput(l, n)}</td>
                    <td className={styles.num}>{l.side === 'cr' && amountInput(l, n)}</td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className={controls.btnIcon}
                          aria-label={gwT('vRemoveLine', { n })}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className={styles.vTotals}>
                <td colSpan={showCc ? 3 : 2}>
                  {gwT('vTotal')}{' '}
                  <span className={totals.diff ? styles.diff : styles.ok} role="status">
                    {totals.diff ? gwT('vDiff', { amount: money(Math.abs(totals.diff)) }) : totals.dr ? gwT('vBalanced') : ''}
                  </span>
                </td>
                <td className={styles.num}>{money(totals.dr)}</td>
                <td className={styles.num}>{money(totals.cr)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className={controls.btnGhost}
          onClick={() => {
            const add = single ? blankLine(particularsSide(type)) : nextLine(lines, nextKey(), type) ?? blankLine(firstSide(type));
            setLines([...lines, add]);
            focus(`${add.key}:ledger`);
          }}
        >
          + {gwT('vAddLine')}
        </button>

        {showRefs && partyLine && (
          <fieldset className={styles.refs} data-testid="gw-billwise">
            <legend className={styles.hint}>{vtT('billwise', { party: partyLine.party })}</legend>
            {partyLine.side === 'payable' && <p className={styles.hint}>{vtT('billwisePayableHint')}</p>}
            {!openBills.length && <p className={styles.hint}>{vtT('noOpenBills')}</p>}
            {refs.map((r, i) => (
              <div key={r.key} className={styles.refRow}>
                <select className={controls.select} value={r.kind} aria-label={`${vtT('refType')} ${i + 1}`} onChange={(e) => setRefs((rs) => rs.map((x) => (x.key === r.key ? { ...x, kind: e.target.value as RefKind } : x)))} data-testid={`gw-ref-${i + 1}-kind`}>
                  {REF_KINDS.map((k) => <option key={k} value={k}>{vtT(REF_LABEL[k])}</option>)}
                </select>
                {r.kind === 'agst' ? (
                  <select className={controls.select} value={r.bill_id ?? ''} aria-label={`${vtT('bill')} ${i + 1}`} onChange={(e) => setRefs((rs) => rs.map((x) => (x.key === r.key ? { ...x, bill_id: e.target.value || undefined } : x)))} data-testid={`gw-ref-${i + 1}-bill`}>
                    <option value="">—</option>
                    {openBills.map((b) => <option key={b.id} value={b.id}>{`${b.ref} · ${vtT('due', { amount: formatMoney(b.outstanding) })}`}</option>)}
                  </select>
                ) : r.kind === 'new' ? (
                  <input className={controls.input} value={r.name ?? ''} placeholder={vtT('refName')} aria-label={`${vtT('refName')} ${i + 1}`} onChange={(e) => setRefs((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
                ) : <span />}
                <input className={cn(controls.input, styles.amountInput)} inputMode="decimal" value={r.amount} aria-label={`${vtT('amount')} ${i + 1}`} onChange={(e) => setRefs((rs) => rs.map((x) => (x.key === r.key ? { ...x, amount: e.target.value.replace(/[^0-9.,]/g, '') } : x)))} data-testid={`gw-ref-${i + 1}-amount`} />
                <button type="button" className={controls.btnIcon} aria-label={vtT('removeRef', { n: i + 1 })} onClick={() => setRefs((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
            <div className={styles.refActions}>
              <button type="button" className={controls.btnGhost} onClick={() => setRefs((rs) => [...rs, { key: nextKey(), kind: openBills.length ? 'agst' : 'onacc', amount: '' }])} data-testid="gw-ref-add">{vtT('addRef')}</button>
              {openBills.length > 0 && <button type="button" className={controls.btnGhost} onClick={() => setRefs(fifoRefs(openBills, partyLine.paise / 100, nextKey))} data-testid="gw-ref-fifo">{vtT('fifo')}</button>}
              <span className={styles.hint} role="status">{vtT('allocated', { allocated: formatMoney(refs.reduce((sum, r) => sum + (Number(r.amount.replace(/,/g, '')) || 0), 0)), total: formatMoney(partyLine.paise / 100) })}</span>
            </div>
          </fieldset>
        )}

        <label className={styles.narration}>
          <span className={styles.hint}>{gwT('vNarration')}</span>
          <textarea
            data-field="narration"
            className={controls.textarea}
            rows={2}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {confirm && (
          <div className={styles.confirm} role="alertdialog" aria-labelledby="gw-confirm-title">
            <strong id="gw-confirm-title">
              {confirm === 'quit' ? gwT('vQuitTitle') : gwT('vDeleteTitle', { number: existing?.number ?? '' })}
            </strong>
            {confirm === 'quit' && <span className={styles.hint}>{gwT('vQuitBody')}</span>}
            <span>
              <button type="button" className={controls.btnDanger} autoFocus onClick={() => (confirm === 'quit' ? leave() : remove())} aria-keyshortcuts="Y">
                {gwT('yes')} (Y)
              </button>{' '}
              <button type="button" className={controls.btnOutline} onClick={() => setConfirm(null)} aria-keyshortcuts="N">
                {gwT('no')} (N)
              </button>
            </span>
          </div>
        )}

        <div className={styles.vFoot}>
          <span className={styles.hint}>
            {gwT('vHintKeys')}
            <br />
            {gwT('vBillRefNote')}
          </span>
          <span>
            <button type="button" className={controls.btnOutline} onClick={() => (dirty ? setConfirm('quit') : leave())}>
              {gwT('bbQuit')} (Esc)
            </button>{' '}
            <button type="button" className={controls.btnPrimary} onClick={accept} aria-keyshortcuts="Control+A" data-testid="voucher-accept">
              {gwT('bbAccept')} (Ctrl+A)
            </button>
          </span>
        </div>
      </section>

      {creating && (
        <CreateLedgerDialog
          kind="account"
          initialName={creating.name}
          terms={terms}
          onClose={() => {
            const key = creating.key;
            setCreating(null);
            focus(`${key}:ledger`);
          }}
          onCreated={(o) => {
            const key = creating.key;
            setCreating(null);
            setChart(chartOf(loadUserAccounts()));
            setClients(localDb.clients.getAll());
            setVendors(vendorsDb.all());
            notify(gwT('cCreated', { name: o.name }));
            choose(key, o);
          }}
        />
      )}
    </>
  );
}

export default VoucherEntry;
