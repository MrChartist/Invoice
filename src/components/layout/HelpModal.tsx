/**
 * Help & about (R6-A2): "On this screen" first (the topic of the current route + tab from the screen-help registry,
 * with the "Verify with your CA" box on statutory screens), then a search over every topic, then links to the
 * shortcuts, What's new, the beta guide, the setup checklist and Report a problem. The legal footer stays.
 * `topic` opens a given topic instead of the current screen's (R6-B's `openHelp(topic)`, the About strips' "More").
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, History, Keyboard, ListChecks, MessageSquare } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { LogoMark } from '../brand/Logo';
import { useT } from '../../i18n';
import { setupT } from '../../i18n/areas/setup';
import { helpT } from '../../i18n/areas/help-r6';
import { APP_VERSION } from '../../lib/app-version';
import { topicById, topicKey } from '../../lib/help/registry';
import { takeHelpTopic } from '../../lib/help-event';
import type { HelpTopic } from '../../lib/help/types';
import { ScreenHelp } from '../help/ScreenHelp';
import { topicTitle } from '../help/labels';
import { HelpSearch } from '../help/HelpSearch';
import { setStrips, stripsOn } from '../../lib/help/strips';
import controls from '../../styles/controls.module.css';
import styles from './HelpModal.module.css';
import help from '../help/help.module.css';

// Each sub-view is its own chunk, loaded when opened.
const ReportProblemDialog = lazy(() => import('./ReportProblemDialog'));
const ShortcutsOverlay = lazy(() => import('../command/ShortcutsOverlay').then((m) => ({ default: m.ShortcutsOverlay })));
const WhatsNew = lazy(() => import('../help/WhatsNew'));
const BetaGuide = lazy(() => import('../help/BetaGuide'));
const SetupChecklistPanel = lazy(() => import('../help/SetupChecklistPanel'));

export type View = 'main' | 'whatsnew' | 'guide' | 'setup';

const KEYS = [
  ['Ctrl / ⌘ + K', 'keyPalette'],
  ['F1', 'keyHelp'],
  ['?', 'keyShortcuts'],
] as const;
const SHORTCUTS = [
  ['Ctrl / ⌘ + S', 'scSave'],
  ['Ctrl / ⌘ + P', 'scPreview'],
  ['Esc', 'scClose'],
] as const;

/** The topic `openHelp(topic)` asked for, kept until the dialog closes (survives a StrictMode effect re-run). */
let askedTopic: string | undefined;

