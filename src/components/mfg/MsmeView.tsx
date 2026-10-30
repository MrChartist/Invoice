/** MF-D3 MSME both ways: our MSE receivables with Sec 16 interest (reminder, letter), Form-1 paper, supplier classification. */
import { useMemo, useState } from 'react';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { paymentsDb, purchasesDb } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { todayInput } from '../../lib/utils';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { whatsappLink } from '../../lib/share';
import { byBuyer, interestLetterHtml, mseReceivables, reminderText, sellerIsMse } from '../../lib/mfg/mf-msme-recv';
import { form1Half, form1Rows, form1Sheet, isCompany, previousHalf } from '../../lib/mfg/mf-msme-form1';
import { readMfgSettings, saveMfgSettings } from '../../lib/mfg/mf-settings';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

export default function MsmeView({ ctx }: { ctx: MfgContext }) {
  const [asOf, setAsOf] = useState(todayInput());
  const [sam, setSam] = useState(false);
  const sender = localDb.settings.activeProfile();
  const mse = sellerIsMse(sender);
  const data = useMemo(() => {
    void ctx.version;
    return { invoices: localDb.invoices.getAll(), pays: localDb.payments.getAll(), bills: purchasesDb.all(), vpays: paymentsDb.all(), vendors: vendorsDb.all(), clients: localDb.clients.getAll(), links: getTable<{ from_id: string; to_id: string; relation: string }>('doc_links') };
  }, [ctx.version]);
  const groups = mse ? byBuyer(mseReceivables(data.invoices, data.pays, asOf, data.links)) : [];
  const seller = { name: sender?.companyName ?? '', udyam: sender?.msme_udyam ?? '', category: sender?.msme_category ?? '' };
  const [half, setHalf] = useState(() => previousHalf(form1Half(todayInput())));
  const reasons = readMfgSettings().form1_reasons ?? {};
  const f1 = form1Rows(data.bills, data.vendors, data.vpays, half, reasons);
  const entity = [...getTable<{ id: string; entity_type?: string }>('notes_to_accounts')].sort((a, b) => b.id.localeCompare(a.id)).find((n) => n.entity_type)?.entity_type;
  const company = isCompany(entity, sender?.companyName);
  const phoneOf = (gstin: string) => data.clients.find((c) => (c.gstin ?? '').toUpperCase() === gstin.toUpperCase())?.phone;
  const unclassified = data.vendors.filter((v) => v.msme_udyam && !v.msme_category);
  const flagged = data.vendors.filter((v) => v.msme_category === 'MICRO' || v.msme_category === 'SMALL');
  return (
    <>
      <h3>{sdT('recv')}</h3>
      {!mse ? <p className={controls.hint}>{sdT('notMse')}</p> : (
        <>
          <div style={row}>
            <Fld l={sdT('asOf')}><DateField className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Fld>
            <label><input type="checkbox" checked={sam} onChange={(e) => setSam(e.target.checked)} /> {sdT('samadhaan')}</label>
          </div>
          {groups.map((g) => (
            <div key={g.gstin} data-mfd-buyer>
              <p><b>{g.buyer}</b> ({g.gstin}) · {sdT('unpaid')} {rs(g.unpaid)} · {sdT('interest')} {rs(g.interest)}{' '}
                <a className={sm} href={whatsappLink(phoneOf(g.gstin), reminderText(seller, g.buyer, g.bills, asOf, sam))} target="_blank" rel="noreferrer">{sdT('remind')}</a>{' '}
                <button type="button" className={sm} onClick={() => { const h = `<!doctype html><meta charset="utf-8"><body>${interestLetterHtml(seller, g.buyer, g.gstin, g.bills, asOf)}</body>`; printHtmlDocument(h, (x) => downloadText('msme-interest.html', x, 'text/html')); }}>{sdT('letter')}</button>
              </p>
              <Tbl empty="" head={[sdT('bill'), sdT('date'), sdT('limit'), sdT('unpaid'), sdT('late'), sdT('interest')]} rows={g.bills.map((b) => [b.number, b.date, b.limit, rs(b.unpaid), b.daysOverdue, rs(b.interest)])} />
            </div>
          ))}
          {!groups.length && <p className={controls.hint}>{sdT('none')}</p>}
          <p className={controls.hint}>{sdT('hbh')}</p>
        </>
      )}
      <h3>{sdT('form1')}</h3>
      {!company && <p className={controls.hint}>{sdT('notCompany')}</p>}
      <div style={row}>
        <Fld l={sdT('half')}>
          <SelectField className={controls.select} value={half.id} onChange={(e) => { const [h, y] = e.target.value.split('-'); setHalf(form1Half(h === 'H1' ? `${y}-06-01` : `${y}-12-01`)); }} data-mfd="form1-half">
            {[0, 1, 2, 3].map((n) => { let h = form1Half(todayInput()); for (let i = 0; i < n; i++) h = previousHalf(h); return <option key={h.id} value={h.id}>{h.label}</option>; })}
          </SelectField>
        </Fld>
        <span className={controls.hint}>{sdT('dueOn', { date: half.due })}</span>
        <button type="button" className={sm} onClick={() => downloadText(`MSME-Form1-${half.id}.csv`, toCsv(form1Sheet(f1, half)), 'text/csv')} data-mfd-b="form1-csv">{sdT('csv')}</button>
      </div>
      <Tbl empty={sdT('none')} head={[sdT('supplier'), 'PAN', sdT('bill'), sdT('date'), sdT('unpaid'), sdT('days'), sdT('reason')]} rows={f1.map((r) => [r.supplier + (r.trader ? ` (${sdT('trader')})` : ''), r.pan, r.bill, r.date, rs(r.unpaid), r.days,
        <input key="r" className={controls.input} defaultValue={r.reason} disabled={!ctx.canBooks} onBlur={(e) => e.target.value !== r.reason && run(ctx, () => { saveMfgSettings({ form1_reasons: { ...reasons, [r.bill_id]: e.target.value.trim() } }); return sdT('saved'); })} data-mfd="form1-reason" />])} />
      <h3>{sdT('classify')}</h3>
      <Tbl empty={sdT('none')} head={[sdT('supplier'), 'Udyam']} rows={unclassified.map((v) => [v.name, v.msme_udyam ?? ''])} />
      <Tbl empty="" head={[sdT('supplier'), sdT('trader')]} rows={flagged.map((v) => [v.name, <input key="t" type="checkbox" checked={!!v.mf?.msme_trader} disabled={!ctx.canMasters} onChange={(e) => run(ctx, () => { vendorsDb.save({ ...v, mf: { ...v.mf, msme_trader: e.target.checked || undefined } }); return sdT('saved'); })} data-mfd="trader" />])} />
      <p className={controls.hint}>{sdT('traderNote')}</p>
    </>
  );
}
