/**
 * R2-C3 IMS additions to the GSTR-2B view: the period summary (counts, ITC reduction by head) with the
 * working-file downloads, and the per-document editor for ITC reduction / declared ITC / remark.
 */
import { useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  actionId,
  cleanHeads,
  declaredItcApplies,
  defaultReduction,
  effectiveAction,
  effectiveDeclaredItc,
  effectiveReduction,
  gstr2bActionsDb,
  headsTotal,
  imsIssues,
  imsSummary,
  reductionApplies,
  remarkRequired,
  type Gstr2bAction,
  type Gstr2bLine,
  type MatchResult,
  type TaxHeads,
} from '../../lib/gstr2b';
import { buildImsFile, imsFileSheets } from '../../lib/ims-file';
import { downloadText } from '../../lib/download';
import { formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { imsT } from '../../i18n/areas/gst-r2';
import { Money } from './DataTable';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gstr2b.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;
const HEADS: (keyof TaxHeads)[] = ['igst', 'cgst', 'sgst', 'cess'];
const HEAD_LABEL: Record<keyof TaxHeads, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess' };

export function ImsSummaryPanel({
  match,
  actions,
  period,
  gstin,
  remarksOn,
  onRemarksOn,
  notify,
}: {
  match: MatchResult;
  actions: ReadonlyMap<string, Gstr2bAction>;
  period: string;
  gstin: string;
  remarksOn: boolean;
  onRemarksOn: (v: boolean) => void;
  notify: Notify;
}) {
  useT();
  const s = imsSummary(match, actions, period);
  const issues = imsIssues(match, actions, period, remarksOn);
  const base = `IMS_working_${gstin || 'all'}_${period}`;
  const file = () => buildImsFile(match, actions, period, { gstin, remarksOn });
  const json = () => downloadText(`${base}.json`, JSON.stringify(file(), null, 2), 'application/json');
  const xlsx = async () => {
    try {
      const { downloadXlsx } = await import('../../lib/xlsx');
      await downloadXlsx(`${base}.xlsx`, imsFileSheets(file()));
    } catch {
      notify(imsT('fileFailed'), 'error');
    }
  };
  return (
    <section aria-labelledby="ims-r2-head" data-ims-summary>
      <h3 className={local.tbHeading} id="ims-r2-head">{imsT('head')}</h3>
      <p className={controls.hint} style={{ margin: 0 }}>{imsT('counts', { a: s.accepted, r: s.rejected, p: s.pending })}</p>
      <div className={`${surface.tableWrap} ${styles.effect}`}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{imsT('head')}</caption>
          <thead>
            <tr>
              <th scope="col">{imsT('colFigure')}</th>
              {HEADS.map((h) => <th key={h} scope="col" className={surface.numeric}>{HEAD_LABEL[h]}</th>)}
              <th scope="col" className={surface.numeric}>{imsT('total')}</th>
            </tr>
          </thead>
          <tbody>
            {([[imsT('reduction'), s.reduction], [imsT('notClaimed'), s.notClaimed]] as [string, TaxHeads][]).map(([label, h]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {HEADS.map((k) => <td key={k} className={surface.numeric}><Money value={h[k]} /></td>)}
                <td className={surface.numeric} data-ims-total={label === imsT('reduction') ? 'reduction' : 'partial'}><Money value={headsTotal(h)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={controls.hint} style={{ margin: 0 }}>{imsT('hint')}</p>
      <label className={controls.check}>
        <input type="checkbox" checked={remarksOn} onChange={(e) => onRemarksOn(e.target.checked)} /> {imsT('remarksOn')}
      </label>
      {issues.length > 0 && (
        <div className={styles.warn} role="status">
          <strong>{imsT('issues')}</strong>
          <ul>
            {issues.slice(0, 12).map((i, n) => <li key={`${i.key}-${n}`}>{i.message}</li>)}
          </ul>
        </div>
      )}
      <div className={styles.chips}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={json} data-ims-file="json">
          <Download size={14} aria-hidden /> {imsT('fileJson')}
        </button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => void xlsx()}>
          <Download size={14} aria-hidden /> {imsT('fileXlsx')}
        </button>
      </div>
      <p className={controls.hint} style={{ margin: 0 }}>{imsT('fileNote')}</p>
    </section>
  );
}

/** Short text for the table cell: what this document reduces / claims, and remark state. */
export function ImsCell({ line, actions, period, remarksOn, onEdit }: { line: Gstr2bLine; actions: ReadonlyMap<string, Gstr2bAction>; period: string; remarksOn: boolean; onEdit: () => void }) {
  useT();
  const a = actions.get(actionId(period, line));
  const act = effectiveAction(actions, period, line);
  const red = effectiveReduction(line, a);
  const parts: string[] = [];
  if (headsTotal(red) > 0) parts.push(imsT('reduces', { amount: formatMoney(headsTotal(red)) }));
  if (a?.declared_itc) parts.push(imsT('partial', { amount: formatMoney(headsTotal(effectiveDeclaredItc(line, a))) }));
  if (a?.remark) parts.push(imsT('remarkShort'));
  const missing = remarkRequired(line, act, period, remarksOn) && !a?.remark;
  if (!reductionApplies(line) && !declaredItcApplies(line) && act === 'ACCEPT') return null;
  return (
    <span>
      {parts.length > 0 && <span className={styles.sub}>{parts.join(' · ')}</span>}
      {missing && <span className={styles.sub} style={{ color: 'var(--warning)' }}>{imsT('needsRemark')}</span>}
      <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={onEdit} aria-label={imsT('editAria', { number: line.number })} data-ims-edit={line.number}>
        {imsT('edit')}
      </button>
    </span>
  );
}

const asText = (h: TaxHeads): Record<keyof TaxHeads, string> => ({ igst: String(h.igst), cgst: String(h.cgst), sgst: String(h.sgst), cess: String(h.cess) });

/** Editor for one document's ITC reduction / declared ITC / remark. */
export function ImsEditor({ line, period, actions, onClose, onSaved, notify }: { line: Gstr2bLine; period: string; actions: ReadonlyMap<string, Gstr2bAction>; onClose: () => void; onSaved: () => void; notify: Notify }) {
  useT();
  const a = actions.get(actionId(period, line));
  const canReduce = reductionApplies(line);
  const canDeclare = declaredItcApplies(line);
  const [red, setRed] = useState(() => asText(a?.itc_reduction ? cleanHeads(a.itc_reduction) : defaultReduction(line)));
  const [dec, setDec] = useState(() => asText(a?.declared_itc ? cleanHeads(a.declared_itc) : cleanHeads(line)));
  const [remark, setRemark] = useState(a?.remark ?? '');
  const save = () => {
    try {
      const redHeads = cleanHeads(red);
      const decHeads = cleanHeads(dec);
      const same = (x: TaxHeads, y: TaxHeads) => HEADS.every((k) => Math.abs(x[k] - y[k]) < 0.005);
      gstr2bActionsDb.setDetails(period, line, {
        itc_reduction: canReduce ? (same(redHeads, defaultReduction(line)) ? null : redHeads) : undefined,
        declared_itc: canDeclare ? (same(decHeads, cleanHeads(line)) ? null : decHeads) : undefined,
        remark,
      });
      notify(imsT('saved', { number: line.number }));
      onSaved();
    } catch {
      notify(imsT('saveFailed'), 'error');
    }
  };
  const headInputs = (vals: Record<keyof TaxHeads, string>, set: (v: Record<keyof TaxHeads, string>) => void, prefix: string) => (
    <div className={styles.chips}>
      {HEADS.map((k) => (
        <label key={k} className={controls.field}>
          <span className={controls.label}>{HEAD_LABEL[k]}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={vals[k]} onChange={(e) => set({ ...vals, [k]: e.target.value })} data-ims-head={`${prefix}-${k}`} />
        </label>
      ))}
    </div>
  );
  return (
    <section className={surface.panel} aria-labelledby="ims-editor-head" data-ims-editor>
      <div className={local.toolbar}>
        <h4 id="ims-editor-head" className={local.tbHeading}>{imsT('editorHead', { number: line.number })}</h4>
        <button type="button" className={controls.btnIcon} onClick={onClose} aria-label={imsT('close')}><X size={16} /></button>
      </div>
      {canReduce && (
        <>
          <strong>{imsT('reductionHead')}</strong>
          {headInputs(red, setRed, 'red')}
          <p className={controls.hint} style={{ margin: 0 }}>{imsT('reductionHint')}</p>
        </>
      )}
      {canDeclare && (
        <>
          <strong>{imsT('declaredHead')}</strong>
          {headInputs(dec, setDec, 'dec')}
          <p className={controls.hint} style={{ margin: 0 }}>{imsT('declaredHint')}</p>
        </>
      )}
      <label className={controls.field}>
        <span className={controls.label}>{imsT('remark')}</span>
        <input className={controls.input} maxLength={500} value={remark} placeholder={imsT('remarkPh')} onChange={(e) => setRemark(e.target.value)} data-ims-remark />
      </label>
      <div className={styles.chips}>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={save}>{imsT('save')}</button>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
          onClick={() => {
            setRed(asText(defaultReduction(line)));
            setDec(asText(cleanHeads(line)));
          }}
        >
          {imsT('reset')}
        </button>
      </div>
    </section>
  );
}
