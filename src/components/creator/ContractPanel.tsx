/**
 * R11 (CN-A3): the editor's "Contract & RA bill" panel — shows and edits the construction snapshot of THIS document
 * (`boq_terms.cn`): the contract particulars, the site (place of supply = site State, Sec 12(3)), the paper style and,
 * per line, BOQ item no. / M-book / tax class / line class / approval. "Refresh from BOQ" re-snapshots the header.
 * Lazy; mounted by DocumentMetaCard only with the works pack on or a document that carries the snapshot / an RA number.
 * Issued documents change through the normal save (period lock, audit, revision path).
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { useT } from '../../i18n';
import { cnT } from '../../i18n/areas/construction-r11a';
import { cnPaperT, type CnPaperKey } from '../../i18n/areas/construction-r11-paper';
import { INDIAN_STATES } from '../../lib/india-states';
import { localDb } from '../../lib/localDb';
import { contractValue } from '../../lib/works/boq';
import { cnHeaderSnapshot } from '../../lib/construction/cn-snapshot';
import { contractOfBoq } from '../../lib/construction/cn-snapshot-io';
import { CN_CLASSES, classConflicts, mixedSupplyInstall, otherStateNotice, rateDiffers, reclassAsWorks, SPLIT_CAUTION, classRate } from '../../lib/construction/cn-tax';
import { resolveStateCode } from '../../lib/india-states';
import type { CnHeader, CnLine, CnSnapshot, RaPaperStyle } from '../../types/construction-r11';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type TextKey = 'name_of_work' | 'agreement_no' | 'work_order_no' | 'tender_ref' | 'client_office' | 'engineer' | 'ra_label';
type DateKey = 'agreement_date' | 'work_order_date' | 'stipulated_start' | 'stipulated_completion' | 'extended_completion' | 'period_from' | 'period_to' | 'measured_on';
const TEXT: readonly [TextKey, CnPaperKey][] = [['name_of_work', 'p.nameOfWork'], ['agreement_no', 'p.agreement'], ['work_order_no', 'p.workOrder'], ['tender_ref', 'p.tender'], ['client_office', 'p.clientOffice'], ['engineer', 'p.engineer'], ['ra_label', 'p.bill']];
const DATES: readonly [DateKey, string][] = [['agreement_date', 'p.agreement'], ['work_order_date', 'p.workOrder'], ['stipulated_start', 'p.stipulated'], ['stipulated_completion', 'p.stipulated'], ['extended_completion', 'p.extended'], ['period_from', 'p.period'], ['period_to', 'p.period'], ['measured_on', 'p.measuredOn']];
const PAPERS: readonly RaPaperStyle[] = ['standard', 'pwd', 'summary'];

export default function ContractPanel() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['boq_terms', 'boq_id', 'ra_no', 'ra_final', 'items', 'issue_date', 'place_of_supply', 'patch', 'patchItem'])));
  const cn: CnSnapshot = s.boq_terms?.cn ?? {};
  const h: CnHeader = cn.header ?? {};
  const lines = cn.lines ?? {};
  const setCn = (next: CnSnapshot) => s.patch({ boq_terms: { ...s.boq_terms, cn: { v: 1, ...next } } });
  const setH = (p: Partial<CnHeader>) => setCn({ ...cn, header: { ...h, ...p } });
  const setLine = (id: string, p: Partial<CnLine>) => setCn({ ...cn, lines: { ...lines, [id]: { ...lines[id], ...p } } });
  const senderStates = useMemo(() => (localDb.settings.get().profiles ?? []).map((p) => resolveStateCode({ code: p.stateCode, gstin: p.companyGstin })), []);
  const notice = otherStateNotice(h.site, senderStates);
  const classes = s.items.map((it) => lines[it.id]?.cls);
  const refresh = () => {
    const boq = s.boq_id ? localDb.invoices.getById(s.boq_id) : undefined;
    if (!boq) return;
    setH(cnHeaderSnapshot(boq, contractOfBoq(boq.id), { raNo: s.ra_no ?? 1, final: s.ra_final, date: s.issue_date, period_from: h.period_from, period_to: h.period_to, measured_on: h.measured_on, mb_refs: Object.values(lines).map((l) => l.mb) }, contractValue(boq)));
  };
  const lbl = (k: string) => cnPaperT(k as CnPaperKey);
  return (
    <details className={surface.card} data-contract-panel open={!!s.ra_no || undefined}>
      <summary className={controls.label}>{cnT('panelTitle')}</summary>
      <p className={controls.hint}>{cnT('panelLede')}</p>
      <label className={controls.check}>
        <input type="checkbox" checked={!!cn.works} onChange={(e) => setCn({ ...cn, works: e.target.checked || undefined })} data-cn-works /> {cnT('worksBill')}
      </label>
      {s.boq_id && <button type="button" className={controls.btnOutline} onClick={refresh} data-cn-refresh>{cnT('refresh')}</button>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
        {TEXT.map(([k, l]) => (
          <label key={k} className={controls.field}><span className={controls.label}>{lbl(l)}</span>
            <input className={controls.input} value={h[k] ?? ''} onChange={(e) => setH({ [k]: e.target.value || undefined })} data-cn-field={k} /></label>
        ))}
        {DATES.map(([k, l]) => (
          <label key={k} className={controls.field}><span className={controls.label}>{lbl(l)} ({k.replace(/_/g, ' ')})</span>
            <input className={controls.input} type="date" value={h[k] ?? ''} onChange={(e) => setH({ [k]: e.target.value || undefined })} /></label>
        ))}
        <label className={controls.field}><span className={controls.label}>{lbl('p.contractValue')}</span>
          <input className={controls.input} type="number" value={h.contract_value ?? ''} onChange={(e) => setH({ contract_value: Number(e.target.value) || undefined })} /></label>
        <label className={controls.field}><span className={controls.label}>{cnT('siteAddress')}</span>
          <input className={controls.input} value={h.site?.address ?? ''} onChange={(e) => setH({ site: { ...h.site, address: e.target.value || undefined } })} data-cn-site /></label>
        <label className={controls.field}><span className={controls.label}>{cnT('siteState')}</span>
          <select className={controls.select} value={h.site?.state_code ?? ''} onChange={(e) => setH({ site: { ...h.site, state_code: e.target.value || undefined } })}>
            <option value="">—</option>
            {INDIAN_STATES.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
          </select></label>
        <label className={controls.field}><span className={controls.label}>{cnT('paperStyle')}</span>
          <select className={controls.select} value={cn.paper ?? 'standard'} onChange={(e) => setCn({ ...cn, paper: e.target.value as RaPaperStyle })} data-cn-paper>
            {PAPERS.map((p) => <option key={p} value={p}>{cnT(`paper.${p}`)}</option>)}
          </select></label>
      </div>
      {h.site?.state_code && h.site.state_code !== s.place_of_supply && (
        <button type="button" className={controls.btnOutline} onClick={() => s.patch({ place_of_supply: h.site!.state_code })}>{cnT('useSitePos')}</button>
      )}
      {notice && <p className={controls.hint} role="note">{notice}</p>}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption>{cnT('lines')}</caption>
          <thead><tr><th>#</th><th>{cnT('boqRef')}</th><th>{cnT('mbRef')}</th><th>{cnT('cls')}</th><th>{cnT('kind')}</th><th>{cnT('approval')}</th></tr></thead>
          <tbody>
            {s.items.map((it, i) => {
              const l = lines[it.id] ?? {};
              return (
                <tr key={it.id}>
                  <td title={it.name}>{i + 1}</td>
                  <td><input className={controls.input} value={l.ref ?? it.boq_ref ?? ''} onChange={(e) => setLine(it.id, { ref: e.target.value || undefined })} aria-label={cnT('boqRef')} /></td>
                  <td><input className={controls.input} value={l.mb ?? ''} onChange={(e) => setLine(it.id, { mb: e.target.value || undefined })} aria-label={cnT('mbRef')} /></td>
                  <td>
                    <select className={controls.select} value={l.cls ?? ''} onChange={(e) => {
                      const cls = (e.target.value || undefined) as CnLine['cls'];
                      setLine(it.id, { cls });
                      const r = classRate(cls, s.issue_date);
                      if (r && r.rate !== null && !it.tax_rate) s.patchItem(it.id, { tax_rate: r.rate });
                    }} aria-label={cnT('cls')}>
                      <option value="">{cnT('cls.none')}</option>
                      {CN_CLASSES.map((c) => <option key={c} value={c}>{cnT(`cls.${c}` as 'cls.wc_general')}</option>)}
                    </select>
                    {classConflicts(l.cls) && <span className={controls.hint}>{cnT('conflict')}</span>}
                    {rateDiffers(Number(it.tax_rate) || 0, l.cls, s.issue_date) && <span className={controls.hint}>{cnT('rateDiffers', { name: it.name, rate: classRate(l.cls, s.issue_date)?.rate ?? '' })}</span>}
                  </td>
                  <td>
                    <select className={controls.select} value={l.kind ?? 'boq'} onChange={(e) => setLine(it.id, { kind: e.target.value as CnLine['kind'] })} aria-label={cnT('kind')}>
                      {(['boq', 'extra', 'substituted', 'deviation'] as const).map((k) => <option key={k} value={k}>{cnT(`kind.${k}`)}</option>)}
                    </select>
                  </td>
                  <td><input className={controls.input} value={l.approval ?? ''} onChange={(e) => setLine(it.id, { approval: e.target.value || undefined })} aria-label={cnT('approval')} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mixedSupplyInstall(classes) && (
        <p className={controls.hint} role="note">
          {SPLIT_CAUTION} <button type="button" className={controls.btnOutline} onClick={() => setCn({ ...cn, lines: reclassAsWorks(lines) })}>{cnT('treatAsWorks')}</button>
        </p>
      )}
      <p className={controls.hint}>{cnT('deductionsNote')}</p>
    </details>
  );
}
