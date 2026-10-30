import { useMemo } from 'react';
import { FileDown } from 'lucide-react';
import { Page } from '../components/ui/Page';
import { EmptyState } from '../components/ui/EmptyState';
import { exportsState } from '../components/discover';
import { peekTable } from '../lib/storage';
import { discoverT } from '../i18n/areas/discover-r6';
import controls from '../styles/controls.module.css';
import { ExportCenter } from '../components/exports/ExportCenter';
import { useT } from '../i18n';
import { expT } from '../i18n/areas/exports';

/** Route: /exports — hand data to accountants (Tally Prime XML, CSV registers, JSON bundle). */
export function Exports() {
  useT();
  // R6-B3: nothing (or only drafts) to export yet — one line before the export cards.
  const state = useMemo(() => exportsState(peekTable<{ status?: string; issue_date?: string }>('invoices'), peekTable<{ date?: string }>('purchases')), []);
  return (
    <Page
      title={expT('title')}
      subtitle={expT('subtitle')}
    >
      {state !== 'ok' && (
        <EmptyState
          icon={FileDown}
          title={discoverT('exportsTitle')}
          text={discoverT(state === 'drafts-only' ? 'exportsDrafts' : 'exportsText')}
          action={
            <button type="button" className={controls.btnOutline} onClick={() => document.getElementById('ex-period-sel')?.focus()} data-exports-empty>
              {discoverT('changePeriod')}
            </button>
          }
        />
      )}
      <ExportCenter />
    </Page>
  );
}

export default Exports;