export function HelpModal({ open, onClose, topic: topicId, view: initialView }: { open: boolean; onClose: () => void; topic?: string; view?: Exclude<View, 'main'> }) {
  useT(); // re-render on a language switch (5.4)
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [reporting, setReporting] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [view, setView] = useState<View>(initialView ?? 'main');
  const [picked, setPicked] = useState<HelpTopic | null>(null);
  // `req` is the screen key the load was started for; `key` the topic shown (an asked topic can differ from it).
  const [state, setState] = useState<{ req: string; key: string; topic: HelpTopic | null } | null>(null);
  const [strips, setStripsOn] = useState(stripsOn);
  const req = topicId || topicKey(pathname, search);

  useEffect(() => {
    if (!open) return;
    // R6-B2: a topic asked through `openHelp(topic)` (empty states' "Learn more", Ctrl+K "Help topics"), read once on
    // open; an explicit `topic` prop still wins.
    askedTopic = takeHelpTopic() ?? askedTopic;
    const key = topicId || askedTopic || req;
    let alive = true;
    topicById(key).then((topic) => alive && setState({ req, key, topic }), () => alive && setState({ req, key, topic: null }));
    return () => {
      alive = false;
    };
  }, [open, req, topicId]);

  const close = () => {
    setView('main');
    setState(null);
    askedTopic = undefined;
    setPicked(null);
    onClose();
  };
  const go = (href: string) => {
    close();
    navigate(href);
  };
  const loaded = state?.req === req ? state : null;
  const key = loaded?.key ?? req;
  const current = loaded?.topic ?? null;
  const statutory = /^(gst-reports|tds|payroll)\b/.test(key);

  const LINKS = [
    { id: 'shortcuts', icon: Keyboard, title: helpT('shortcuts'), hint: helpT('shortcutsHint'), run: () => { setShortcuts(true); close(); } },
    { id: 'whatsnew', icon: History, title: helpT('whatsNew'), hint: helpT('whatsNewHint'), run: () => setView('whatsnew') },
    { id: 'guide', icon: BookOpen, title: helpT('betaGuide'), hint: helpT('betaGuideHint'), run: () => setView('guide') },
    { id: 'setup', icon: ListChecks, title: helpT('setup'), hint: helpT('setupHint'), run: () => setView('setup') },
    { id: 'report', icon: MessageSquare, title: helpT('report'), hint: helpT('reportHint'), run: () => { setReporting(true); close(); } },
  ] as const;

  const sub = view === 'main' ? null : view === 'whatsnew' ? helpT('whatsNew') : view === 'guide' ? helpT('betaGuide') : helpT('setup');

  return (
    <>
      <Modal open={open} onClose={close} title={sub ?? setupT('helpTitle')} size="md">
        {sub ? (
          <div className={help.stack}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ justifySelf: 'start' }} onClick={() => setView('main')}>← {helpT('back')}</button>
            <Suspense fallback={<p className={help.muted}>{helpT('loading')}</p>}>
              {view === 'whatsnew' && <WhatsNew onNavigate={go} />}
              {view === 'guide' && <BetaGuide onNavigate={go} onReport={() => { setReporting(true); close(); }} />}
              {view === 'setup' && <SetupChecklistPanel onNavigate={go} />}
            </Suspense>
          </div>
        ) : (
          <div className={help.stack}>
            {picked ? (
              <>
                <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ justifySelf: 'start' }} onClick={() => setPicked(null)}>← {helpT('back')}</button>
                <ScreenHelp topic={picked} onNavigate={go} heading={topicTitle(picked)} />
              </>
            ) : (
              <ScreenHelp topic={current} loading={!loaded} onNavigate={go} />
            )}
            {statutory && !strips && (
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ justifySelf: 'start' }} onClick={() => { setStrips(true); setStripsOn(true); }}>
                {helpT('aboutShow')}
              </button>
            )}

            <HelpSearch onPick={setPicked} />

            <div>
              <div className={styles.sectionLabel}>{helpT('more')}</div>
              <ul className={help.links}>
                {LINKS.map(({ id, icon: Icon, title, hint, run }) => (
                  <li key={id}>
                    <button type="button" className={help.linkBtn} onClick={run} data-help-link={id} {...(id === 'report' ? { 'data-report-problem-open': true } : {})}>
                      <span className={styles.featureIcon}><Icon size={16} aria-hidden="true" /></span>
                      <span>
                        <span className={help.linkTitle}>{title}</span>
                        <span className={help.linkHint}>{hint}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className={styles.sectionLabel}>
                <Keyboard size={13} /> {helpT('keysTitle')}
              </div>
              <dl className={styles.shortcuts}>
                {KEYS.map(([keys, what]) => (
                  <div key={keys} className={styles.shortcut}>
                    <dt><kbd>{keys}</kbd></dt>
                    <dd>{helpT(what)}</dd>
                  </div>
                ))}
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={keys} className={styles.shortcut}>
                    <dt><kbd>{keys}</kbd></dt>
                    <dd>{setupT(what)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className={styles.footer}>
              <div className={styles.hero}>
                <LogoMark size={40} tile />
                <div>
                  <h3 className={styles.name}>Mr. Chartist Invoice</h3>
                  <p className={styles.version} data-app-version>{setupT('version', { v: APP_VERSION })}</p>
                </div>
              </div>
              <p className={styles.tagline}>{setupT('tagline')}</p>
              <p className={styles.legal}>
                Mr. Chartist · SEBI Registered Research Analyst · INH000015297. Registration granted by SEBI and
                certification from NISM in no way guarantee performance of the intermediary or provide any assurance of
                returns to investors.
              </p>
              <p className={styles.legal} data-type-credit>{helpT('typeCredit')}</p>
              <div className={styles.links}>
                <a href="https://mrchartist.com" target="_blank" rel="noopener noreferrer">
                  mrchartist.com <ExternalLink size={12} />
                </a>
                <a href="https://github.com/MrChartist/Invoice" target="_blank" rel="noopener noreferrer">
                  {setupT('source')} <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>
        )}
      </Modal>
      {reporting && (
        <Suspense fallback={null}>
          <ReportProblemDialog onClose={() => setReporting(false)} area={current ? topicTitle(current) : ''} />
        </Suspense>
      )}
      {shortcuts && (
        <Suspense fallback={null}>
          <ShortcutsOverlay open onClose={() => setShortcuts(false)} />
        </Suspense>
      )}
    </>
  );
}
