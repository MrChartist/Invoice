/**
 * Tabs of the TDS & TCS page (Tally parity): overview (deducted vs deposited vs filed, due dates),
 * deductions register with interest, challans (ITNS 281) linked to deductions, quarterly return
 * working papers (26Q / 27EQ) and Form 16A data.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, Download, FileText, IndianRupee, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  autoLink,
  challanByKey,
  challanTotal,
  deleteChallan,
  deleteManualDeduction,
  dueCalendar,
  interestFor,
  isPayrollChallan,
  quarterSummaries,
  saveChallan,
  saveManualDeduction,
  setReturnFiled,
  type TdsChallan,
  type TdsDeductionRow,
  type TdsQuarter,
  type TdsReturnMark,
  type ManualTdsDeduction,
} from '../../lib/tds-payables';
import { form16ACsv, form16AData, form26Q, form27EQ, paperCsv, paperSheets, paperText, type ReturnPaper, type TcsRow } from '../../lib/tds-returns';
import { TDS_PAYABLE_SECTIONS } from '../../lib/tds-rules';
import { PAYMENT_METHODS } from '../../lib/purchases';
import { round2 } from '../../lib/invoice-calc';
import { downloadText } from '../../lib/download';
import { formatDate, formatMoney, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { StatCard } from '../ui/StatCard';
import { EmptyState } from '../ui/EmptyState';
import { Term } from '../help/Term';
import { useT } from '../../i18n';
import { tdsT } from '../../i18n/areas/tds';
import { o7T } from '../../i18n/areas/gst-tds-7o';
import { r7T } from '../../i18n/areas/gst-tds-7r';
import { p40T } from '../../i18n/areas/statutory-p40';
import { flagsByKey, loadJustifications, type JustificationKind } from '../../lib/traces-justification';
import { ita25T, ita25Words } from '../../i18n/areas/ita2025';
import { formText, periodStart, quarterStart, sectionText, withActRef } from '../../lib/ita2025';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import books from '../books/books.module.css';
import styles from '../books/tally/tally.module.css';

export interface TdsData {
  rows: TdsDeductionRow[];
  tcs: TcsRow[];
  challans: TdsChallan[];
  marks: TdsReturnMark[];
  manual: ManualTdsDeduction[];
}

type Notify = (m: string, tone?: 'success' | 'error') => void;
const inr = (n: number) => `₹${formatMoney(n)}`;
const fyText = (fy: number) => `FY ${fy}-${String(fy + 1).slice(2)}`;

/* ── Overview ─────────────────────────────────────────────────── */

