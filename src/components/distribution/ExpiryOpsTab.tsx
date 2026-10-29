import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { StockItem, StockPosition } from '../../lib/inventory';
import { stockDb } from '../../lib/inventory';
import type { TrackingMap } from '../../lib/stock-tracking';
import {
  brkExpCandidates, claimsDb, createBrkExpIssue, destroyExpiryStock, groupBySupplier, itcReminders, receiptsDb, returnedByLine,
  type ExpiryClaim, type IssueRow, type ReceiptLine,
} from '../../lib/expiry-ops';
import { purchasesDb } from '../../lib/purchases';
import { purchaseReturnsDb } from '../../lib/purchase-returns';
import { godownsDb } from '../../lib/godowns';
import { plusDays, readPharmaSettings } from '../../lib/pharma-gate';
import { localDb } from '../../lib/localDb';
import { generateId } from '../../lib/storage';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { phT } from '../../i18n/areas/pharma-ops';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

type Section = 'issue' | 'claims' | 'receive' | 'destroy';

const blankLine = (): ReceiptLine => ({ id: generateId(), item_id: '', qty: 0 });

/** 8.84 Marg-style pharma operations: Breakage / Expiry Issue & Receive, claims, destruction + ITC reminder. */
export default function ExpiryOpsTab({ items, positions, tracking, today, onChanged }: {
  items: StockItem[]; positions: StockPosition[]; tracking: TrackingMap; today: string; onChanged: (msg: string, error?: boolean) => void;
}) {
  useT();
  const [section, setSection] = useState<Section>('issue');
  const [days, setDays] = useState(() => readPharmaSettings().near_expiry_days || 90);
  const [date, setDate] = useState(today);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [onePerSupplier, setOnePerSupplier] = useState(false); // 8.88: one debit note spanning the supplier's bills
  const [tick, setTick] = useState(0);
  const godowns = useMemo(() => godownsDb.list(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const expiryGodowns = godowns.filter((g) => g.kind === 'expiry');
  const saleable = godowns.filter((g) => g.kind !== 'expiry');
  const gname = (id: string) => godowns.find((g) => g.id === id)?.name ?? id;

  const cand = useMemo(() => {
    const purchases = purchasesDb.all();
    return brkExpCandidates(tracking, purchases, today, plusDays(today, Math.max(days, 0)), returnedByLine(purchaseReturnsDb.all(), purchases));
  }, [tracking, today, days]);
  const groups = groupBySupplier(cand.rows);
  const claims = useMemo(() => claimsDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn: () => string) => {
    try {
      onChanged(fn());
      setTick((t) => t + 1);
    } catch (err) {
      onChanged((err as Error).message, true);
    }
  };

  const chosen = (): IssueRow[] => cand.rows.filter((r) => !skip.has(r.key)).map((r) => ({ ...r, qty: Math.min(qty[r.key] ?? r.qty, r.qty) }));

  /* Receive */
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const [rc, setRc] = useState({ client: '', godown: '', from: '', notes: '' });
  const [rLines, setRLines] = useState<ReceiptLine[]>([blankLine()]);
  const [repl, setRepl] = useState<ReceiptLine[]>([]);

  /* Destroy */
  const posById = new Map(positions.map((p) => [p.item.id, p]));
  const expiryStock = useMemo(() => {
    const out: { key: string; item: StockItem; batch: string; godown: string; qty: number }[] = [];
    const ids = new Set(expiryGodowns.map((g) => g.id));
    for (const t of tracking.values()) {
      if (t.batches.length) {
        for (const b of t.batches) for (const [g, q] of Object.entries(b.byGodown)) if (ids.has(g) && q > 0) out.push({ key: `${t.item.id}|${b.batch}|${g}`, item: t.item, batch: b.batch, godown: g, qty: q });
      } else {
        for (const [g, q] of Object.entries(t.byGodown)) if (ids.has(g) && q > 0) out.push({ key: `${t.item.id}||${g}`, item: t.item, batch: '', godown: g, qty: q });
      }
    }
    return out;
  }, [tracking, expiryGodowns]);
  const [destroyPick, setDestroyPick] = useState<Set<string>>(new Set());
  const reminders = useMemo(() => itcReminders(stockDb.moves(), items), [items, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineEditor = (lines: ReceiptLine[], set: (l: ReceiptLine[]) => void, label: string) => (
    <div className={own.stack}>
      <p className={own.muted}>{label}</p>
      {lines.map((l, i) => (
        <div key={l.id} className={own.row}>
          <select className={controls.select} aria-label={phT('item')} value={l.item_id} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}>
            <option value="">{phT('item')}</option>
            {items.filter((it) => it.track_stock).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <input className={controls.input} aria-label={phT('batch')} placeholder={phT('batch')} value={l.batch_no ?? ''} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, batch_no: e.target.value } : x)))} />
          <input type="number" min={0} className={controls.input} aria-label={phT('qty')} placeholder={phT('qty')} value={l.qty || ''} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
          <button type="button" className={controls.btnIcon} aria-label={phT('removeLine')} onClick={() => set(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => set([...lines, blankLine()])}><Plus size={14} aria-hidden="true" /> {phT('addLine')}</button>
    </div>
  );

  const decide = (c: ExpiryClaim, state: 'credited' | 'rejected') => {
    const number = state === 'credited' ? window.prompt(phT('askCnNumber')) ?? '' : '';
    if (state === 'credited' && !number.trim()) return;
    const remarks = state === 'rejected' ? window.prompt(phT('askRemark')) ?? '' : '';
    if (state === 'rejected' && !remarks.trim()) return;
    run(() => {
      claimsDb.decide(c.id, state, { supplierNoteNumber: number, supplierNoteDate: today, remarks, on: today }, (id, n, d) => purchaseReturnsDb.setSupplierNote(id, n, d));
      return phT(state === 'credited' ? 'claimCredited' : 'claimRejected');
    });
  };

  return (
    <div className={own.stack} data-expiry-ops>
      <div className={controls.segment} role="tablist" aria-label={phT('title')}>
        {(['issue', 'claims', 'receive', 'destroy'] as Section[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setSection(s)}>{phT(s)}</button>
        ))}
      </div>

      {section === 'issue' && (
        <div className={own.stack}>
          <p className={own.muted}>{phT('issueIntro')}</p>
          <div className={own.row}>
            <label className={controls.field}><span className={controls.label}>{phT('withinDays')}</span>
              <input type="number" min={0} className={controls.input} value={days} onChange={(e) => setDays(Math.max(Number(e.target.value) || 0, 0))} /></label>
            <label className={controls.field}><span className={controls.label}>{phT('noteDate')}</span>
              <input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          {groups.length === 0 && <p className={own.muted}>{phT('nothingDue')}</p>}
          {groups.map((g) => (
            <div key={g.key} className={own.tableWrap} data-supplier-group={g.vendorName}>
              <table className={own.table}>
                <thead>
                  <tr className={own.group}><th colSpan={7}>{g.vendorName} · {phT('billsN', { n: g.bills.length })} · {formatCurrency(g.value)}</th></tr>
                  <tr><th /><th>{phT('item')}</th><th>{phT('batch')}</th><th>{phT('expiry')}</th><th>{phT('godown')}</th><th>{phT('bill')}</th><th className={own.num}>{phT('qty')}</th></tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.key}>
                      <td><input type="checkbox" aria-label={phT('include', { item: r.item })} checked={!skip.has(r.key)} onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(r.key); else n.add(r.key); setSkip(n); }} /></td>
                      <td>{r.item}</td><td>{r.batch}</td><td>{r.expiry}{r.expired ? ` · ${phT('expired')}` : ''}</td><td>{gname(r.godown)}</td><td>{r.billNumber}</td>
                      <td className={own.num}><input type="number" min={0} max={r.qty} className={controls.input} aria-label={phT('qty')} value={qty[r.key] ?? r.qty} onChange={(e) => setQty({ ...qty, [r.key]: Math.min(Math.max(Number(e.target.value) || 0, 0), r.qty) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {cand.untraced.length > 0 && <p className={`${own.notice}`}>{phT('untraced', { list: cand.untraced.map((u) => `${u.item} ${u.batch} (${u.qty})`).join(', ') })}</p>}
          {groups.length > 0 && (
            <label className={controls.check}>
              <input type="checkbox" checked={onePerSupplier} onChange={(e) => setOnePerSupplier(e.target.checked)} data-brk-one-note /> {phT('onePerSupplier')}
            </label>
          )}
          {groups.length > 0 && (
            <button type="button" className={controls.btnPrimary} data-brk-issue onClick={() => run(() => {
              const made = createBrkExpIssue(chosen(), date, { createNote: (d) => purchaseReturnsDb.create(d), createMultiNote: (d) => purchaseReturnsDb.createMulti(d) }, undefined, { onePerSupplier });
              setSkip(new Set());
              setQty({});
              return phT('issued', { claims: made.length, notes: made.reduce((s, c) => s + c.note_numbers.length, 0) });
            })}>{phT('createNotes', { n: groups.length })}</button>
          )}
        </div>
      )}

      {section === 'claims' && (
        <div className={own.tableWrap}>
          {claims.length === 0 ? <p className={own.muted}>{phT('noClaims')}</p> : (
            <table className={own.table}>
              <thead><tr><th>{phT('date')}</th><th>{phT('supplier')}</th><th>{phT('notes')}</th><th className={own.num}>{phT('amount')}</th><th>{phT('state')}</th><th /></tr></thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} data-claim-state={c.state}>
                    <td>{c.date}</td><td>{c.vendor_name}</td><td>{c.note_numbers.join(', ')}</td><td className={own.num}>{formatCurrency(c.amount)}</td>
                    <td>{phT(c.state === 'pending' ? 'stPending' : c.state === 'credited' ? 'stCredited' : 'stRejected')}{c.supplier_note_number ? ` · ${c.supplier_note_number}` : ''}{c.remarks ? ` · ${c.remarks}` : ''}</td>
                    <td>{c.state === 'pending' && (
                      <span className={own.row}>
                        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => decide(c, 'credited')}>{phT('markCredited')}</button>
                        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => decide(c, 'rejected')}>{phT('markRejected')}</button>
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={own.muted}>{phT('claimsNote')}</p>
        </div>
      )}

      {section === 'receive' && (
        <div className={own.stack}>
          <p className={own.muted}>{phT('receiveIntro')}</p>
          {expiryGodowns.length === 0 && (
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => {
              godownsDb.save({ name: phT('expiryGodownName'), kind: 'expiry' });
              return phT('godownMade');
            })} data-make-expiry-godown>{phT('makeGodown')}</button>
          )}
          <div className={own.row}>
            <label className={controls.field}><span className={controls.label}>{phT('customer')}</span>
              <select className={controls.select} value={rc.client} onChange={(e) => setRc({ ...rc, client: e.target.value })}>
                <option value="">{phT('choose')}</option>
                {clients.map((c) => <option key={c.id ?? c.name} value={c.id ?? c.name}>{c.name}</option>)}
              </select></label>
            <label className={controls.field}><span className={controls.label}>{phT('intoGodown')}</span>
              <select className={controls.select} value={rc.godown || expiryGodowns[0]?.id || ''} onChange={(e) => setRc({ ...rc, godown: e.target.value })}>
                {expiryGodowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></label>
            <label className={controls.field}><span className={controls.label}>{phT('date')}</span>
              <input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          {lineEditor(rLines, setRLines, phT('received'))}
          {lineEditor(repl, setRepl, phT('replacement'))}
          {repl.length > 0 && (
            <label className={controls.field}><span className={controls.label}>{phT('replaceFrom')}</span>
              <select className={controls.select} value={rc.from || saleable[0]?.id || ''} onChange={(e) => setRc({ ...rc, from: e.target.value })}>
                {saleable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></label>
          )}
          <button type="button" className={controls.btnPrimary} onClick={() => run(() => {
            const client = clients.find((c) => (c.id ?? c.name) === rc.client);
            const r = receiptsDb.receive({
              date, client_id: client?.id, client_name: client?.name ?? '', godown_id: rc.godown || expiryGodowns[0]?.id || '', lines: rLines,
              replacement: repl, replace_from: rc.from || saleable[0]?.id, notes: rc.notes,
            });
            setRLines([blankLine()]);
            setRepl([]);
            return phT('receivedSaved', { number: r.number });
          })}>{phT('saveReceipt')}</button>
          {receiptsDb.all().length > 0 && (
            <table className={own.table}>
              <thead><tr><th>{phT('number')}</th><th>{phT('date')}</th><th>{phT('customer')}</th><th className={own.num}>{phT('lines')}</th></tr></thead>
              <tbody>{receiptsDb.all().slice(-20).reverse().map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.date}</td><td>{r.client_name}</td><td className={own.num}>{r.lines.length}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {section === 'destroy' && (
        <div className={own.stack}>
          <p className={own.muted}>{phT('destroyIntro')}</p>
          {expiryStock.length === 0 ? <p className={own.muted}>{phT('noExpiryStock')}</p> : (
            <table className={own.table}>
              <thead><tr><th /><th>{phT('item')}</th><th>{phT('batch')}</th><th>{phT('godown')}</th><th className={own.num}>{phT('qty')}</th><th className={own.num}>{phT('cost')}</th></tr></thead>
              <tbody>
                {expiryStock.map((r) => (
                  <tr key={r.key}>
                    <td><input type="checkbox" aria-label={phT('include', { item: r.item.name })} checked={destroyPick.has(r.key)} onChange={(e) => { const n = new Set(destroyPick); if (e.target.checked) n.add(r.key); else n.delete(r.key); setDestroyPick(n); }} /></td>
                    <td>{r.item.name}</td><td>{r.batch || '—'}</td><td>{gname(r.godown)}</td><td className={own.num}>{r.qty}</td><td className={own.num}>{formatCurrency(posById.get(r.item.id)?.avgCost ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {destroyPick.size > 0 && (
            <button type="button" className={controls.btnDanger} onClick={() => run(() => {
              const pick = expiryStock.filter((r) => destroyPick.has(r.key));
              const byGodown = new Map<string, typeof pick>();
              for (const r of pick) byGodown.set(r.godown, [...(byGodown.get(r.godown) ?? []), r]);
              for (const [g, rows] of byGodown) destroyExpiryStock({ date, godown_id: g, lines: rows.map((r) => ({ item_id: r.item.id, qty: r.qty, batch_no: r.batch || undefined, cost: posById.get(r.item.id)?.avgCost ?? 0 })) });
              setDestroyPick(new Set());
              return phT('destroyed');
            })}>{phT('destroyN', { n: destroyPick.size })}</button>
          )}
          <h4>{phT('itcTitle')}</h4>
          <p className={`${own.notice}`}>{phT('itcNote')}</p>
          {reminders.length > 0 && (
            <table className={own.table} data-itc-reminders>
              <thead><tr><th>{phT('month')}</th><th className={own.num}>{phT('lines')}</th><th className={own.num}>{phT('cost')}</th><th className={own.num}>{phT('itcEstimate')}</th></tr></thead>
              <tbody>{reminders.map((r) => <tr key={r.month}><td>{r.month}</td><td className={own.num}>{r.moves}</td><td className={own.num}>{formatCurrency(r.value)}</td><td className={own.num}>{formatCurrency(r.itc)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
