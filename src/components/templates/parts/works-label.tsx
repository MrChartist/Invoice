import type { CnPaperKey as CnKey } from '../../../i18n/areas/construction-r11-paper';
import { pe, ph } from './works-text';
import styles from './works-paper.module.css';

/** A paper label: English, plus the Hindi line on bilingual paper. */
export function PL({ k, vars, bi }: { k: CnKey; vars?: Record<string, string | number>; bi: boolean }) {
  return (
    <>
      {pe(k, vars)}
      {bi && <span className={styles.hi} lang="hi">{ph(k, vars)}</span>}
    </>
  );
}
