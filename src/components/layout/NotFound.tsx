import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, LayoutDashboard } from 'lucide-react';
import { tNodes, useT } from '../../i18n';
import { Page } from '../ui/Page';
import styles from './NotFound.module.css';
import controls from '../../styles/controls.module.css';

/** Catch-all inside the app shell: tells the user the page is missing instead of silently redirecting. */
export function NotFound() {
  const { pathname } = useLocation();
  const { t } = useT();
  const docTitle = t('notFound.docTitle');
  useEffect(() => {
    const prev = document.title;
    document.title = docTitle;
    return () => {
      document.title = prev;
    };
  }, [docTitle]);
  return (
    <Page>
      <section className={styles.wrap} aria-labelledby="nf-title">
        <div className={styles.icon} aria-hidden="true">
          <Compass size={28} />
        </div>
        <h1 id="nf-title" className={styles.title}>
          {t('notFound.title')}
        </h1>
        <p className={styles.text}>{tNodes('notFound.text', { path: <code>{pathname}</code> })}</p>
        <Link to="/" className={`${controls.btnPrimary} ${styles.cta}`}>
          <LayoutDashboard size={16} aria-hidden="true" /> {t('notFound.back')}
        </Link>
      </section>
    </Page>
  );
}
