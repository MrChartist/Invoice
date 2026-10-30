/**
 * R14 PS-C1 editor chip (lazy, under the editor's supply type for an export document, pack `svcexport` only): "Export
 * of services: n / 5" with the conditions on hover, the purpose code (PS39) and the Rule 34(2) note on a foreign-currency
 * document. A draft snapshots the result as `ps.export.checks` (and `ps.purpose_code`); an issued document is never
 * rewritten. Soft only — the supply type is never changed.
 */
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { ExportIrm } from '../../types/trade-r4';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { impliedPacks } from '../../lib/shop-mode';
import { checkApplies, exportCheck, snapChecks, verdict } from '../../lib/prof/ps-export-check';
import { PURPOSE_BY_KIND, purposeCodes, readPurposeCode } from '../../lib/prof/ps-platforms';
import { useT } from '../../i18n';
import { pcT, type PcKey } from '../../i18n/areas/prof-r14c-export';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { SelectField } from '../ui/SelectField';

export default function ExportCheckChip() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ id: st.id, status: st.status, supply_type: st.supply_type, place_of_supply: st.place_of_supply, currency: st.currency, client: st.client, sender: st.sender, issue_date: st.issue_date, ps: st.ps, patch: st.patch })));
  const settings = localDb.settings.get();
  const on = impliedPacks(settings).includes('svcexport');
  const draft = !s.id || s.status === 'Draft';
  const check = useMemo(() => {
    const doc = { ...s, items: [] } as unknown as Partial<InvoiceRecord>;
    if (!on || !checkApplies(doc)) return null;
    const party = s.client?.id ? localDb.clients.getById(s.client.id) : null;
    return exportCheck({ invoice: doc, client: party ?? s.client, receipts: s.id ? getTable<Payment>('transactions') : [], irms: s.id ? getTable<ExportIrm>('export_irms') : [] });
  }, [s, on]);
  const x = s.ps?.export;
  const code = s.ps?.purpose_code ?? readPurposeCode() ?? (settings.prof_kind ? PURPOSE_BY_KIND[settings.prof_kind] : undefined) ?? '';
  const { patch } = s;
  useEffect(() => {
    if (!on || !draft || !check) return;
    const checks = snapChecks(check);
    if (JSON.stringify(x?.checks) === JSON.stringify(checks) && s.ps?.purpose_code === (code || undefined)) return;
    patch({ ps: { ...s.ps, ...(code ? { purpose_code: code } : {}), export: { ...x, checks, checked_on: check.at } } });
  }, [on, draft, check, code, x, s.ps, patch]);
  if (!on || !check) return null;
  const v = verdict(check);
  return (
    <div data-ps-chip={v}>
      <span className={`${surface.badge} ${v === 'export' ? surface.badgePaid : v === 'not' ? surface.badgeOverdue : surface.badgePartial}`} title={check.items.map((i) => `${pcT(`c.${i.id}`)}: ${pcT(`r.${i.reason}` as PcKey)}`).join('\n')}>{pcT('chip', { ok: check.ok })}</span>
      {draft && (
        <SelectField className={controls.select} aria-label={pcT('purpose')} value={code} onChange={(e) => patch({ ps: { ...s.ps, purpose_code: e.target.value } })}>
          {purposeCodes().map(([c, l]) => <option key={c} value={c}>{`${c}: ${l}`}</option>)}
        </SelectField>
      )}
      {String(s.currency || 'INR').toUpperCase() !== 'INR' && <p className={controls.hint}>{pcT('rule342')}</p>}
    </div>
  );
}
