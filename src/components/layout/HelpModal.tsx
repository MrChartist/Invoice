import { ExternalLink, FileText, Keyboard, Shield, TrendingUp } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { LogoMark } from '../brand/Logo';
import { useT } from '../../i18n';
import { setupT } from '../../i18n/areas/setup';
import styles from './HelpModal.module.css';

const FEATURES = [
  {
    icon: Shield,
    title: 'privateTitle',
    text: 'privateText',
  },
  {
    icon: FileText,
    title: 'gstTitle',
    text: 'gstText',
  },
  {
    icon: TrendingUp,
    title: 'fyTitle',
    text: 'fyText',
  },
] as const;

const SHORTCUTS = [
  ['Ctrl / ⌘ + S', 'scSave'],
  ['Ctrl / ⌘ + P', 'scPreview'],
  ['Esc', 'scClose'],
] as const;

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal open={open} onClose={onClose} title={setupT('helpTitle')} size="md">
      <div className={styles.hero}>
        <LogoMark size={52} tile />
        <div>
          <h3 className={styles.name}>Mr. Chartist Invoice</h3>
          <p className={styles.version}>{setupT('version')}</p>
        </div>
      </div>

      <ul className={styles.features}>
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className={styles.feature}>
            <span className={styles.featureIcon}>
              <Icon size={16} />
            </span>
            <div>
              <div className={styles.featureTitle}>{setupT(title)}</div>
              <div className={styles.featureText}>{setupT(text)}</div>
            </div>
          </li>
        ))}
      </ul>

      <div>
        <div className={styles.sectionLabel}>
          <Keyboard size={13} /> {setupT('shortcuts')}
        </div>
        <dl className={styles.shortcuts}>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className={styles.shortcut}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{setupT(what)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={styles.footer}>
        <p className={styles.tagline}>{setupT('tagline')}</p>
        <p className={styles.legal}>
          Mr. Chartist · SEBI Registered Research Analyst · INH000015297. Registration granted by SEBI and
          certification from NISM in no way guarantee performance of the intermediary or provide any assurance of
          returns to investors.
        </p>
        <div className={styles.links}>
          <a href="https://mrchartist.com" target="_blank" rel="noopener noreferrer">
            mrchartist.com <ExternalLink size={12} />
          </a>
          <a href="https://github.com/MrChartist/Invoice" target="_blank" rel="noopener noreferrer">
            {setupT('source')} <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </Modal>
  );
}
