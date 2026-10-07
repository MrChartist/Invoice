import type { Gstr3bReport } from '../../lib/gst-reports';
import { DataTable, Money, type Column } from './DataTable';
import styles from './gst-reports.module.css';

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
  label: k === 'taxable' ? 'Taxable value' : k.toUpperCase(),
  numeric: true,
  render: (r) => (r[k] === undefined ? '' : <Money value={r[k] as number} />),
});

const COLS: Column<Row>[] = [
  { key: 'table', label: 'Table', render: (r) => <span className={styles.tag}>{r.table}</span> },
  { key: 'label', label: 'Description', render: (r) => r.label },
  opt('taxable'),
  opt('igst'),
  opt('cgst'),
  opt('sgst'),
];

export function Gstr3bView({ report: b }: { report: Gstr3bReport }) {
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
    h('4A(3)', 'ITC available: inward supplies liable to reverse charge', b.itc.availableRcm),
    h('4A(5)', 'ITC available: all other ITC', b.itc.availableOther),
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
      {block('3.1 Outward and inward reverse-charge supplies', t31, '')}
      {block('3.2 Inter-state supplies to unregistered persons', t32, 'No inter-state supplies to unregistered persons.')}
      {block('4 Eligible input tax credit', t4, '')}
      {block('5 Exempt, nil-rated and non-GST inward supplies', t5, '')}
      {block('6.1 Payment of tax and ITC set-off', t61, '')}
      <ul className={styles.notes}>
        <li>Set-off order: IGST credit pays IGST, then CGST, then SGST; CGST and SGST credit pay their own head first, then IGST (never each other). Reverse-charge tax is payable in cash.</li>
        <li>ITC is taken only from purchase bills in the period that are not marked ITC-ineligible ({b.purchasesConsidered} bill{b.purchasesConsidered === 1 ? '' : 's'} read). Imports, ISD, rule 42/43 reversals and cess are not modelled.</li>
        {b.outwardRcmTaxable !== 0 && (
          <li>Outward supplies of {b.outwardRcmTaxable.toFixed(2)} where the recipient pays tax under reverse charge are in GSTR-1 (B2B, RC = Y) but excluded from 3.1.</li>
        )}
        {(b.unadjustedCredit.igst > 0 || b.unadjustedCredit.cgst > 0 || b.unadjustedCredit.sgst > 0) && (
          <li>Credit notes exceed sales on some heads (IGST {b.unadjustedCredit.igst}, CGST {b.unadjustedCredit.cgst}, SGST {b.unadjustedCredit.sgst}); the excess cannot be set off this month.</li>
        )}
        <li>Interest and late fee are not computed.</li>
      </ul>
    </>
  );
}
