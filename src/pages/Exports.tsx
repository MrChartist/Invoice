import { PageHeader } from '../components/ui/PageHeader';
import surface from '../styles/surface.module.css';
import { ExportCenter } from '../components/exports/ExportCenter';
import { useT } from '../i18n';
import { expT } from '../i18n/areas/exports';

/** Route: /exports — hand data to accountants (Tally Prime XML, CSV registers, JSON bundle). */
export function Exports() {
  useT();
  return (
    <div className={surface.page}>
      <PageHeader
        title={expT('title')}
        subtitle={expT('subtitle')}
      />
      <ExportCenter />
    </div>
  );
}

export default Exports;
