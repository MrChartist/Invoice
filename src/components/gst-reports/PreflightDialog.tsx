/**
 * 8I (8.161): the check before a GSTR-1 / GSTR-3B / IFF JSON download (lazy). Lists the grouped problems from
 * `buildPreflight` with Fix links; "Download anyway" continues, "Review" opens the GST guards tab. Working paper —
 * verify with your CA.
 */
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { PreflightGroup } from '../../lib/gst-preflight';
import { useT } from '../../i18n';
import { fiT } from '../../i18n/areas/filing';
import controls from '../../styles/controls.module.css';
import css from './filing.module.css';

const SHOWN = 6;

type GroupKey = Parameters<typeof fiT>[0];

function preflightTitle(g: PreflightGroup): string {
  if (g.source === 'gap') return fiT('g_gaps', g.vars);
  if (g.source === 'exception') return fiT(`g_${g.code}` as GroupKey, g.vars);
  return g.count > 1 ? fiT('g_issueMany', { message: String(g.vars.message ?? ''), more: g.count - 1 }) : String(g.vars.message ?? g.code);
}

export interface PreflightDialogProps {
  /** Form being downloaded ("GSTR-1"); null = review only (no download button). */
  form: string | null;
  groups: readonly PreflightGroup[];
  onClose: () => void;
  onDownload?: () => void;
  onReview: () => void;
}

export default function PreflightDialog({ form, groups, onClose, onDownload, onReview }: PreflightDialogProps) {
  useT();
  const footer = (
    <>
      <button type="button" className={controls.btnOutline} onClick={groups.length ? onReview : onClose}>
        {groups.length ? fiT('pfReview') : fiT('pfClose')}
      </button>
      {form && onDownload && (
        <button type="button" className={controls.btnPrimary} onClick={onDownload} data-preflight-download>
          {groups.length ? fiT('pfDownload') : form}
        </button>
      )}
    </>
  );
  return (
    <Modal open onClose={onClose} title={form ? fiT('pfTitle', { form }) : fiT('pfReviewTitle')} size="lg" footer={footer}>
      <div className={css.pf} data-preflight>
        {groups.length === 0 ? (
          <p className={css.pfClean}><CheckCircle2 size={16} aria-hidden /> {fiT('pfClean')}</p>
        ) : (
          <>
            <p className={css.pfIntro}>{fiT('pfIntro')}</p>
            <ul className={css.pfGroups}>
              {groups.map((g) => {
                const Icon = g.severity === 'error' ? AlertOctagon : AlertTriangle;
                return (
                  <li key={g.id} className={g.severity === 'error' ? css.pfGroupErr : css.pfGroup} data-preflight-group={g.id}>
                    <div className={css.pfHead}>
                      <Icon size={15} aria-label={g.severity === 'error' ? fiT('pfError') : fiT('pfWarning')} className={g.severity === 'error' ? css.toneErr : css.toneWarn} />
                      <strong>{preflightTitle(g)}</strong>
                    </div>
                    <ul className={css.pfItems}>
                      {g.items.slice(0, SHOWN).map((it) => (
                        <li key={it.key}>
                          <span className={css.pfLabel} title={it.detail}>{it.label}</span>
                          {g.source !== 'issue' && it.detail ? <span className={css.pfDetail}>{it.detail}</span> : null}
                          {it.link && (
                            <Link to={it.link} className={css.pfFix} onClick={onClose} aria-label={`${fiT('pfFix')}: ${it.label}`}>
                              {fiT('pfFix')}
                            </Link>
                          )}
                        </li>
                      ))}
                      {g.items.length > SHOWN && <li className={css.pfDetail}>{fiT('pfMore', { n: g.items.length - SHOWN })}</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className={css.pfCa} role="note"><ShieldAlert size={15} aria-hidden /> {fiT('pfCa')}</p>
      </div>
    </Modal>
  );
}
