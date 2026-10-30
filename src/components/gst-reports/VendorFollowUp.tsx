import { useMemo, useState } from 'react';
import { ArrowRightCircle, Mail, MessageCircle, Printer, Send } from 'lucide-react';
import type { ItcEffect, MatchResult } from '../../lib/gstr2b';
import {
  followUpHtml,
  followUpId,
  followUpText,
  followUps,
  loadFollowUps,
  markFollowUp,
  pushItc,
  pushedItc,
  type FollowUp,
  type FollowUpChannel,
  type FollowUpWords,
} from '../../lib/gst-followup';
import { vendorsDb } from '../../lib/vendors';
import { localDb } from '../../lib/localDb';
import { mailtoLink, whatsappLink } from '../../lib/share';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import { Money } from './DataTable';
import { useT } from '../../i18n';
import { ggT } from '../../i18n/areas/gst-guards';
import controls from '../../styles/controls.module.css';
import styles from './gst-guards.module.css';
import { printWhenReady } from '../../lib/print-fonts';
import { DateField } from '../ui/DateField';

export interface VendorFollowUpProps {
  match: MatchResult;
  effect: Pick<ItcEffect, 'books' | 'restricted' | 'atRisk' | 'per2b'>;
  /** 2B period, MMYYYY. */
  period: string;
  periodLabel: string;
  gstin: string;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const words = (): FollowUpWords => ({
  greeting: (name) => ggT('fuGreeting', { name }),
  intro: (period, gstin) => ggT('fuIntro', { period, gstin }),
  notIn2b: ggT('fuNotIn2b'),
  mismatch: ggT('fuMismatch'),
  missingInBooks: ggT('fuMissingBooks'),
  books: ggT('fuBooks'),
  in2b: ggT('fuIn2b'),
  taxable: ggT('fuTaxable'),
  tax: ggT('fuTax'),
  diffs: { taxable: ggT('dTaxable'), tax: ggT('dTax'), heads: ggT('dHeads'), date: ggT('dDate'), number: ggT('dNumber') },
  closing: ggT('fuClosing'),
});

/** 2B match → per-supplier discrepancy notes (WhatsApp / e-mail / PDF) with follow-up tracking, and "push to 3B". */
export function VendorFollowUp({ match, effect, period, periodLabel, gstin, notify }: VendorFollowUpProps) {
  useT();
  const list = useMemo(() => followUps(match), [match]);
  const [marks, setMarks] = useState(loadFollowUps);
  const [pushed, setPushed] = useState(() => pushedItc(period, gstin));
  const vendors = useMemo(() => vendorsDb.all(), []);
  const ourName = useMemo(() => localDb.settings.activeProfile()?.companyName ?? '', []);
  const today = todayIso();

  const contact = (f: FollowUp) => vendors.find((v) => (v.gstin ?? '').trim().toUpperCase() === f.ctin);
  const textOf = (f: FollowUp) => followUpText(f, periodLabel, gstin || ggT('fuOurGstin'), words(), ourName);
  const mark = (f: FollowUp, on: string | null, channel: FollowUpChannel = 'other') => {
    try {
      setMarks(markFollowUp(period, f, on, channel));
    } catch {
      notify(ggT('saveFailed'), 'error');
    }
  };
  const send = (f: FollowUp, channel: FollowUpChannel) => {
    const text = textOf(f);
    const v = contact(f);
    if (channel === 'whatsapp') window.open(whatsappLink(v?.phone, text), '_blank', 'noopener');
    else if (channel === 'email') window.location.assign(mailtoLink({ to: v?.email, subject: ggT('fuSubject', { period: periodLabel }), body: text }));
    else {
      const url = URL.createObjectURL(new Blob([followUpHtml(ggT('fuSubject', { period: periodLabel }), text)], { type: 'text/html' }));
      const w = window.open(url, '_blank');
      if (w) w.addEventListener('load', () => printWhenReady(w));
      else notify(ggT('popupBlocked'), 'error');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    mark(f, today, channel);
  };
  const push = () => {
    try {
      setPushed(pushItc(period, gstin, effect));
      notify(ggT('pushDone'));
    } catch {
      notify(ggT('saveFailed'), 'error');
    }
  };

  return (
    <div className={styles.stack} data-vendor-followup>
      <div className={styles.row}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={push}>
          <ArrowRightCircle size={14} aria-hidden /> {ggT('pushTo3b')}
        </button>
        <span className={styles.muted}>{pushed ? ggT('pushedOn', { date: formatDate(pushed.pushed_at.slice(0, 10)) }) : ggT('pushHint')}</span>
      </div>
      <section className={styles.section} aria-label={ggT('fuTitle')}>
        <h3 className={styles.head}><Send size={15} aria-hidden /> {ggT('fuTitle')}</h3>
        <p className={controls.hint} style={{ margin: 0 }}>{ggT('fuHint')}</p>
        {list.length === 0 ? (
          <p className={styles.muted}>{ggT('fuNone')}</p>
        ) : (
          list.map((f) => {
            const m = marks.find((x) => x.id === followUpId(period, f.ctin));
            const v = contact(f);
            return (
              <div key={f.ctin} className={styles.supplier}>
                <div className={styles.row}>
                  <strong>{f.name || f.ctin}</strong>
                  <span className={styles.muted}>{f.ctin}</span>
                  {f.taxAtRisk > 0 && <span className={styles.pillBad}>{ggT('fuAtRisk')} <Money value={f.taxAtRisk} /></span>}
                  <span className={m ? styles.pillOk : styles.pillWarn}>{m ? ggT('fuFollowed', { date: formatDate(m.followed_on) }) : ggT('fuNotYet')}</span>
                </div>
                <ul className={styles.list}>
                  {(['not_in_2b', 'mismatch', 'missing_in_books'] as const).map((k) => {
                    const n = f.items.filter((i) => i.kind === k).length;
                    return n ? <li key={k}>{ggT(k === 'not_in_2b' ? 'fuNotIn2b' : k === 'mismatch' ? 'fuMismatch' : 'fuMissingBooks')}: {n}</li> : null;
                  })}
                </ul>
                <div className={styles.row}>
                  <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => send(f, 'whatsapp')}>
                    <MessageCircle size={14} aria-hidden /> WhatsApp{v?.phone ? '' : ` ${ggT('fuNoPhone')}`}
                  </button>
                  <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => send(f, 'email')}>
                    <Mail size={14} aria-hidden /> {ggT('fuEmail')}{v?.email ? '' : ` ${ggT('fuNoEmail')}`}
                  </button>
                  <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => send(f, 'pdf')}>
                    <Printer size={14} aria-hidden /> PDF
                  </button>
                  <label className={controls.check} style={{ display: 'inline-flex' }}>
                    <input type="checkbox" checked={!!m} onChange={(e) => mark(f, e.target.checked ? today : null)} />
                    <span>{ggT('fuMark')}</span>
                  </label>
                  {m && (
                    <DateField className={`${controls.input} ${styles.narrow}`} value={m.followed_on} max={today} aria-label={ggT('fuOn')}
                      onChange={(e) => e.target.value && mark(f, e.target.value, m.channel)} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

export default VendorFollowUp;
