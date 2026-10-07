import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, LayoutDashboard } from 'lucide-react';
import styles from './NotFound.module.css';

/** Catch-all inside the app shell: tells the user the page is missing instead of silently redirecting. */
export function NotFound() {
  const { pathname } = useLocation();
  useEffect(() => {
    const prev = document.title;
    document.title = 'Page not found — Mr. Chartist Invoice';
    return () => {
      document.title = prev;
    };
  }, []);
  return (
    <section className={styles.wrap} aria-labelledby="nf-title">
      <div className={styles.icon} aria-hidden="true">
        <Compass size={28} />
      </div>
      <h1 id="nf-title" className={styles.title}>
        We can&apos;t find that page
      </h1>
      <p className={styles.text}>
        Nothing lives at <code>{pathname}</code>. It may have moved, or the link is mistyped.
      </p>
      <Link to="/" className={styles.btn}>
        <LayoutDashboard size={16} aria-hidden="true" /> Back to dashboard
      </Link>
    </section>
  );
}
