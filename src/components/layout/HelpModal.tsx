import { ExternalLink, FileText, Keyboard, Shield, TrendingUp } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { LogoMark } from '../brand/Logo';
import styles from './HelpModal.module.css';

const FEATURES = [
  {
    icon: Shield,
    title: 'Private by design',
    text: 'Everything is stored in this browser. No server, no tracking, no network calls.',
  },
  {
    icon: FileText,
    title: 'GST-ready documents',
    text: 'GSTIN checks, HSN/SAC, CGST + SGST or IGST by place of supply, amount in words.',
  },
  {
    icon: TrendingUp,
    title: 'Indian FY numbering',
    text: 'Numbers run per financial year (1 Apr – 31 Mar), e.g. INV/FY25-26/0001.',
  },
];

const SHORTCUTS = [
  ['Ctrl / ⌘ + S', 'Save the invoice'],
  ['Ctrl / ⌘ + P', 'Open the preview'],
  ['Esc', 'Close a dialog'],
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Help & about" size="md">
      <div className={styles.hero}>
        <LogoMark size={52} tile />
        <div>
          <h3 className={styles.name}>Mr. Chartist Invoice</h3>
          <p className={styles.version}>Version 3.0 · Offline-first</p>
        </div>
      </div>

      <ul className={styles.features}>
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className={styles.feature}>
            <span className={styles.featureIcon}>
              <Icon size={16} />
            </span>
            <div>
              <div className={styles.featureTitle}>{title}</div>
              <div className={styles.featureText}>{text}</div>
            </div>
          </li>
        ))}
      </ul>

      <div>
        <div className={styles.sectionLabel}>
          <Keyboard size={13} /> Shortcuts
        </div>
        <dl className={styles.shortcuts}>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className={styles.shortcut}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={styles.footer}>
        <p className={styles.tagline}>Built with conviction. For traders, by a trader.</p>
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
            Source on GitHub <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </Modal>
  );
}