export function OverviewTab({ data, fy, today }: { data: TdsData; fy: number; today: string }) {
  useT();
  const tds = quarterSummaries(data.rows, data.challans, data.marks, fy, today, 'TDS');
  const tcs = quarterSummaries(data.tcs, data.challans, data.marks, fy, today, 'TCS');
  const due = [...dueCalendar(data.rows, data.challans, data.marks, fy, today, 'TDS'), ...dueCalendar(data.tcs, data.challans, data.marks, fy, today, 'TCS')].sort((a, b) => a.due.localeCompare(b.due));
  const sum = (list: typeof tds, k: 'deducted' | 'deposited' | 'undeposited' | 'interest') => round2(list.reduce((s, q) => s + q[k], 0));
  const stText = { filed: tdsT('stFiled'), overdue: tdsT('stOverdue'), due: tdsT('stDue'), empty: tdsT('stEmpty') } as const;
  const dueText = { done: tdsT('stDone'), late: tdsT('stLate'), overdue: tdsT('stOverdue'), upcoming: tdsT('stUpcoming') } as const;
  // R6-A3: the TDS / TCS heading cells explain themselves (glossary popover).
  const table = (title: string, list: typeof tds, word: string, term: 'tds' | 'tcs') => (
    <div className={surface.card}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{title}</caption>
          <thead>
            <tr>
              <th scope="col"><Term id={term}>{title}</Term></th>
              <th scope="col" className={surface.numeric}>{word}</th>
              <th scope="col" className={surface.numeric}>{tdsT('deposited')}</th>
              <th scope="col" className={surface.numeric}>{tdsT('undeposited')}</th>
              <th scope="col" className={surface.numeric}>{tdsT('interest')}</th>
              <th scope="col">{tdsT('returnDue')}</th>
              <th scope="col">{tdsT('status')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((q) => (
              <tr key={q.quarter}>
                <td>Q{q.quarter}</td>
                <td className={surface.numeric}>{formatMoney(q.deducted)}</td>
                <td className={surface.numeric}>{formatMoney(q.deposited)}</td>
                <td className={surface.numeric}>{formatMoney(q.undeposited)}</td>
                <td className={surface.numeric}>{q.interest ? formatMoney(q.interest) : ''}</td>
                <td>{formatDate(q.returnDue)}</td>
                <td>{q.filed ? tdsT('filedOn', { date: formatDate(q.filed.filed_on) }) : stText[q.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <div className={books.stack}>
      <div className={surface.statGrid}>
        <StatCard label={tdsT('deducted')} value={inr(sum(tds, 'deducted'))} icon={IndianRupee} />
        <StatCard label={tdsT('deposited')} value={inr(sum(tds, 'deposited'))} icon={Landmark} />
        <StatCard label={tdsT('undeposited')} value={inr(sum(tds, 'undeposited'))} icon={CalendarClock} tone={sum(tds, 'undeposited') > 0 ? 'warning' : 'default'} />
        <StatCard label={tdsT('interest')} value={inr(sum(tds, 'interest') + sum(tcs, 'interest'))} icon={FileText} />
      </div>
      {table(tdsT('kindTds'), tds, tdsT('deducted'), 'tds')}
      {table(tdsT('kindTcs'), tcs, tdsT('collected'), 'tcs')}
      <div className={surface.card}>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{tdsT('calendar')}</caption>
            <thead>
              <tr>
                <th scope="col">{tdsT('calendar')}</th>
                <th scope="col">{tdsT('due')}</th>
                <th scope="col" className={surface.numeric}>₹</th>
                <th scope="col">{tdsT('status')}</th>
              </tr>
            </thead>
            <tbody>
              {due.length === 0 && (
                <tr><td colSpan={4} className={books.muted}>{tdsT('noRows')}</td></tr>
              )}
              {due.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.what === 'deposit'
                      ? tdsT('whatDeposit', { kind: d.kind, period: d.period })
                      : d.what === 'return'
                        ? tdsT('whatReturn', { form: formText(d.kind === 'TDS' ? '26Q' : '27EQ', periodStart(d.period), ita25Words()), period: d.period })
                        : tdsT('whatCert', { period: d.period })}
                  </td>
                  <td>{formatDate(d.due)}</td>
                  <td className={surface.numeric}>{formatMoney(d.amount)}</td>
                  <td>{dueText[d.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className={books.muted}>{tdsT('verifyCa')}</p>
    </div>
  );
}

/* ── Deductions ───────────────────────────────────────────────── */

/** PENDING 40: TRACES justification findings (open ones) beside the deductions they were matched to. */
const TRACES_KIND: Record<JustificationKind, Parameters<typeof r7T>[0]> = {
  SHORT_DEDUCTION: 'jkShortDeduction', SHORT_PAYMENT: 'jkShortPayment', LATE_DEDUCTION: 'jkLateDeduction', LATE_PAYMENT: 'jkLatePayment', LATE_FILING: 'jkLateFiling', PAN_ERROR: 'jkPanError', OTHER: 'jkOther',
};

export function DeductionsTab({ data, fy, today, canEdit, onChanged, notify }: { data: TdsData; fy: number; today: string; canEdit: boolean; onChanged: () => void; notify: Notify }) {
  useT();
  const [editing, setEditing] = useState<ManualTdsDeduction | 'new' | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the register changes (a re-match may follow)
  const traces = useMemo(() => flagsByKey(loadJustifications()), [data]);
  const byKey = challanByKey(data.challans);
  const rows = data.rows.filter((r) => r.fy === fy);
  return (
    <div className={books.stack}>
      {canEdit && (
        <div className={`${books.toolbar} no-print`}>
          <span />
          <button type="button" className={controls.btnOutline} onClick={() => setEditing('new')}><Plus size={16} /> {tdsT('addManual')}</button>
        </div>
      )}
      <div className={surface.card}>
        {rows.length === 0 ? (
          <EmptyState icon={IndianRupee} title={tdsT('noDeductions')} text={tdsT('noDeductionsText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{tdsT('tabDeductions')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tdsT('payee')}</th>
                  <th scope="col">{tdsT('sectionShort')}</th>
                  <th scope="col">{tdsT('billNo')}</th>
                  <th scope="col">{tdsT('creditedOn')}</th>
                  <th scope="col">{tdsT('deductedOn')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('base')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('rate')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('amount')}</th>
                  <th scope="col">{tdsT('challan')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('interest')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ch = byKey.get(r.key);
                  const est = interestFor(r, ch?.date, today);
                  const manual = r.manualId ? data.manual.find((m) => m.id === r.manualId) : undefined;
                  const flags = traces.get(r.key);
                  return (
                    <tr key={r.key}>
                      <td>
                        {r.payee}<div className={styles.alloc}>{r.pan || 'PANNOTAVBL'}</div>
                        {flags && <div className={styles.alloc} data-traces-flag><strong>{p40T('tracesFlag', { kinds: flags.map((k) => r7T(TRACES_KIND[k])).join(', ') })}</strong></div>}
                      </td>
                      <td>{sectionText(r.section, r.creditedOn, ita25Words())}</td>
                      <td className={surface.mono}>{r.billNumber}</td>
                      <td>{formatDate(r.creditedOn)}</td>
                      <td>{formatDate(r.deductedOn)}</td>
                      <td className={surface.numeric}>{formatMoney(r.base)}</td>
                      <td className={surface.numeric}>{r.rate}%</td>
                      <td className={surface.numeric}>
                        {formatMoney(r.amount)}
                        {r.returnReversed ? (
                          <div className={styles.alloc} data-tds-return>
                            {o7T('retReversed', { amount: formatMoney(r.returnReversed), date: formatDate(r.returnDate ?? '') })}
                            {ch && r.returnDate && ch.date < r.returnDate ? ` ${o7T('retAfterDeposit')}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td>{ch ? `${ch.bsr_code}/${ch.challan_no} · ${formatDate(ch.date)}` : tdsT('notLinked')}</td>
                      <td className={surface.numeric}>
                        {est.total ? formatMoney(est.total) : ''}
                        {est.total > 0 && (
                          <div className={styles.alloc}>
                            {est.monthsLateDeduction ? tdsT('lateDeduction', { months: est.monthsLateDeduction }) : ''} {est.monthsLatePayment ? tdsT('latePayment', { months: est.monthsLatePayment }) : ''} {est.accruing ? tdsT('accruing') : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        {manual && canEdit && (
                          <span className={books.toolbarGroup}>
                            <button type="button" className={controls.btnIcon} aria-label={tdsT('edit')} onClick={() => setEditing(manual)}><Pencil size={15} /></button>
                            <button
                              type="button"
                              className={controls.btnIcon}
                              aria-label={tdsT('delete')}
                              onClick={() => {
                                try {
                                  deleteManualDeduction(manual.id);
                                  onChanged();
                                  notify(tdsT('deleted'));
                                } catch (err) {
                                  notify((err as Error).message, 'error');
                                }
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <ManualModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); notify(tdsT('saved')); }} />}
    </div>
  );
}

function ManualModal({ row, onClose, onSaved }: { row: ManualTdsDeduction | null; onClose: () => void; onSaved: () => void }) {
  useT();
  const [v, setV] = useState({
    vendor_name: row?.vendor_name ?? '',
    pan: row?.pan ?? '',
    section: row?.section ?? '194J',
    date: row?.date ?? todayInput(),
    base: String(row?.base ?? ''),
    rate: String(row?.rate ?? ''),
    amount: String(row?.amount ?? ''),
  });
  const [error, setError] = useState('');
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const save = () => {
    try {
      saveManualDeduction({ id: row?.id, vendor_name: v.vendor_name, pan: v.pan, section: v.section, date: v.date, base: Number(v.base) || 0, rate: Number(v.rate) || 0, amount: Number(v.amount) || 0 });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} size="md" title={tdsT('manualTitle')} subtitle={tdsT('manualNote')} footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{tdsT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={save}>{tdsT('save')}</button></>}>
      <div className={styles.grid}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-payee">{tdsT('payee')}</label>
          <input id="md-payee" className={controls.input} value={v.vendor_name} onChange={(e) => set({ vendor_name: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-pan">{tdsT('pan')}</label>
          <input id="md-pan" className={`${controls.input} ${controls.inputMono}`} maxLength={10} value={v.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-sec">{tdsT('section')}</label>
          <select id="md-sec" className={controls.select} value={v.section} onChange={(e) => set({ section: e.target.value })}>
            {TDS_PAYABLE_SECTIONS.map((s) => <option key={s.code} value={s.code}>{withActRef(s.label, s.code, v.date, ita25Words())}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-date">{tdsT('date')}</label>
          <input id="md-date" type="date" className={controls.input} value={v.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-base">{tdsT('base')}</label>
          <input id="md-base" inputMode="decimal" className={controls.input} value={v.base} onChange={(e) => set({ base: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-rate">{tdsT('rate')}</label>
          <input id="md-rate" inputMode="decimal" className={controls.input} value={v.rate} onChange={(e) => set({ rate: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="md-amt">{tdsT('amount')}</label>
          <input id="md-amt" inputMode="decimal" className={controls.input} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
        </div>
      </div>
      {error && <div className={controls.error} role="alert">{error}</div>}
    </Modal>
  );
}

/* ── Challans ─────────────────────────────────────────────────── */

export function ChallansTab({ data, canEdit, onChanged, notify }: { data: TdsData; canEdit: boolean; onChanged: () => void; notify: Notify }) {
  useT();
  const [editing, setEditing] = useState<TdsChallan | 'new' | null>(null);
  const list = [...data.challans].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className={books.stack}>
      {canEdit && (
        <div className={`${books.toolbar} no-print`}>
          <span />
          <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}><Plus size={16} /> {tdsT('newChallan')}</button>
        </div>
      )}
      <div className={surface.card}>
        {list.length === 0 ? (
          <EmptyState icon={Landmark} title={tdsT('noChallans')} text={tdsT('noChallansText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{tdsT('tabChallans')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tdsT('depositDate')}</th>
                  <th scope="col">{tdsT('kind')}</th>
                  <th scope="col">{tdsT('bsr')}</th>
                  <th scope="col">{tdsT('challanNo')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('tax')}</th>
                  <th scope="col" className={surface.numeric}>{tdsT('total')}</th>
                  <th scope="col">{tdsT('link')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.date)}</td>
                    <td>{isPayrollChallan(c) ? tdsT('payroll192') : c.kind}</td>
                    <td className={surface.mono}>{c.bsr_code}</td>
                    <td className={surface.mono}>{c.challan_no}</td>
                    <td className={surface.numeric}>{formatMoney(c.amount)}</td>
                    <td className={surface.numeric}>{formatMoney(challanTotal(c))}</td>
                    <td>{c.deduction_keys.length}</td>
                    <td>
                      {canEdit && !isPayrollChallan(c) && (
                        <span className={books.toolbarGroup}>
                          <button type="button" className={controls.btnIcon} aria-label={tdsT('edit')} onClick={() => setEditing(c)}><Pencil size={15} /></button>
                          <button
                            type="button"
                            className={controls.btnIcon}
                            aria-label={tdsT('delete')}
                            onClick={() => {
                              try {
                                deleteChallan(c.id);
                                onChanged();
                                notify(tdsT('deleted'));
                              } catch (err) {
                                notify((err as Error).message, 'error');
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <ChallanModal data={data} challan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); notify(tdsT('challanSaved')); }} />}
    </div>
  );
}

function ChallanModal({ data, challan, onClose, onSaved }: { data: TdsData; challan: TdsChallan | null; onClose: () => void; onSaved: () => void }) {
  useT();
  const [kind, setKind] = useState<'TDS' | 'TCS'>(challan?.kind ?? 'TDS');
  const [date, setDate] = useState(challan?.date ?? todayInput());
  const [bsr, setBsr] = useState(challan?.bsr_code ?? '');
  const [no, setNo] = useState(challan?.challan_no ?? '');
  const [amount, setAmount] = useState(String(challan?.amount ?? ''));
  const [interest, setInterest] = useState(String(challan?.interest ?? ''));
  const [fee, setFee] = useState(String(challan?.fee ?? ''));
  const [method, setMethod] = useState(challan?.method ?? 'Bank transfer');
  const [keys, setKeys] = useState<string[]>(challan?.deduction_keys ?? []);
  const [error, setError] = useState('');
  const pool = kind === 'TDS' ? data.rows : data.tcs;
  const others = data.challans.filter((c) => c.id !== challan?.id);
  const taken = challanByKey(others);
  const open = pool.filter((r) => !taken.has(r.key));
  const linked = round2(open.filter((r) => keys.includes(r.key)).reduce((s, r) => s + r.amount, 0));
  const save = () => {
    try {
      saveChallan({ id: challan?.id, kind, date, bsr_code: bsr, challan_no: no, amount: Number(amount) || 0, interest: Number(interest) || 0, fee: Number(fee) || 0, method, minor_head: '200', deduction_keys: keys }, pool);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={tdsT('challanTitle')} footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{tdsT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={save}>{tdsT('save')}</button></>}>
      <div className={books.stack}>
        <div className={styles.grid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-kind">{tdsT('kind')}</label>
            <select id="ch-kind" className={controls.select} value={kind} onChange={(e) => { setKind(e.target.value === 'TCS' ? 'TCS' : 'TDS'); setKeys([]); }}>
              <option value="TDS">TDS</option>
              <option value="TCS">TCS</option>
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-date">{tdsT('depositDate')}</label>
            <input id="ch-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-bsr">{tdsT('bsr')}</label>
            <input id="ch-bsr" inputMode="numeric" maxLength={7} className={`${controls.input} ${controls.inputMono}`} value={bsr} onChange={(e) => setBsr(e.target.value.trim())} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-no">{tdsT('challanNo')}</label>
            <input id="ch-no" inputMode="numeric" maxLength={5} className={`${controls.input} ${controls.inputMono}`} value={no} onChange={(e) => setNo(e.target.value.trim())} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-amt">{tdsT('tax')}</label>
            <input id="ch-amt" inputMode="decimal" className={controls.input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-int">{tdsT('interest')}</label>
            <input id="ch-int" inputMode="decimal" className={controls.input} value={interest} onChange={(e) => setInterest(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-fee">{tdsT('fee')}</label>
            <input id="ch-fee" inputMode="decimal" className={controls.input} value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ch-method">{tdsT('paidFrom')}</label>
            <select id="ch-method" className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className={books.toolbar}>
          <strong>{tdsT('link')}</strong>
          <button type="button" className={controls.btnGhost} onClick={() => setKeys(autoLink(open, others, Number(amount) || 0, date))}>{tdsT('autoLink')}</button>
        </div>
        <div className={styles.allocList} role="group" aria-label={tdsT('link')}>
          {open.length === 0 && <p className={books.muted}>{tdsT('noRows')}</p>}
          {open.map((r) => (
            <label key={r.key} className={controls.check}>
              <input type="checkbox" checked={keys.includes(r.key)} onChange={(e) => setKeys((k) => (e.target.checked ? [...k, r.key] : k.filter((x) => x !== r.key)))} />
              {formatDate(r.deductedOn)} · {'payee' in r ? r.payee : r.collectee} · {'section' in r ? r.section : r.code} · {inr(r.amount)}
            </label>
          ))}
        </div>
        <p className={controls.hint} aria-live="polite">{tdsT('linked', { linked: formatMoney(linked), amount: formatMoney(Number(amount) || 0) })}</p>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/* ── Returns ──────────────────────────────────────────────────── */

async function downloadXlsxFile(name: string, p: ReturnPaper) {
  const { downloadXlsx } = await import('../../lib/xlsx');
  await downloadXlsx(name, paperSheets(p));
}

export function ReturnsTab({ data, fy, quarter, canEdit, onChanged, notify }: { data: TdsData; fy: number; quarter: TdsQuarter; canEdit: boolean; onChanged: () => void; notify: Notify }) {
  useT();
  const [form, setForm] = useState<'26Q' | '27EQ'>('26Q');
  const [filedOn, setFiledOn] = useState(todayInput());
  const [token, setToken] = useState('');
  const paper = useMemo(() => (form === '26Q' ? form26Q(data.rows, data.challans, fy, quarter) : form27EQ(data.tcs, data.challans, fy, quarter)), [form, data, fy, quarter]);
  const mark = data.marks.find((m) => m.id === `${form}:${fy}-Q${quarter}`);
  const base = `form-${form}-${fy}-Q${quarter}`;
  const block = (title: string, rows: (string | number)[][]) => (
    <div className={surface.card}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{title}</caption>
          <thead>
            <tr>{rows[0].map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 1 && <tr><td colSpan={rows[0].length} className={books.muted}>{tdsT('noRows')}</td></tr>}
            {rows.slice(1).map((r, i) => (
              <tr key={i} data-form-row={form}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  const mark2 = (day: string | null) => {
    try {
      setReturnFiled(form, fy, quarter, day, token);
      onChanged();
      notify(tdsT('saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={books.stack}>
      <div className={`${books.toolbar} no-print`}>
        <div className={styles.subTabs} role="group" aria-label={tdsT('tabReturns')}>
          {(['26Q', '27EQ'] as const).map((f) => (
            <button key={f} type="button" className={form === f ? books.chipActive : books.chip} aria-pressed={form === f} onClick={() => setForm(f)}>{ita25T(f === '26Q' ? 'kindTds' : 'kindTcs', { form: formText(f, quarterStart(fy, quarter), ita25Words()) })}</button>
          ))}
        </div>
        <div className={books.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`${base}.csv`, paperCsv(paper), 'text/csv')}><Download size={16} /> {tdsT('csv')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => void downloadXlsxFile(`${base}.xlsx`, paper)}><Download size={16} /> {tdsT('xlsx')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`${base}.txt`, paperText(paper))}><Download size={16} /> {tdsT('text')}</button>
        </div>
      </div>
      <p className={books.notice}>{tdsT('unverified')}</p>
      <p className={books.muted}>
        {fyText(fy)} · Q{quarter} · {tdsT('deducted')} {inr(paper.totals.deducted)} · {tdsT('deposited')} {inr(paper.totals.deposited)}
      </p>
      <h3 className={books.muted}>{tdsT('challanDetails')}</h3>
      {block(tdsT('challanDetails'), paper.challanRows)}
      <h3 className={books.muted}>{form === '26Q' ? tdsT('deducteeDetails') : tdsT('collecteeDetails')}</h3>
      {block(form === '26Q' ? tdsT('deducteeDetails') : tdsT('collecteeDetails'), paper.deducteeRows)}
      {paper.warnings.length > 0 && (
        <div className={books.noticeWarn} role="note">
          <strong>{tdsT('warnings')}</strong>
          <ul>{paper.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {canEdit && (
        <div className={books.toolbar}>
          {mark ? (
            <>
              <span>{tdsT('filedOn', { date: formatDate(mark.filed_on) })}{mark.token ? ` · ${mark.token}` : ''}</span>
              <button type="button" className={controls.btnGhost} onClick={() => mark2(null)}>{tdsT('clearFiled')}</button>
            </>
          ) : (
            <div className={books.toolbarGroup}>
              <input aria-label={tdsT('date')} type="date" className={controls.input} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
              <input aria-label={tdsT('token')} placeholder={tdsT('token')} className={controls.input} value={token} onChange={(e) => setToken(e.target.value)} />
              <button type="button" className={controls.btnOutline} onClick={() => mark2(filedOn)}>{tdsT('markFiled')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Form 16A ─────────────────────────────────────────────────── */

export function Form16aTab({ data, fy, quarter }: { data: TdsData; fy: number; quarter: TdsQuarter }) {
  useT();
  const list = form16AData(data.rows, data.challans, fy, quarter);
  return (
    <div className={books.stack}>
      <div className={`${books.toolbar} no-print`}>
        <p className={books.muted}><strong>{ita25T('formData', { form: formText('16A', quarterStart(fy, quarter), ita25Words()) })}</strong> · {tdsT('f16aNote')}</p>
        <button type="button" className={controls.btnOutline} onClick={() => downloadText(`form-16A-data-${fy}-Q${quarter}.csv`, form16ACsv(list), 'text/csv')}><Download size={16} /> {tdsT('csv')}</button>
      </div>
      {list.length === 0 && <p className={books.muted}>{tdsT('noRows')}</p>}
      {list.map((g) => (
        <div key={g.payeeKey} className={surface.card}>
          <div className={surface.cardBody}>
            <strong>{g.payee}</strong>
            <span className={books.muted}>{g.pan || 'PANNOTAVBL'} · {formatDate(g.period.from)} – {formatDate(g.period.to)}</span>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{g.payee}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tdsT('sectionShort')}</th>
                    <th scope="col">{tdsT('creditedOn')}</th>
                    <th scope="col" className={surface.numeric}>{tdsT('paid')}</th>
                    <th scope="col" className={surface.numeric}>{tdsT('amount')}</th>
                    <th scope="col">{tdsT('deposited')}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{sectionText(r.code, r.date, ita25Words())}</td>
                      <td>{formatDate(r.date)}</td>
                      <td className={surface.numeric}>{formatMoney(r.paid)}</td>
                      <td className={surface.numeric}>{formatMoney(r.tds)}</td>
                      <td>{r.deposited ? '✓' : '-'}</td>
                    </tr>
                  ))}
                  <tr className={books.totalRow}>
                    <td colSpan={2}>{tdsT('total')}</td>
                    <td className={surface.numeric}>{formatMoney(g.totalPaid)}</td>
                    <td className={surface.numeric}>{formatMoney(g.totalTds)}</td>
                    <td>{g.challans.map((c) => `${c.bsr}/${c.challanNo}`).join(', ')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
