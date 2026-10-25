import type { Gstr3bReport } from '../../lib/gst-reports';
import { DataTable, Money, type Column } from './DataTable';
import styles from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { plural } from '../../i18n/areas/plural';

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
  { key: 'table', label: gvT('colTable'), render: (r) => <span className={styles.tag}>{r.table}</span> },
  { key: 'label', label: gvT('colDescription'), render: (r) => r.label },
  opt('taxable'),
  opt('igst'),
  opt('cgst'),
  opt('sgst'),
];

export function Gstr3bView({ report: b }: { report: Gstr3bReport }) {
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
    h('4C', 'Net ITC available (A - B)', b.itc.net),
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
        <li>{gvT('n3bNoInterest')}</li>
      </ul>
    </>
  );
}
