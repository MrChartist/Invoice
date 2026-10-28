import { Fragment, useMemo, useState } from 'react';
import { Info, Trash2, Wallet } from 'lucide-react';
import { AGE_BUCKETS, adjustAgainstBill, billwisePayables, deleteVendorPayment, payablesTotals, planAllocation, recordSupplierPayment, vendorPaymentsDb, type AgeBucket, type PartyPayables } from '../../../lib/billwise';
import { PAYMENT_METHODS, paymentsDb, purchasesDb } from '../../../lib/purchases';
import { vendorsDb } from '../../../lib/vendors';
import { loadPayableOpeningBills } from '../../../lib/opening-bills';
import { round2 } from '../../../lib/invoice-calc';
import { formatDate, formatMoney, todayInput } from '../../../lib/utils';
import type { PurchaseReturn, VendorPayment } from '../../../types/purchases';
import type { Payment } from '../../../types/invoice';
import { getTable } from '../../../lib/storage';
import { Modal } from '../../ui/Modal';
import { useCan } from '../../../hooks/useCan';
import { useT } from '../../../i18n';
import { tallyT } from '../../../i18n/areas/tally';
import { c6T } from '../../../i18n/areas/closures-r6';
import { paymentNeedsApproval } from '../../../lib/purchase-approval-gate';
import { capT } from '../../../i18n/areas/capture';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './tally.module.css';

const BUCKET_KEY: Record<AgeBucket, 'notDue' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'> = { notDue: 'notDue', d0_30: 'd0_30', d31_60: 'd31_60', d61_90: 'd61_90', d90plus: 'd90plus' };
const rs = (n: number) => formatMoney(n);
const partyKey = (p: Pick<PartyPayables, 'vendorId' | 'vendor'>) => p.vendorId ?? `name:${p.vendor}`;

