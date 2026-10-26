/**
 * The GST filing strip (8I, moved out of `GstReports.tsx` in R6-C4): Period → Check → (portal errors) → Download JSON →
 * Mark filed. The forms follow the period and the filer (`stripForms`): GSTR-1 + 3B, IFF in QRMP months 1–2, CMP-08
 * for a composition quarter. "Downloaded" and "filed" are the period's `compliance` rows (`downloaded_at`, `filed_on`),
 * so both survive a reload and show on the Compliance tab. Working papers — verify with your CA before filing.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { downloadedFor, filedFor, loadFiled, saveFiled, setFiled, stripForms, stripReturn, type FiledReturn, type FilerFrequency, type ReturnForm } from '../../lib/compliance';
import { periodRange, type ReportPeriod } from '../../lib/gst-reports';
import type { PreflightForm } from '../../lib/gst-preflight';
import { formatDate } from '../../lib/utils';
import { fiT } from '../../i18n/areas/filing';
import { c6T } from '../../i18n/areas/closures-r6';
import { useT } from '../../i18n';
import surface from '../../styles/surface.module.css';
import filing from './filing.module.css';

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const FORM_TEXT: Record<ReturnForm, string> = { GSTR1: 'GSTR-1', GSTR3B: 'GSTR-3B', IFF: 'IFF', CMP08: 'CMP-08', PMT06: 'PMT-06', GSTR9: 'GSTR-9', GSTR4: 'GSTR-4' };

export interface FilingStripProps {
  period: ReportPeriod;
  label: string;
  gstin: string;
  frequency: FilerFrequency;
  checkCount: number;
  onCheck: () => void;
  portalErrors: number;
  portalLabel: string;
  onPortalErrors: () => void;
  /** Report has data and a GSTIN is picked. */
  canDownload: boolean;
  /** Runs the guarded download (preflight first); the page calls `rememberDownload` once it went through. */
  onDownload: (form: PreflightForm) => void;
  /** Bumped by the page after a download, so the strip re-reads the compliance rows. */
  version: number;
  needGstinTitle?: Partial<Record<ReturnForm, string>>;
  onError: (message: string) => void;
}

export function FilingStrip(p: FilingStripProps) {
  useT();
  const forms = stripForms(p.period as never, p.frequency);
  const range = periodRange(p.period);
  // The page's downloads (version) and this strip's marks (tick) write the `compliance` table; re-read it then.
  const [tick, setTick] = useState(0);
  const rows = useMemo<FiledReturn[]>(() => {
    void tick;
    void p.version;
    return loadFiled();
  }, [tick, p.version]);
  const returnFor = (form: ReturnForm) => stripReturn(p.period, form, p.frequency, range, p.label);
  const marked = p.period.kind !== 'fy';
  const isFiled = (form: ReturnForm) => marked && !!filedFor(rows, returnFor(form), p.gstin);
  const downloadedOn = (form: ReturnForm) => (marked ? downloadedFor(rows, returnFor(form), p.gstin) : '');
  const toggleFiled = (form: ReturnForm) => {
    const next = setFiled(rows, returnFor(form), p.gstin, isFiled(form) ? null : localToday());
    try {
      saveFiled(next);
    } catch {
      p.onError(fiT('markFailed'));
    }
    setTick((t) => t + 1);
  };
  const downloadable = forms.filter((f): f is PreflightForm => f === 'GSTR1' || f === 'GSTR3B' || f === 'IFF');
  const allDownloaded = downloadable.length > 0 && downloadable.every((f) => !!downloadedOn(f));

  return (
    <ol className={`${surface.card} ${filing.strip}`} aria-label={fiT('stripLabel')} data-filing-strip>
      <li className={filing.stepDone}>
        <span className={filing.stepName}>{fiT('stepPeriod')}</span>
        <span className={filing.stepSub}>{p.label}{p.gstin ? ` · ${p.gstin}` : ''}</span>
      </li>
      <li className={p.checkCount ? filing.stepWarn : filing.stepDone}>
        <button type="button" className={filing.stepBtn} onClick={p.onCheck} title={fiT('checkTitle')} data-filing-check>
          {fiT('stepCheck')} ({p.checkCount})
        </button>
      </li>
      {p.portalErrors > 0 && (
        <li className={filing.stepWarn} data-filing-portal-errors>
          <button type="button" className={filing.stepBtn} onClick={p.onPortalErrors}>{p.portalLabel} ({p.portalErrors})</button>
        </li>
      )}
      {downloadable.length > 0 && (
        <li className={allDownloaded ? filing.stepDone : filing.step} data-filing-download>
          <span className={filing.stepName}>{fiT('stepDownload')}</span>
          <span className={filing.stepBtns}>
            {downloadable.map((f) => (
              <button key={f} type="button" className={filing.stepBtn} disabled={!p.canDownload} title={!p.canDownload ? p.needGstinTitle?.[f] : downloadedOn(f) ? c6T('downloadedOn', { date: formatDate(downloadedOn(f).slice(0, 10)) }) : undefined}
                onClick={() => p.onDownload(f)} data-downloaded={downloadedOn(f) ? 'yes' : undefined}>
                {downloadedOn(f) ? <CheckCircle2 size={14} aria-hidden /> : null} {FORM_TEXT[f]}
              </button>
            ))}
          </span>
        </li>
      )}
      <li className={forms.length > 0 && forms.every(isFiled) ? filing.stepDone : filing.step}>
        <span className={filing.stepName}>{fiT('stepFiled')}</span>
        <span className={filing.stepBtns}>
          {forms.length === 0 && <span className={filing.stepSub}>{fiT('markFyHint')}</span>}
          {forms.map((f) => (
            <button key={f} type="button" className={filing.stepBtn} aria-pressed={isFiled(f)} disabled={!marked}
              title={marked ? fiT('markHint') : fiT('markFyHint')} onClick={() => toggleFiled(f)} data-filing-mark={f}>
              {isFiled(f) ? <CheckCircle2 size={14} aria-hidden /> : null} {f === 'GSTR1' ? fiT('markG1') : f === 'GSTR3B' ? fiT('markG3') : c6T('markFiled', { form: FORM_TEXT[f] })}
            </button>
          ))}
        </span>
      </li>
    </ol>
  );
}
