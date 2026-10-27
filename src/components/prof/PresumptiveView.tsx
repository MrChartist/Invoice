/** PS-D4 44ADA / Sec 58 working paper: gross receipts, cash share, limit, deemed income vs books, advance tax; printable. */
import { useMemo, useState } from 'react';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import { todayInput } from '../../lib/utils';
import { getIndianFY } from '../../lib/invoice-number';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { sectionText } from '../../lib/ita2025';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { ledgerProfitAndLoss, loadLedger, loadStockValuer } from '../../lib/ledger/index';
import { presumptive } from '../../lib/prof/ps-presumptive';
import { fyBounds } from '../../lib/prof/ps-partner-run';
import { firmForm } from '../../lib/prof/ps-d-settings';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { Fld, Tbl } from './ps-d-ui';
import { inr, row } from './ps-desk';
import controls from '../../styles/controls.module.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export default function PresumptiveView() {
  const cur = getIndianFY(todayInput()).startYear;
  const [fy, setFy] = useState(cur);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const p = useMemo(() => {
    let bookProfit: number | undefined;
    try {
      bookProfit = ledgerProfitAndLoss(loadLedger(), fyBounds(fy), loadStockValuer()).netProfit / 100;
    } catch { /* books not kept: the paper shows receipts only */ }
    return presumptive({ fy, invoices: localDb.invoices.getAll() as InvoiceRecord[], receipts: getTable<Payment>('transactions'), bookProfit, firmForm: firmForm() });
  }, [fy]);
  const label = sectionText('44ADA', `${fy}-04-01`);
  const rows: [string, string][] = [
    [fdT('gross'), inr(p.accrual)], [fdT('recoveries'), inr(p.recoveriesOut)], [fdT('cashBasis'), inr(p.cashBasis)], [fdT('cashPct'), `${p.cashPct} %`],
    [fdT('limit'), `${inr(p.limit)} — ${p.withinLimit ? fdT('within') : fdT('over')}`], [`${fdT('deemed')} (${p.deemedPct} %)`, inr(p.deemed)],
    ...(p.bookProfit !== undefined ? [[fdT('netProfit'), inr(p.bookProfit)], [fdT('difference'), inr(p.difference ?? 0)]] as [string, string][] : []),
    [fdT('advanceDue'), p.advanceTaxDue],
  ];
  const print = () => {
    const html = `<h2>${esc(label)} — FY ${fy}-${String(fy + 1).slice(2)}</h2><table border="1" cellpadding="4">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><p>${p.notes.map(esc).join('<br>')}</p><p>${esc(fdT('wp'))}</p>`;
    printHtmlDocument(`<!doctype html><meta charset="utf-8"><title>${esc(label)}</title><body>${html}</body>`, (h) => downloadText('presumptive.html', h, 'text/html'));
  };
  return (
    <>
      <div style={row}>
        <Fld l={fdT('fy')}>
          <select className={controls.select} value={fy} onChange={(e) => setFy(+e.target.value)} data-ps="pr-fy">{[cur, cur - 1, cur - 2].map((y) => <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}</option>)}</select>
        </Fld>
        <button type="button" className={controls.btnOutline} onClick={print}>{fdT('print')}</button>
      </div>
      <p className={controls.label}>{label}</p>
      <Tbl empty="" head={['', '']} rows={rows} />
      {p.notes.map((n) => <p key={n} role="note" className={controls.hint}>{n}</p>)}
      <fieldset data-ps-elig>
        <legend className={controls.label}>{fdT('elig')}</legend>
        {(['e.resident', 'e.form', 'e.profession'] as const).map((k) => (
          <label key={k} className={controls.check}><input type="checkbox" checked={!!ticks[k]} onChange={(e) => setTicks({ ...ticks, [k]: e.target.checked })} /> {fdT(k)}</label>
        ))}
      </fieldset>
    </>
  );
}
