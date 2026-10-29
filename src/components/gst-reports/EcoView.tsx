import { table14Ab, type EcoRow, type Gstr1Report, type Gstr3bReport } from '../../lib/gst-reports';
import { DataTable, Money, type Column } from './DataTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';
import { table14A } from '../../lib/eco-amend';
import { r7T } from '../../i18n/areas/gst-tds-7r';
import { useT } from '../../i18n';
import { gstGapT } from '../../i18n/areas/gst-gaps';

const cols = (withTax: boolean): Column<EcoRow>[] => [
  { key: 'etin', label: gstGapT('ecoOperator'), render: (r) => <span className={surface.mono}>{r.etin}</span> },
  { key: 'n', label: gstGapT('ecoDocs'), numeric: true, render: (r) => r.count },
  { key: 'v', label: gstGapT('ecoNet'), numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
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
  useT(); // re-render on a language switch / when the Hindi pack arrives
  const empty = gstGapT('ecoNone');
  const t14a = table14A(g1);
  const t14ab = table14Ab(g1);
  return (
    <>
      <p className={controls.hint} style={{ margin: 0 }}>
        {gstGapT('ecoHint')}
      </p>
      <h3 className={local.tbHeading}>{gstGapT('eco14a')}</h3>
      <DataTable columns={cols(true)} rows={g1.eco?.tcs ?? []} rowKey={(r) => r.etin} caption="Table 14(a)" emptyText={empty} />
      <h3 className={local.tbHeading}>{gstGapT('eco14b')}</h3>
      <DataTable columns={cols(false)} rows={g1.eco?.pay95 ?? []} rowKey={(r) => r.etin} caption="Table 14(b)" emptyText={empty} />
      <p className={surface.sectionNote}>
        {gstGapT('eco311')} <strong><Money value={g3.ecoSupplies95 ?? 0} /></strong>.{' '}
        {gstGapT('eco311i')}
      </p>
      <h3 className={local.tbHeading}>{r7T('eco14aTitle')}</h3>
      <DataTable
        caption="Table 14A"
        emptyText={empty}
        rows={t14a}
        rowKey={(r) => `${r.etin}${r.origPeriod}`}
        columns={[
          { key: 'etin', label: gstGapT('ecoOperator'), render: (r) => <span className={surface.mono}>{r.etin}</span> },
          { key: 'op', label: r7T('eco14aPeriod'), render: (r) => `${r.origPeriod.slice(0, 2)}/${r.origPeriod.slice(2)}` },
          { key: 'n', label: gstGapT('ecoDocs'), numeric: true, render: (r) => r.count },
          { key: 'v', label: r7T('eco14aValue'), numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
          { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
          { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
          { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
          { key: 'x', label: 'Cess', numeric: true, render: (r) => <Money value={r.cess} />, total: (r) => r.cess },
        ]}
      />
      <p className={controls.hint}>{r7T('eco14aNote')}</p>
      <h3 className={local.tbHeading}>{r7T('eco14abTitle')}</h3>
      <DataTable
        caption="Table 14A(b)"
        emptyText={empty}
        rows={t14ab}
        rowKey={(r) => `${r.etin}${r.origPeriod}`}
        columns={[
          { key: 'etin', label: gstGapT('ecoOperator'), render: (r) => <span className={surface.mono}>{r.etin}</span> },
          { key: 'op', label: r7T('eco14aPeriod'), render: (r) => `${r.origPeriod.slice(0, 2)}/${r.origPeriod.slice(2)}` },
          { key: 'n', label: gstGapT('ecoDocs'), numeric: true, render: (r) => r.count },
          { key: 'v', label: r7T('eco14aValue'), numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
        ]}
      />
      <p className={controls.hint}>{r7T('eco14abNote')}</p>
    </>
  );
}
