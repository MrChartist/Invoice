import { useMemo, useState, type ReactNode } from 'react';
import { CalendarRange, Download, FileJson, Printer, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import { getTable } from '../../lib/storage';
import { readLinks } from '../../lib/documents';
import { fyPeriod, gstSummary, loadBooksData } from '../../lib/books';
import { advanceTaxEvents } from '../../lib/advance-tax';
import { periodForDate } from '../../lib/gst-reports';
import { formatMoney } from '../../lib/utils';
import {
  buildGstr9,
  buildGstr9Html,
  gstr9Csv,
  gstr9WorkingPaper,
  type Gstr9CompareRow,
  type Gstr9Row,
} from '../../lib/gstr9';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './gstr9.module.css';

export interface Gstr9ModalProps {
  open: boolean;
  onClose: () => void;
  /** FY to open on (calendar year it starts in). */
  fyStart: number;
  fyOptions: number[];
  gstin: string;
  filerStateCode?: string;
  filerName?: string;
  /** Turnover stored on the GST page: last FY (`gt`) and this FY so far (`curGt`). */
  storedTurnover: { gt: number; curGt: number };
}

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fyText = (y: number) => `FY ${String(y).slice(2)}-${String(y + 1).slice(2)}`;
const money = (n: number | null) => (n === null ? '—' : formatMoney(n));

/** The stored turnover that belongs to `fy`: this FY so far, or last FY's figure. */
function storedFor(fy: number, stored: { gt: number; curGt: number }): number {
  const current = periodForDate('fy', new Date()).fyStart;
  if (fy === current) return stored.curGt;
  if (fy === current - 1) return stored.gt;
  return 0;
}

function RowTable({ title, rows }: { title: string; rows: Gstr9Row[] }) {
  const showTaxable = rows.some((r) => r.hasTaxable);
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Description</th>
              {showTaxable && <th scope="col" className={surface.numeric}>Taxable</th>}
              <th scope="col" className={surface.numeric}>IGST</th>
              <th scope="col" className={surface.numeric}>CGST</th>
              <th scope="col" className={surface.numeric}>SGST</th>
              <th scope="col" className={surface.numeric}>Cess</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.total ? styles.total : undefined}>
                <td className={styles.rowId}>{r.id}</td>
                <td>
                  {r.label}
                  {r.note && <span className={styles.note}>{r.note}</span>}
                </td>
                {showTaxable && <td className={surface.numeric}>{r.hasTaxable ? formatMoney(r.taxable) : ''}</td>}
                <td className={surface.numeric}>{formatMoney(r.igst)}</td>
                <td className={surface.numeric}>{formatMoney(r.cgst)}</td>
                <td className={surface.numeric}>{formatMoney(r.sgst)}</td>
                <td className={surface.numeric}>{formatMoney(r.cess)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      {children}
    </label>
  );
}

const Diff = ({ v }: { v: number | null }) =>
  v === null ? <>—</> : <span className={Math.abs(v) >= 1 ? styles.diff : undefined}>{formatMoney(v)}</span>;

/** GSTR-9 annual working paper (roadmap 5.2): lazy-loaded from the GST reports page. */
export default function Gstr9Modal(props: Gstr9ModalProps) {
  if (!props.open) return null;
  return <Gstr9Body {...props} />;
}

