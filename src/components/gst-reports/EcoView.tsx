import type { EcoRow, Gstr1Report, Gstr3bReport } from '../../lib/gst-reports';
import { DataTable, Money, type Column } from './DataTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';

const cols = (withTax: boolean): Column<EcoRow>[] => [
  { key: 'etin', label: 'Operator GSTIN', render: (r) => <span className={surface.mono}>{r.etin}</span> },
  { key: 'n', label: 'Documents', numeric: true, render: (r) => r.count },
  { key: 'v', label: 'Net value of supplies', numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
  ...(withTax
    ? ([
        { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
        { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
        { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
        { key: 'x', label: 'Cess', numeric: true, render: (r) => <Money value={r.cess} />, total: (r) => r.cess },
      ] as Column<EcoRow>[])
    : []),
];

/** GSTR-1 Table 14 (supplies through e-commerce operators) and GSTR-3B 3.1.1(ii). Loaded when the tab opens. */
export default function EcoView({ g1, g3 }: { g1: Gstr1Report; g3: Gstr3bReport }) {
  const empty = 'None in this period.';
  return (
    <>
      <p className={controls.hint} style={{ margin: 0 }}>
        Documents marked “Sold through an e-commerce operator” on the invoice. 14(a): the operator collects TCS (Sec 52) — you pay the tax; these documents are also in
        B2B / B2CL / B2CS with the operator GSTIN (B2CS type “E”). 14(b): the operator pays the tax (Sec 9(5)) — only the value is reported here and in GSTR-3B
        3.1.1(ii), not in 3.1. JSON layout (supeco / clttx / paytx) is not verified against the offline tool. Verify with your CA.
      </p>
      <h3 className={local.tbHeading}>14(a) — operator collects TCS u/s 52</h3>
      <DataTable columns={cols(true)} rows={g1.eco?.tcs ?? []} rowKey={(r) => r.etin} caption="Table 14(a)" emptyText={empty} />
      <h3 className={local.tbHeading}>14(b) — operator pays tax u/s 9(5)</h3>
      <DataTable columns={cols(false)} rows={g1.eco?.pay95 ?? []} rowKey={(r) => r.etin} caption="Table 14(b)" emptyText={empty} />
      <p className={surface.sectionNote}>
        GSTR-3B 3.1.1(ii) — taxable supplies made through an operator that pays tax u/s 9(5): <strong><Money value={g3.ecoSupplies95 ?? 0} /></strong>.
        3.1.1(i) is filed by the operator itself.
      </p>
    </>
  );
}
