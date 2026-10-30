/**
 * Books → Reports → Annual pack (R2-C1): balance sheet and P&L with the previous year, cash flow, trial
 * balance and notes to accounts for one FY, from the same ledger and closing-stock valuer as every
 * statement (the report environment). Print / HTML (script-free), PDF (html-to-image + jspdf, page by
 * page), Excel of the numeric schedules and a ZIP. Lazy-loaded from the Reports hub.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Download, FileArchive, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { fyStartYearOf } from '../../../lib/books';
import { loadAssets } from '../../../lib/ledger/assets';
import { annualPackBody, annualPackHtml, annualPackSheets, buildAnnualPack, ENTITY_TYPES, fyId, notesDb } from '../../../lib/ledger/annual-pack';
import { cashFlowCsv, trialBalanceCsv, balanceSheetLedgerCsv } from '../../../lib/ledger/reports';
import { loadBranches } from '../../../lib/branch';
import { localDb } from '../../../lib/localDb';
import { getTable } from '../../../lib/storage';
import { nonCashBankLedgerIds } from '../../../lib/bank-ledgers';
import { downloadBlob, downloadText } from '../../../lib/download';
import { printHtmlDocument } from '../../../lib/voucher-print';
import { safeStem } from '../../../lib/pdf-batch';
import { formatMoney } from '../../../lib/utils';
import type { EntityType, NoteText } from '../../../types/books-r2';
import type { Vendor } from '../../../types/purchases';
import type { PartnerNoteRow } from '../../../lib/ledger/notes-auto';
import type { Period } from '../../../lib/books';
import { useCan } from '../../../hooks/useCan';
import { useT } from '../../../i18n';
import { br2T } from '../../../i18n/areas/books-r2';
import { useReportEnv } from './report-env';
import { NotesEditor } from './NotesEditor';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import books from '../books.module.css';
import { SelectField } from '../../ui/SelectField';

const ENTITY_KEY = { proprietorship: 'entProp', partnership: 'entFirm', llp: 'entLlp', company: 'entCompany', cooperative: 'entCoop', association: 'entAssoc' } as const;

export default function AnnualPackTab({ period, today, notify }: { period: Period; today: string; notify?: (m: string, tone?: 'success' | 'error') => void }) {
  useT();
  const { ledger, stock } = useReportEnv();
  const { can } = useCan();
  const editable = can('books.edit');
  const say = notify ?? (() => undefined);
  const lastClosed = fyStartYearOf(today) - 1;
  const [fy, setFy] = useState(() => Math.min(fyStartYearOf(period.end), fyStartYearOf(today)));
  const [rev, setRev] = useState(0);
  const stored = useMemo(() => (rev >= 0 ? notesDb.get(fyId(fy)) : null), [fy, rev]);
  const [entity, setEntity] = useState<EntityType>(() => notesDb.get(fyId(fy))?.entity_type ?? 'proprietorship');
  const [busy, setBusy] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  const company = useMemo(() => {
    const p = localDb.settings.activeProfile();
    return { name: p?.companyName ?? '', address: p?.companyAddress, gstin: p?.companyGstin, pan: p?.pan };
  }, []);
  const scopeLabel = useMemo(() => {
    if (!ledger.branchId) return undefined;
    const b = loadBranches().find((x) => x.id === ledger.branchId);
    return `Branch: ${b?.name ?? ledger.branchId}`;
  }, [ledger.branchId]);

  // MF-D5: Schedule III inventory sub-heads (lazy; company-wide stock, so not on a branch-scoped pack).
  const [invRows, setInvRows] = useState<{ label: string; cur: number; prev: number }[]>([]);
  // PS-D1: partner-wise statements for a partnership / LLP (lazy; only when the firm desk has partners).
  const [partnerRows, setPartnerRows] = useState<PartnerNoteRow[]>([]);
  useEffect(() => {
    let live = true;
    if (entity !== 'partnership' && entity !== 'llp') return;
    void import('../../../lib/prof/ps-partner-post').then((m) => {
      if (!live) return;
      const p = (x: number) => Math.round(x * 100);
      setPartnerRows(m.partnerStatements(fy).map((r) => ({ name: r.name, opening: p(r.opening), introduced: p(r.introduced), drawings: p(r.drawings), interest: p(r.interest), remuneration: p(r.remuneration), share: p(r.share), closing: p(r.closing) })));
    }, () => undefined);
    return () => { live = false; };
  }, [entity, fy]);
  const pack = useMemo(
    () =>
      buildAnnualPack({
        ledger,
        stock,
        fyStartYear: fy,
        assets: loadAssets(),
        vendors: getTable<Vendor>('vendors'),
        invoices: localDb.invoices.getAll(),
        company,
        entity,
        notes: stored,
        scopeLabel,
        generatedOn: today,
        // QA-3 F18: a running year is drawn to the report period's end (never past today), labelled interim.
        asAt: period.end,
        inventoryRows: ledger.branchId || stock?.mode !== 'inventory' ? undefined : invRows,
        partnerRows: ledger.branchId || (entity !== 'partnership' && entity !== 'llp') ? undefined : partnerRows, // PS-D1
        // R18-D2: the Receipts and Payments account reads cash and the real banks (clearing accounts left out).
        rpCash: ((off) => (id: string) => ledger.byId.get(id)?.group === 'CASH_BANK' && !off.has(id))(nonCashBankLedgerIds()),
      }),
    [ledger, stock, fy, company, entity, stored, scopeLabel, today, period.end, invRows, partnerRows],
  );
  const { asAt: invAt, prev: { end: invPrev } } = pack;
  useEffect(() => {
    let live = true;
    if (ledger.branchId || stock?.mode !== 'inventory') return;
    void import('../../../lib/mfg/mf-inventories-live').then((m) => { if (live) setInvRows(m.liveNoteRows(invAt, invPrev)); });
    return () => { live = false; };
  }, [ledger.branchId, stock, invAt, invPrev]);
  const body = useMemo(() => annualPackBody(pack), [pack]);

  // The preview is our own escaped markup (annual-pack.ts escapes every value; no scripts).
  useEffect(() => {
    if (previewRef.current) previewRef.current.innerHTML = body;
  }, [body]);

  const stem = safeStem(`AnnualAccounts_${company.name || 'Business'}_${pack.fy.id}`);
  const html = () => annualPackHtml(pack);
  const print = () => printHtmlDocument(html(), (h) => downloadText(`${stem}.html`, h, 'text/html'));

  const xlsxBytes = async () => {
    const { writeXlsx } = await import('../../../lib/xlsx');
    return writeXlsx(annualPackSheets(pack));
  };
  const excel = async () => {
    setBusy('xlsx');
    try {
      const { downloadXlsx } = await import('../../../lib/xlsx');
      await downloadXlsx(`${stem}.xlsx`, annualPackSheets(pack));
    } finally {
      setBusy('');
    }
  };
  const pdf = async () => {
    const host = previewRef.current;
    if (!host) return;
    setBusy('pdf');
    try {
      const { PdfBuilder } = await import('../../../lib/pdf-batch');
      const builder = await PdfBuilder.create();
      for (const page of Array.from(host.querySelectorAll<HTMLElement>('.ap-page'))) await builder.addPaper(page, { paper: 'A4' });
      downloadBlob(`${stem}.pdf`, builder.blob());
    } catch {
      say(br2T('pdfFailed'), 'error');
    } finally {
      setBusy('');
    }
  };
  // ZIP: reuses the month-end pack's P&L CSV writer and the shared ZIP writer (8G report packs).
  const zip = async () => {
    setBusy('zip');
    try {
      const [{ zipBlob }, { pnlCsv }] = await Promise.all([import('../../../lib/zip'), import('../../../lib/report-pack')]);
      const enc = new TextEncoder();
      const blob = await zipBlob([
        { name: `${stem}.html`, data: enc.encode(html()) },
        { name: `${stem}.xlsx`, data: await xlsxBytes() },
        { name: `BalanceSheet_${pack.asAt}.csv`, data: enc.encode(balanceSheetLedgerCsv(pack.bs)) },
        { name: `PnL_${pack.fy.id}.csv`, data: enc.encode(pnlCsv(pack.pl)) },
        { name: `CashFlow_${pack.fy.id}.csv`, data: enc.encode(cashFlowCsv(pack.cf)) },
        { name: `TrialBalance_${pack.fy.id}.csv`, data: enc.encode(trialBalanceCsv(pack.tb)) },
        { name: 'README.txt', data: enc.encode(`Annual accounts pack ${pack.fy.label}, generated ${today} on this device by Mr. Chartist Invoice.\nDraft prepared from the books: not audited. Verify with your CA.\n`) },
      ]);
      downloadBlob(`${stem}.zip`, blob);
    } finally {
      setBusy('');
    }
  };

  const saveNotes = (next: Record<string, NoteText>) => {
    try {
      notesDb.save(fyId(fy), next, entity);
      setRev((n) => n + 1);
      say(br2T('notesSaved', { fy: pack.fy.label }));
    } catch (err) {
      say((err as Error).message, 'error');
    }
  };
  const changeFy = (y: number) => {
    setFy(y);
    setEntity(notesDb.get(fyId(y))?.entity_type ?? entity);
  };

  const years = Array.from({ length: 6 }, (_, i) => fyStartYearOf(today) - i);

  return (
    <div className={books.stack} data-annual-pack>
      <section className={`${surface.card} no-print`}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}><BookOpenCheck size={16} aria-hidden /> {br2T('annualTitle', { fy: pack.fy.label })}</span>
        </div>
        <div className={surface.cardBody}>
          <p className={controls.hint}>{br2T('annualIntro')}</p>
          <div className={books.toolbar}>
            <label className={controls.field}>
              <span className={controls.label}>{br2T('fy')}</span>
              <SelectField className={controls.select} value={fy} onChange={(e) => changeFy(Number(e.target.value))} data-annual-fy>
                {years.map((y) => <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}{y === lastClosed ? ' ✓' : ''}</option>)}
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{br2T('entity')}</span>
              <SelectField className={controls.select} value={entity} onChange={(e) => setEntity(e.target.value as EntityType)}>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{br2T(ENTITY_KEY[t])}</option>)}
              </SelectField>
            </label>
          </div>
          <p className={controls.hint}>{br2T('entityHint')}</p>
          <p className={pack.difference ? `${books.notice} ${books.noticeWarn}` : books.muted} role="status" data-annual-ties={pack.difference ? 'no' : 'yes'}>
            {pack.difference ? br2T('differs', { amount: formatMoney(Math.abs(pack.difference) / 100) }) : br2T('ties')}
          </p>
          <div className={books.toolbar}>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={print}><Printer size={14} aria-hidden /> {br2T('printHtml')}</button>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`${stem}.html`, html(), 'text/html')}><FileText size={14} aria-hidden /> {br2T('downloadHtml')}</button>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void pdf()} disabled={!!busy}><Download size={14} aria-hidden /> {busy === 'pdf' ? br2T('building') : br2T('pdf')}</button>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void excel()} disabled={!!busy}><FileSpreadsheet size={14} aria-hidden /> {br2T('xlsx')}</button>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void zip()} disabled={!!busy}><FileArchive size={14} aria-hidden /> {busy === 'zip' ? br2T('building') : br2T('zip')}</button>
          </div>
          <NotesEditor key={`${fy}:${entity}:${rev}`} notes={pack.notes} stored={stored?.notes ?? {}} entity={entity} editable={editable} onSave={saveNotes} />
        </div>
      </section>
      <div className={surface.tableWrap}>
        <div ref={previewRef} aria-label={br2T('annualTitle', { fy: pack.fy.label })} data-annual-preview />
      </div>
    </div>
  );
}
