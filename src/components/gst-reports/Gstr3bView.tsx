import type { Gstr3bReport } from '../../lib/gst-reports';
import { DataTable, Money, type Column } from './DataTable';
import styles from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { plural } from '../../i18n/areas/plural';
import { gstT } from '../../i18n/areas/gst';
import { formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import { o7T } from '../../i18n/areas/gst-tds-7o';
import { Term } from '../help/Term';
import type { GlossaryId } from '../../lib/help/glossary';

/** R6-A3: the glossary term behind a 3B table code (3.1, 4(A), 4(B)(1), 4(B)(2), 4(C)). */
const termOf = (table: string): GlossaryId | null =>
  table.startsWith('3.1') ? 'gstr3b-31' : table.startsWith('4A') ? 'gstr3b-4a' : table === '4B(1)' ? 'gstr3b-4b1' : table === '4B(2)' ? 'gstr3b-4b2' : table === '4C' ? 'gstr3b-4c' : null;

interface Row {
  table: string;
  label: string;
  taxable?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
}

const opt = (k: 'taxable' | 'igst' | 'cgst' | 'sgst'): Column<Row> => ({
  key: k,
  label: k === 'taxable' ? gvT('colTaxableValue') : k.toUpperCase(),
  numeric: true,
  render: (r) => (r[k] === undefined ? '' : <Money value={r[k] as number} />),
});

/** Built per render so the headers follow the interface language. */
const cols = (): Column<Row>[] => [
  { key: 'table', label: gvT('colTable'), render: (r) => { const id = termOf(r.table); return <span className={styles.tag}>{id ? <Term id={id}>{r.table}</Term> : r.table}</span>; } },
  { key: 'label', label: gvT('colDescription'), render: (r) => r.label },
  opt('taxable'),
  opt('igst'),
  opt('cgst'),
  opt('sgst'),
];

export function Gstr3bView({ report: b, onOpenSetOff }: { report: Gstr3bReport; onOpenSetOff?: () => void }) {
  useT();
  const COLS = cols();
  const o = b.outward;
  const p = b.payment;
  const t31: Row[] = [
    { table: '3.1(a)', label: 'Outward taxable supplies (other than zero rated, nil rated, exempted)', ...o.taxable },
    { table: '3.1(b)', label: 'Outward taxable supplies (zero rated)', ...o.zeroRated },
    { table: '3.1(c)', label: 'Other outward supplies (nil rated, exempted) - inter-state', taxable: o.nilExempt.inter },
    { table: '3.1(c)', label: 'Other outward supplies (nil rated, exempted) - intra-state', taxable: o.nilExempt.intra },
    { table: '3.1(d)', label: 'Inward supplies liable to reverse charge', ...o.inwardRcm },
    { table: '3.1(e)', label: 'Non-GST outward supplies', taxable: o.nonGst },
  ];
  const t32: Row[] = b.interStateUnreg.map((u) => ({
    table: '3.2',
    label: `Inter-state supplies to unregistered persons, place of supply ${u.pos}`,
    taxable: u.taxable,
    igst: u.igst,
  }));
  const h = (table: string, label: string, x: { igst: number; cgst: number; sgst: number }): Row => ({
    table, label, igst: x.igst, cgst: x.cgst, sgst: x.sgst,
  });
  const t4: Row[] = [
    h('4A(1)', 'ITC available: import of goods', b.itc.importGoods),
    h('4A(2)', 'ITC available: import of services', b.itc.importServices),
    h('4A(3)', 'ITC available: inward supplies liable to reverse charge', b.itc.availableRcm),
    h('4A(5)', 'ITC available: all other ITC', b.itc.availableOther),
    h('4B(1)', 'ITC reversed: rules 38, 42, 43 and section 17(5)', b.itc.reversedRules),
    h('4B(2)', 'ITC reversed: others', b.itc.reversedOther),
    // 7O (7.91): a negative 4C (reversals above the period's ITC) is shown as it is, not floored at zero.
    h('4C', 'Net ITC available (A - B)', b.itc.netSigned ?? b.itc.net),
    h('4D(2)', 'Ineligible ITC: others', b.itc.ineligible),
  ];
  const t5: Row[] = [
    { table: '5', label: 'Inward supplies from composition / exempt / nil - inter-state', taxable: b.inwardExempt.inter },
    { table: '5', label: 'Inward supplies from composition / exempt / nil - intra-state', taxable: b.inwardExempt.intra },
  ];
  const t61: Row[] = [
    h('6.1', 'Tax payable on outward supplies (before ITC)', p.liability),
    h('6.1', 'Tax payable under reverse charge (cash only)', p.rcLiability),
    h('6.1', 'ITC IGST utilised', { igst: p.itcUsed.igst.igst, cgst: p.itcUsed.igst.cgst, sgst: p.itcUsed.igst.sgst }),
    h('6.1', 'ITC CGST utilised', { igst: p.itcUsed.cgst.igst, cgst: p.itcUsed.cgst.cgst, sgst: 0 }),
    h('6.1', 'ITC SGST utilised', { igst: p.itcUsed.sgst.igst, cgst: 0, sgst: p.itcUsed.sgst.sgst }),
    h('6.1', 'Tax payable in cash', p.cash),
    h('6.1', 'ITC carried forward', p.itcCarry),
  ];

  const block = (title: string, rows: Row[], empty: string) => (
    <>
      <h3 className={styles.tbHeading}>{title}</h3>
      <DataTable columns={COLS} rows={rows} rowKey={(_, i) => `${title}-${i}`} caption={title} emptyText={empty} />
    </>
  );

  return (
    <>
      {block(gvT('b31'), t31, '')}
      {block(gvT('b32'), t32, gvT('b32Empty'))}
      {block(gvT('b4'), t4, '')}
      {block(gvT('b5'), t5, '')}
      {block(gvT('b61'), t61, '')}
      {onOpenSetOff && (
        <div className={surface.statGrid} data-3b-liability-card>
          <div className={surface.stat}>
            <div className={surface.statTop}><span className={surface.statLabel}>{gvT('liabCashLabel')}</span></div>
            <div className={surface.statValue}>{formatMoney(p.cash.igst + p.cash.cgst + p.cash.sgst + (p.cess ?? 0))}</div>
            <div className={surface.statHint}>
              <button type="button" className={styles.issueLink} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={onOpenSetOff}>{gstT('openSetoff')}</button>
            </div>
          </div>
        </div>
      )}
      <ul className={styles.notes}>
        <li>{gvT('n3bSetoff')}</li>
        <li>{plural(gvT, 'n3bItcOne', 'n3bItcMany', b.purchasesConsidered)}</li>
        {b.advances && (
          <li>
            {gvT('n3bAdvances', {
              recTax: (b.advances.received.igst + b.advances.received.cgst + b.advances.received.sgst).toFixed(2),
              recTaxable: b.advances.received.taxable.toFixed(2),
              adjTax: (b.advances.adjusted.igst + b.advances.adjusted.cgst + b.advances.adjusted.sgst).toFixed(2),
              adjTaxable: b.advances.adjusted.taxable.toFixed(2),
            })}
          </li>
        )}
        {b.outwardRcmTaxable !== 0 && (
          <li>{gvT('n3bOutwardRcm', { amount: b.outwardRcmTaxable.toFixed(2) })}</li>
        )}
        {(b.unadjustedCredit.igst > 0 || b.unadjustedCredit.cgst > 0 || b.unadjustedCredit.sgst > 0) && (
          <li>{gvT('n3bExcessCredit', { igst: b.unadjustedCredit.igst, cgst: b.unadjustedCredit.cgst, sgst: b.unadjustedCredit.sgst })}</li>
        )}
        {b.itc.netSigned && (
          <li data-3b-negative-itc>
            {o7T('n3bNegative', {
              igst: Math.min(b.itc.netSigned.igst, 0).toFixed(2),
              cgst: Math.min(b.itc.netSigned.cgst, 0).toFixed(2),
              sgst: Math.min(b.itc.netSigned.sgst, 0).toFixed(2),
              cess: Math.min(b.itc.netSigned.cess, 0).toFixed(2),
            })}
          </li>
        )}
        <li>{gvT('n3bNoInterest')}</li>
      </ul>
    </>
  );
}
