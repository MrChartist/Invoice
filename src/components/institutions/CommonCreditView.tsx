/**
 * GST → Common credit (R5-C2): the Rule 42 / 43 working for a month from the bills' ITC use tags and the month's
 * exempt / total turnover (the GSTR-1 / 3B engine), "Post reversal", the annual true-up and the working-paper CSV.
 * Lazy; listed with the fees / non-profit / leases packs (its URL always opens it). Verify with your CA.
 */
import { useEffect, useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { ItcUse } from '../../types/institutions-r5';
import { getTable } from '../../lib/storage';
import { buildGstReport, type ReportPeriod } from '../../lib/gst-reports';
import { purchasesDb } from '../../lib/purchases';
import { HEADS, ITC_USES, defaultTrueUpDate, trueUpWindow, figuresOf, headsTotal, inputsFor, itcUseOf, loadCcRuns, postReversal, rule42, trueUp, turnoverOf, unpostReversal, workingCsv, type Heads } from '../../lib/institutions/common-credit';
import { useT } from '../../i18n';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { round2 } from '../../lib/invoice-calc';
import { iT, type IKey } from '../../i18n/areas/packs-institutions-r5';
import styles from './institutions.module.css';
import { B, S, T, Tbl } from './Views';
import { attempt, csv, opts, rs, today, type Notify } from './ui';

const end = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const fyOf = (m: string) => (+m.slice(5, 7) >= 4 ? +m.slice(0, 4) : +m.slice(0, 4) - 1);
const ROWS = ['T', 'T1', 'T2', 'T3', 'C1', 'T4', 'C2', 'D1', 'D2', 'C3', 'Tm', 'Te', 'reverse'] as const;

export default function CommonCreditView({ notify }: { notify: Notify }) {
  useT();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tick, setTick] = useState(0);
  const data = useMemo(() => ({ inv: getTable<InvoiceRecord>('invoices'), pur: getTable<PurchaseRecord>('purchases'), runs: loadCcRuns() }), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // R7-C1 (D12): a hotel's no-ITC (5%) turnover is exempt-like — added to E; F already holds it as taxable.
  // Loaded from the hotel pack's chunk only with the pack on.
  const hotel = isPackOn(localDb.settings.get(), 'hotel');
  const [xl, setXl] = useState<null | ((inv: readonly InvoiceRecord[], from: string, to: string) => number)>(null);
  // R10 (SV-A4): a clinic / salon / gym's 5%-without-ITC service turnover is exempt-like too (setting, default on; SV12).
  const sv = ['clinic', 'salon', 'fitness'].some((p) => isPackOn(localDb.settings.get(), p as never));
  useEffect(() => {
    type X = (inv: readonly InvoiceRecord[], from: string, to: string) => number;
    const loads: Promise<X>[] = [];
    if (hotel) loads.push(import('../hotel/hotel-lazy').then((l) => l.hotelChunk()).then((m) => m.exemptLike));
    if (sv) loads.push(Promise.all([import('../../lib/services/sv-tax'), import('../../lib/services/sv-settings')]).then(([t, st]) => (inv, f, to) => t.svExemptLike(inv, f, to, st.readServiceSettings())));
    if (loads.length) void Promise.all(loads).then((fns) => setXl(() => (inv: readonly InvoiceRecord[], f: string, to: string) => fns.reduce((n, fn) => n + fn(inv, f, to), 0)));
  }, [hotel, sv]);
  const ef = (p: ReportPeriod) => {
    const r = turnoverOf(buildGstReport(data.inv, data.pur, { period: p }).gstr3b);
    const m = p.kind === 'month' ? `${p.month! < 4 ? p.fyStart + 1 : p.fyStart}-${String(p.month).padStart(2, '0')}` : '';
    return xl ? { E: round2(r.E + xl(data.inv, m ? `${m}-01` : `${p.fyStart}-04-01`, m ? end(m) : `${p.fyStart + 1}-03-31`)), F: r.F } : r;
  };
  const fy = fyOf(month);
  const res = useMemo(() => {
    const { E, F } = ef({ kind: 'month', fyStart: fy, month: +month.slice(5, 7) });
    return rule42(inputsFor(data.pur, `${month}-01`, end(month)), E, F, month);
  }, [data, month, xl]); // eslint-disable-line react-hooks/exhaustive-deps
  const year = useMemo(() => {
    const ms = Array.from({ length: 12 }, (_x, i) => `${i < 9 ? fy : fy + 1}-${String(((i + 3) % 12) + 1).padStart(2, '0')}`).filter((m) => m <= today().slice(0, 7));
    const { E, F } = ef({ kind: 'fy', fyStart: fy });
    const done: Heads = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const r of data.runs) if (r.kind === 'monthly' && fyOf(r.month) === fy) HEADS.forEach((h) => (done[h] += r.figures[`D_${h}`] ?? 0));
    return trueUp(ms.map((m) => { const i = inputsFor(data.pur, `${m}-01`, end(m)); return { C2: rule42(i, 0, 1, m).C2, nonBusiness: i.nonBusiness }; }), E, F, done, fy);
  }, [data, fy, xl]); // eslint-disable-line react-hooks/exhaustive-deps
  const fyKey = `FY${fy}-${String(fy + 1).slice(2)}`;
  const posted = data.runs.find((r) => r.kind === 'monthly' && r.month === month);
  const postedFy = data.runs.find((r) => r.kind === 'annual' && r.month === fyKey);
  const run = (fn: () => void) => attempt(notify, () => { fn(); setTick((n) => n + 1); }, iT('saved'));
  const diff = headsTotal(year.diff);
  // QA6 F8: the true-up is dated in the open return month it is filed in (after the FY, up to September), not 31 March.
  const win = trueUpWindow(fy);
  const [tuPick, setTuPick] = useState<{ fy: number; day: string } | null>(null);
  const tuDate = tuPick?.fy === fy ? tuPick.day : defaultTrueUpDate(fy, today());

  return (
    <div className={styles.stack} data-common-credit>
      <p className={styles.warn}>{iT('ccNote')}</p>
      <div className={styles.toolbar}>
        <T l={iT('month')} t="month" v={month} on={(v) => v && setMonth(v)} />
        <B l={iT('csv')} on={() => csv(`common-credit-${month}.csv`, workingCsv(res, month, (k) => iT(`cc.${k}` as IKey), iT('verify')))} />
        {posted ? <B l={iT('undo')} on={() => run(() => unpostReversal(posted.id))} /> : (
          <B p l={iT('post')} dis={!(headsTotal(res.reverse) > 0)} on={() => run(() => {
            const figures = figuresOf(res);
            HEADS.forEach((h) => (figures[`D_${h}`] = res.D1[h] + res.D2[h]));
            postReversal({ month, kind: 'monthly', heads: res.reverse, figures, date: end(month) });
          })} />
        )}
      </div>
      <p>E {rs(res.E)} · F {rs(res.F)} · E ÷ F {(res.ratio * 100).toFixed(2)}% · {iT('reverse')} <strong>{rs(headsTotal(res.reverse))}</strong></p>
      <Tbl h={['', 'IGST', 'CGST', 'SGST', 'Cess', iT('total')]} rows={ROWS.map((k) => [`${k}: ${iT(`cc.${k}`)}`, ...HEADS.map((h) => res[k][h].toFixed(2)), headsTotal(res[k]).toFixed(2)])} />
      <p className={styles.note}>{iT('cc3b')}</p>
      {data.pur.filter((p) => (p.date ?? '').slice(0, 7) === month && Number(p.cgst) + Number(p.sgst) + Number(p.igst) > 0).map((p) => (
        <div key={p.id} className={styles.toolbar}>
          <span>{p.date} · {p.vendor_name} · {p.bill_number}</span>
          <S l={iT('itcUse')} v={itcUseOf(p)} o={opts(ITC_USES, 'use.')} on={(v) => run(() => purchasesDb.save({ ...p, itc_use: v as ItcUse }))} />
        </div>
      ))}
      <h3>{iT('trueUp')} {fyKey}</h3>
      <p>{iT('trueUpLine', { annual: rs(headsTotal(year.annual)), posted: rs(headsTotal(year.posted)), diff: rs(diff), due: year.dueBy })}</p>
      <div className={styles.toolbar}>{postedFy ? <><span>{postedFy.date}</span><B l={iT('undo')} on={() => run(() => unpostReversal(postedFy.id))} /></> : (
        <>
          <T l={iT('trueUpOn')} t="date" v={tuDate} on={(day) => day && setTuPick({ fy, day })} />
          <B l={iT('post')} dis={Math.abs(diff) < 0.01 || today() < win.from} on={() => run(() => postReversal({ month: fyKey, kind: 'annual', heads: year.diff, figures: { annual: headsTotal(year.annual), posted: headsTotal(year.posted), diff }, date: tuDate }))} />
        </>
      )}</div>
    </div>
  );
}
