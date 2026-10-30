/** R17-C2 purchase-bill row (lazy, packs `manpower` / `security`): the site a bill is charged to (`PurchaseRecord.mp`). */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import type { PurchaseRecord } from '../../types/purchases';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

type Tag = PurchaseRecord['mp'];

export default function SitePick({ value, onChange }: { value: Tag; onChange: (v: Tag) => void }) {
  useT();
  const sites = useMemo(() => loadSites(), []);
  if (!sites.length && !value) return null;
  return (
    <label className={controls.field}><span className={controls.label}>{mpT('site')}</span>
      <SelectField className={controls.select} value={value?.site_id ?? ''} onChange={(e) => onChange(e.target.value ? { site_id: e.target.value } : undefined)} data-mp-bill-site-pick>
        <option value="">-</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{siteLabel(s)}</option>)}
      </SelectField>
    </label>
  );
}
