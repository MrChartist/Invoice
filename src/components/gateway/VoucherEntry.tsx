import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { useT } from '../../i18n';
import { useCan } from '../../hooks/useCan';
import { localDb } from '../../lib/localDb';
import { vendorsDb } from '../../lib/vendors';
import { chartOf, groupOf, loadUserAccounts, type Account } from '../../lib/ledger/accounts';
import { deleteVoucher, loadVouchers, nextVoucherNumber, saveVoucher, validateVoucher, type ManualVoucherType } from '../../lib/ledger/vouchers';
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
  const centres = useMemo(() => loadCostCentres(), []);
  const byId = useMemo(() => new Map(chart.map((a) => [a.id, a])), [chart]);
  const options = useMemo(() => ledgerOptions(chart, clients, vendors, type), [chart, clients, vendors, type]);

  const initialLines = () => (existing ? linesFromVoucher(existing, nextKey) : [blankLine(firstSide(type))]);
  const [date, setDate] = useState(() => existing?.date ?? getVoucherDate());
  const [number, setNumber] = useState(existing?.number ?? '');
  const [narration, setNarration] = useState(existing?.narration ?? '');
  const [lines, setLines] = useState<EntryLine[]>(initialLines);
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
    setLines(existing ? linesFromVoucher(existing, nextKey) : [blankLine(firstSide(type))]);
    setQueries({});
  }

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

  const totals = entryTotals(lines);
  const isPnl = (accountId: string) => {
    const a = byId.get(accountId);
    const n = a ? groupOf(a.group).nature : undefined;
    return n === 'income' || n === 'expense';
  };
  const showCc = centres.length > 0;
  const preview = useMemo(
    () => (existing && existing.type === type ? existing.number : nextVoucherNumber(loadVouchers(), type, isCalendarDay(date) ? date : getVoucherDate())),
    [existing, type, date, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const draftInput = () => toVoucherInput({ id: existing?.id, type, date, narration, number: number.trim() || undefined }, lines, chart);
  const dirty = existing
    ? JSON.stringify({ date, narration, lines: draftInput().lines }) !== baseline
    : filledLines(lines).length > 0 || narration.trim() !== '';

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
    setLines([blankLine(firstSide(type))]);
    setNarration('');
    setNumber('');
    setQueries({});
    setError('');
  };

  const accept = () => {
    setError('');
    const input = draftInput();
    const errors = validateVoucher(input, chart);
    if (errors.length) return setError(errors[0]);
    try {
      const saved = saveVoucher(input, chart);
      notify(gwT('vSaved', { number: saved.number }));
      setVersion((v) => v + 1);
      if (existing) leave();
      else {
        reset();
        focus('date');
      }
    } catch (err) {
      setError((err as Error).message || 'Could not save the voucher.');
    }
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
    if (!existing || existing.type !== t) setNumber('');
    navigate(`/gateway/voucher/${typeRoute(t)}${id ? `?id=${encodeURIComponent(id)}` : ''}`, { replace: true });
  };

  /** Enter: move to the next field the way Tally does. */
  const onEnter = (field: string): boolean => {
    if (field === 'number') return focus('date'), true;
    if (field === 'date') return focus(lines[0] ? `${lines[0].key}:side` : 'narration'), true;
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
        if (idx === lines.length - 1 && filledLines(lines).length >= 2 && totals.diff === 0) {
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
      const add = nextLine(filled, nextKey(), type, true);
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
            <label className={styles.vField}>
              {gwT('vDate')}
              <input data-field="date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} aria-keyshortcuts="F2" />
            </label>
          </div>
        </div>

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
                      <select
                        data-field={`${l.key}:side`}
                        className={cn(controls.select, styles.sideSel)}
                        value={l.side}
                        onChange={(e) => patch(l.key, { side: e.target.value as EntrySide })}
                        aria-label={`${gwT('vLine', { n })} ${gwT('vSide')}`}
                      >
                        <option value="dr">{sideLabel('dr')}</option>
                        <option value="cr">{sideLabel('cr')}</option>
                      </select>
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
            const add = nextLine(lines, nextKey(), type) ?? blankLine(firstSide(type));
            setLines([...lines, add]);
            focus(`${add.key}:ledger`);
          }}
        >
          + {gwT('vAddLine')}
        </button>

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