/** Outstanding payables bill-wise with ageing, party ledger view, bill-wise payment and adjustments. */
export function BillwiseTab({ asOf, notify, onChanged }: { asOf: string; notify: (m: string, tone?: 'success' | 'error') => void; onChanged: () => void }) {
  useT();
  const canEdit = useCan().can('books.edit');
  const [version, setVersion] = useState(0);
  const [ageBy, setAgeBy] = useState<'due' | 'bill'>('due');
  const [settled, setSettled] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState<{ vp: VendorPayment; party: PartyPayables } | null>(null);
  const parties = useMemo(() => {
    void version;
    return billwisePayables({ purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), vendors: vendorsDb.all(), asOf, ageBy, includeSettled: settled, returns: getTable<PurchaseReturn>('purchase_returns'), openingBills: loadPayableOpeningBills(vendorsDb.all()), receipts: getTable<Payment>('transactions') }); // R6-C2: supplier opening bills; R15-A3: netting
  }, [version, asOf, ageBy, settled]);
  const shown = supplier ? parties.filter((p) => partyKey(p) === supplier) : parties;
  const totals = payablesTotals(shown);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const remove = (id: string) => {
    try {
      deleteVendorPayment(id);
      refresh();
      notify(tallyT('deleted'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={books.stack}>
      <div className={`${books.toolbar} no-print`}>
        <div className={books.toolbarGroup}>
          <span className={books.indicative}><Info size={13} aria-hidden="true" /> {tallyT('verifyCa')}</span>
          <strong>{tallyT('bwTitle')}</strong>
          <span className={books.muted}>{tallyT('asOf', { date: formatDate(asOf) })}</span>
        </div>
        <div className={books.toolbarGroup}>
          <select aria-label={tallyT('supplier')} className={controls.select} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{tallyT('allSuppliers')}</option>
            {parties.map((p) => <option key={partyKey(p)} value={partyKey(p)}>{p.vendor}</option>)}
          </select>
          <select aria-label={tallyT('ageBy')} className={controls.select} value={ageBy} onChange={(e) => setAgeBy(e.target.value === 'bill' ? 'bill' : 'due')}>
            <option value="due">{tallyT('ageBy')}: {tallyT('byDue')}</option>
            <option value="bill">{tallyT('ageBy')}: {tallyT('byBill')}</option>
          </select>
          <label className={controls.check}><input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} /> {tallyT('showSettled')}</label>
          {canEdit && <button type="button" className={controls.btnPrimary} onClick={() => setPaying(true)}><Wallet size={16} /> {tallyT('payBills')}</button>}
        </div>
      </div>

      <div className={styles.buckets}>
        {AGE_BUCKETS.map((b) => (
          <div key={b} className={styles.bucket}>
            <div className={styles.bucketLabel}>{tallyT(BUCKET_KEY[b])}</div>
            <div className={styles.bucketValue}>₹{rs(totals.buckets[b])}</div>
          </div>
        ))}
        <div className={styles.bucket}>
          <div className={styles.bucketLabel}>{tallyT('advances')}</div>
          <div className={styles.bucketValue}>₹{rs(totals.advances)}</div>
        </div>
        <div className={styles.bucket}>
          <div className={styles.bucketLabel}>{tallyT('net')}</div>
          <div className={styles.bucketValue}>₹{rs(totals.net)}</div>
        </div>
      </div>

      <div className={surface.card}>
        {shown.length === 0 ? (
          <p className={`${books.muted} ${surface.cardBody}`}>{tallyT('emptyBw')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{tallyT('bwTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tallyT('bill')}</th>
                  <th scope="col">{tallyT('billDate')}</th>
                  <th scope="col">{tallyT('due')}</th>
                  <th scope="col" className={surface.numeric}>{tallyT('payable')}</th>
                  <th scope="col" className={surface.numeric}>{tallyT('settled')}</th>
                  <th scope="col" className={surface.numeric}>{tallyT('balance')}</th>
                  <th scope="col" className={surface.numeric}>{tallyT('overdue')}</th>
                  <th scope="col" className={surface.numeric}>{tallyT('msme')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <Fragment key={partyKey(p)}>
                    <tr className={styles.partyHead}>
                      <td colSpan={5}>{p.vendor}</td>
                      <td className={surface.numeric}>{rs(p.net)}</td>
                      <td colSpan={2} />
                    </tr>
                    {p.bills.map((b) => (
                      <tr key={b.purchaseId}>
                        <td className={surface.mono}>
                          {b.number || '—'}{b.opening ? ` · ${c6T('openingRef')}` : ''}
                          {b.allocations.length > 0 && (
                            <div className={styles.alloc}>
                              {b.allocations.map((a, i) => (
                                <div key={i}>{a.kind === 'payment' ? tallyT('agstRef') : tallyT('adjustment')} {formatDate(a.date)} · ₹{rs(a.amount)} {a.ref ? `· ${a.ref}` : ''}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>{formatDate(b.date)}</td>
                        <td>{formatDate(b.due)}</td>
                        <td className={surface.numeric}>{rs(b.payable)}</td>
                        <td className={surface.numeric}>{rs(b.settled)}</td>
                        <td className={surface.numeric}>{rs(b.balance)}</td>
                        <td className={surface.numeric}>{b.overdueDays || ''}</td>
                        <td className={surface.numeric}>{b.msmeInterest ? rs(b.msmeInterest) : ''}</td>
                      </tr>
                    ))}
                    {p.advances.map((a) => (
                      <tr key={a.id}>
                        <td>{a.kind === 'ADVANCE' ? tallyT('kAdvance') : a.kind === 'NEW_REF' ? tallyT('kNewRef') : tallyT('kOnAccount')} {a.ref}</td>
                        <td>{formatDate(a.date)}</td>
                        <td />
                        <td className={surface.numeric}>{rs(a.amount)}</td>
                        <td />
                        <td className={surface.numeric}>−{rs(a.unallocated)}</td>
                        <td colSpan={2}>
                          {canEdit && !a.noteId /* WP-3: a debit note's on-account part is managed on the Returns tab */ && !a.openingId /* R6-C2: on the party's opening bills */ && (
                            <span className={books.toolbarGroup}>
                              {a.unallocated > 0 && p.bills.some((b) => b.balance > 0) && (
                                <button type="button" className={controls.btnOutline} onClick={() => setAdjusting({ vp: vendorPaymentsDb.get(a.id)!, party: p })}>{tallyT('adjust')}</button>
                              )}
                              <button type="button" className={controls.btnIcon} aria-label={tallyT('delete')} onClick={() => remove(a.id)}><Trash2 size={15} /></button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className={books.totalRow}>
                  <td colSpan={5}>{tallyT('total')}</td>
                  <td className={surface.numeric}>{rs(totals.net)}</td>
                  <td />
                  <td className={surface.numeric}>{totals.msmeInterest ? rs(totals.msmeInterest) : ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={books.muted}>{tallyT('bwNote')}</p>
      {paying && <PayBillsModal parties={parties} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); refresh(); notify(tallyT('saved')); }} />}
      {adjusting && (
        <AdjustModal
          vp={adjusting.vp}
          party={adjusting.party}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); refresh(); notify(tallyT('adjusted')); }}
        />
      )}
    </div>
  );
}

function PayBillsModal({ parties, onClose, onSaved }: { parties: PartyPayables[]; onClose: () => void; onSaved: () => void }) {
  useT();
  const vendors = vendorsDb.all();
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(todayInput);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [kind, setKind] = useState<VendorPayment['kind']>('ON_ACCOUNT');
  const [refName, setRefName] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const party = parties.find((p) => (vendor ? p.vendorId === vendor.id || p.vendor === vendor.name : false));
  const bills = (party?.bills ?? []).filter((b) => b.balance > 0);
  const paid = Number(amount) || 0;
  const allocated = round2(bills.reduce((s, b) => s + (Number(alloc[b.purchaseId]) || 0), 0));
  const fifo = () => {
    const plan = planAllocation(paid, bills.map((b) => ({ purchaseId: b.purchaseId, balance: b.balance, due: b.due })));
    setAlloc(Object.fromEntries(plan.lines.map((l) => [l.purchaseId, String(l.amount)])));
  };
  const save = () => {
    // 8.44: above the owner's limit a clerk asks for approval per bill (bill's payment dialog) instead.
    if (paymentNeedsApproval(paid)) return setError(capT('payBillwiseHeld'));
    try {
      recordSupplierPayment({
        vendorId: vendor?.id,
        vendorName: vendor?.name ?? '',
        date,
        amount: paid,
        method,
        reference,
        allocations: bills.map((b) => ({ purchaseId: b.purchaseId, amount: Number(alloc[b.purchaseId]) || 0 })).filter((a) => a.amount > 0),
        remainderKind: kind,
        refName,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={tallyT('payTitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{tallyT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={!vendor || !(paid > 0)}>{tallyT('save')}</button>
        </>
      }
    >
      <div className={books.stack}>
        <div className={styles.grid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bw-vendor">{tallyT('supplier')}</label>
            <select id="bw-vendor" className={controls.select} value={vendorId} onChange={(e) => { setVendorId(e.target.value); setAlloc({}); }}>
              <option value="">{tallyT('chooseSupplier')}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bw-date">{tallyT('date')}</label>
            <input id="bw-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bw-amt">{tallyT('amountPaid')}</label>
            <input id="bw-amt" inputMode="decimal" className={controls.input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bw-method">{tallyT('method')}</label>
            <select id="bw-method" className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bw-ref">{tallyT('reference')}</label>
            <input id="bw-ref" className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        {bills.length > 0 && (
          <>
            <div className={books.toolbar}>
              <strong>{tallyT('allocations')}</strong>
              <button type="button" className={controls.btnGhost} onClick={fifo} disabled={!(paid > 0)}>{tallyT('fifo')}</button>
            </div>
            <div className={styles.allocList}>
              {bills.map((b) => (
                <div key={b.purchaseId} className={styles.allocRow}>
                  <label htmlFor={`bw-a-${b.purchaseId}`}>{tallyT('agstRef')} {b.number} · {formatDate(b.date)} · {tallyT('balance')} ₹{rs(b.balance)}</label>
                  <input id={`bw-a-${b.purchaseId}`} inputMode="decimal" className={controls.input} value={alloc[b.purchaseId] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [b.purchaseId]: e.target.value }))} />
                </div>
              ))}
            </div>
          </>
        )}
        <p className={controls.hint} aria-live="polite">{tallyT('allocated', { allocated: rs(allocated), rest: rs(Math.max(round2(paid - allocated), 0)) })}</p>
        {paid - allocated > 0.004 && (
          <div className={styles.grid}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="bw-kind">{tallyT('remainderAs')}</label>
              <select id="bw-kind" className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as VendorPayment['kind'])}>
                <option value="ON_ACCOUNT">{tallyT('kOnAccount')}</option>
                <option value="ADVANCE">{tallyT('kAdvance')}</option>
                <option value="NEW_REF">{tallyT('kNewRef')}</option>
              </select>
            </div>
            {kind === 'NEW_REF' && (
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bw-refname">{tallyT('refName')}</label>
                <input id="bw-refname" className={controls.input} value={refName} onChange={(e) => setRefName(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function AdjustModal({ vp, party, onClose, onSaved }: { vp: VendorPayment; party: PartyPayables; onClose: () => void; onSaved: () => void }) {
  useT();
  const bills = party.bills.filter((b) => b.balance > 0);
  const [billId, setBillId] = useState(bills[0]?.purchaseId ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput);
  const [error, setError] = useState('');
  const save = () => {
    try {
      adjustAgainstBill(vp.id, billId, Number(amount) || 0, date);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={tallyT('adjustTitle', { ref: vp.ref_name || vp.reference || formatDate(vp.date) })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{tallyT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{tallyT('adjust')}</button>
        </>
      }
    >
      <div className={books.stack}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="adj-bill">{tallyT('bill')}</label>
          <select id="adj-bill" className={controls.select} value={billId} onChange={(e) => setBillId(e.target.value)}>
            {bills.map((b) => <option key={b.purchaseId} value={b.purchaseId}>{b.number} · {tallyT('balance')} ₹{rs(b.balance)}</option>)}
          </select>
        </div>
        <div className={styles.grid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="adj-amt">{tallyT('amount')}</label>
            <input id="adj-amt" inputMode="decimal" className={controls.input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="adj-date">{tallyT('date')}</label>
            <input id="adj-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