function Gstr9Body({ onClose, fyStart, fyOptions, gstin, filerStateCode, filerName, storedTurnover }: Gstr9ModalProps) {
  const { notify, toastNode } = useToast();
  const [fy, setFy] = useState(fyStart);
  const [turnover, setTurnover] = useState(() => {
    const v = storedFor(fyStart, storedTurnover);
    return v ? String(v) : '';
  });
  const [itc2b, setItc2b] = useState({ igst: '', cgst: '', sgst: '', cess: '' });

  const data = useMemo(() => {
    const books = loadBooksData();
    return {
      invoices: books.invoices,
      purchases: getTable<unknown>('purchases'),
      links: readLinks(),
      books,
      advances: advanceTaxEvents(books.advances ?? [], books.transactions, books.invoices),
    };
  }, []);
  const report = useMemo(
    () =>
      buildGstr9(data.invoices, data.purchases, {
        fyStart: fy,
        gstin,
        filerStateCode,
        links: data.links,
        advances: data.advances,
        turnover: Number(turnover) || 0,
        books: gstSummary(data.books, fyPeriod(fy)),
        itc2b: { igst: Number(itc2b.igst) || 0, cgst: Number(itc2b.cgst) || 0, sgst: Number(itc2b.sgst) || 0, cess: Number(itc2b.cess) || 0 },
      }),
    [data, fy, gstin, filerStateCode, turnover, itc2b],
  );

  const pickFy = (y: number) => {
    setFy(y);
    const v = storedFor(y, storedTurnover);
    setTurnover(v ? String(v) : '');
  };
  const num = (v: string) => v.replace(/[^0-9.]/g, '');
  const base = `GSTR9_${gstin || 'all'}_${report.fyLabel.replace(/\s+/g, '')}`;

  const print = () => {
    const url = URL.createObjectURL(new Blob([buildGstr9Html(report, filerName)], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => w.print());
    else notify('Your browser blocked the print window — allow pop-ups for this site and try again', 'error');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const options = [...new Set([fy, ...fyOptions])].sort((a, b) => b - a);
  const t9 = report.table9.filter((r) => r.payable || r.cash || r.id.startsWith('9-IGST') || r.id.startsWith('9-CGST') || r.id.startsWith('9-SGST'));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<><CalendarRange size={18} aria-hidden="true" /> GSTR-9 annual working paper</>}
      subtitle={`${report.fyLabel} · ${gstin || 'all GSTINs'} · ${report.documents} documents, ${report.bills} purchase bills · prepared offline`}
      footer={
        <div className={styles.actions}>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => download(`${base}.csv`, 'text/csv', gstr9Csv(report))}>
            <Download size={16} aria-hidden="true" /> CSV
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => download(`${base}_working_paper.json`, 'application/json', JSON.stringify(gstr9WorkingPaper(report), null, 2))}>
            <FileJson size={16} aria-hidden="true" /> Working paper JSON
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={print}>
            <Printer size={16} aria-hidden="true" /> Print
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className={styles.stack}>
        <div className={styles.banner} role="note">
          <ShieldAlert size={16} className={styles.bannerIcon} aria-hidden="true" />
          <span>
            <strong>Verify with your CA before filing.</strong> Built from this app&rsquo;s 12 monthly GSTR-1 / GSTR-3B
            papers and your purchase bills, not from what was filed on the portal. {report.turnover.optional
              ? `Turnover ${formatMoney(report.turnover.used)} is up to ₹2 crore, so GSTR-9 is optional for this FY.`
              : `Turnover ${formatMoney(report.turnover.used)} is above ₹2 crore, so GSTR-9 is mandatory (GSTR-9C too above ₹5 crore).`}
            {' '}The JSON is a readable working paper, not the portal&rsquo;s upload schema.
          </span>
        </div>

        <div className={styles.controls}>
          <Field label="Financial year">
            <select className={controls.select} value={fy} onChange={(e) => pickFy(Number(e.target.value))}>
              {options.map((y) => <option key={y} value={y}>{fyText(y)}</option>)}
            </select>
          </Field>
          <Field label="Aggregate turnover of the FY (₹)">
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={turnover} placeholder={String(report.turnover.computed)}
              onChange={(e) => setTurnover(num(e.target.value))} />
          </Field>
          <Field label="8A: ITC as per GSTR-2B — IGST">
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={itc2b.igst} placeholder="0" onChange={(e) => setItc2b({ ...itc2b, igst: num(e.target.value) })} />
          </Field>
          <Field label="8A — CGST">
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={itc2b.cgst} placeholder="0" onChange={(e) => setItc2b({ ...itc2b, cgst: num(e.target.value) })} />
          </Field>
          <Field label="8A — SGST">
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={itc2b.sgst} placeholder="0" onChange={(e) => setItc2b({ ...itc2b, sgst: num(e.target.value) })} />
          </Field>
          <Field label="8A — Cess">
            <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={itc2b.cess} placeholder="0" onChange={(e) => setItc2b({ ...itc2b, cess: num(e.target.value) })} />
          </Field>
        </div>
        <p className={controls.hint} style={{ margin: 0 }}>
          Turnover defaults to the figure on the GST page (this FY so far, or last FY&rsquo;s); blank uses the total worked out
          here ({formatMoney(report.turnover.computed)}). Enter 8A from your annual GSTR-2B.
        </p>

        <section className={styles.section} aria-label="Differences">
          <h3 className={styles.sectionTitle}>Differences — GSTR-1 vs GSTR-3B vs books</h3>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th scope="col">Item</th><th scope="col">Head</th>
                  <th scope="col" className={surface.numeric}>GSTR-1</th><th scope="col" className={surface.numeric}>GSTR-3B</th>
                  <th scope="col" className={surface.numeric}>Books</th><th scope="col" className={surface.numeric}>1 − 3B</th>
                  <th scope="col" className={surface.numeric}>3B − books</th>
                </tr>
              </thead>
              <tbody>
                {report.comparison.map((c: Gstr9CompareRow) => (
                  <tr key={`${c.item}-${c.head}`}>
                    <td>{c.item}</td><td>{c.head}</td>
                    <td className={surface.numeric}>{money(c.gstr1)}</td><td className={surface.numeric}>{money(c.gstr3b)}</td>
                    <td className={surface.numeric}>{money(c.books)}</td>
                    <td className={surface.numeric}><Diff v={c.diff13} /></td><td className={surface.numeric}><Diff v={c.diff3Books} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <RowTable title="Pt II · Table 4 — outward supplies on which tax is payable" rows={report.table4} />
        <RowTable title="Pt II · Table 5 — outward supplies on which tax is not payable" rows={report.table5} />
        <RowTable title="Pt III · Table 6 — ITC availed" rows={report.table6} />
        <RowTable title="Pt III · Table 7 — ITC reversed and ineligible" rows={report.table7} />
        <RowTable title="Pt III · Table 8 — other ITC information" rows={report.table8} />

        <section className={styles.section} aria-label="Table 9">
          <h3 className={styles.sectionTitle}>Pt IV · Table 9 — tax paid</h3>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th scope="col">Head</th><th scope="col" className={surface.numeric}>Payable</th><th scope="col" className={surface.numeric}>Cash</th>
                  <th scope="col" className={surface.numeric}>ITC IGST</th><th scope="col" className={surface.numeric}>ITC CGST</th><th scope="col" className={surface.numeric}>ITC SGST</th>
                </tr>
              </thead>
              <tbody>
                {t9.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}{r.note && <span className={styles.note}>{r.note}</span>}</td>
                    <td className={surface.numeric}>{formatMoney(r.payable)}</td><td className={surface.numeric}>{formatMoney(r.cash)}</td>
                    <td className={surface.numeric}>{formatMoney(r.itc.igst)}</td><td className={surface.numeric}>{formatMoney(r.itc.cgst)}</td><td className={surface.numeric}>{formatMoney(r.itc.sgst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className={styles.note}>Interest, late fee and penalty are not tracked (0). Pt V (Tables 10–14, amendments) is not modelled and shows 0.</span>
        </section>

        <p className={surface.sectionNote} style={{ margin: 0 }}>
          Pt VI: Table 17 has {report.table17.length} outward HSN row(s); Table 18 has {report.table18.length} inward HSN row(s)
          {report.billsWithoutHsn ? ` (${report.billsWithoutHsn} bill(s) without HSN-coded lines are left out)` : ''}. Both are in the CSV and the printout.
        </p>

        <ul className={styles.notes}>
          {report.notes.slice(2).map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
      {toastNode}
    </Modal>
  );
}
