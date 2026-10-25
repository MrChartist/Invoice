import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { can } from '../lib/access';
import { readSharedFiles, routeShared, stashShared } from '../lib/share-inbox';
import { useT } from '../i18n';
import { phoneT } from '../i18n/areas/phone';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/pwa/PhoneBackup.module.css';

/** One read per arrival, even when a strict-mode remount runs the effect twice (the read empties the cache). */
let inflight: Promise<File[]> | null = null;
const receive = () => (inflight ??= readSharedFiles().finally(() => setTimeout(() => (inflight = null), 1000)));

/**
 * `/share-target` (8.20 / 8.23): a file shared into the installed app from the phone's share sheet.
 * The service worker kept it on the device; this page reads it once and opens the screen that handles
 * it — restore (owner only), new expense with the file attached, or bank-statement import.
 */
export function ShareTarget() {
  useT();
  const navigate = useNavigate();
  const [message, setMessage] = useState(phoneT('inboxReading'));

  useEffect(() => {
    let live = true;
    void receive().then((files) => {
      if (!live) return;
      const route = routeShared(files);
      if (!route) {
        setMessage(files[0] ? phoneT('inboxUnknown', { file: files[0].name }) : phoneT('inboxNone'));
        return;
      }
      if (route.kind === 'backup') {
        if (!can('data.restore')) return setMessage(phoneT('inboxOwner'));
        stashShared('backup', files.slice(0, 1));
        navigate('/settings?tab=security&restore=shared', { replace: true });
        return;
      }
      if (!can('books.edit')) return setMessage(phoneT('inboxDenied'));
      if (route.kind === 'receipt') {
        stashShared('receipt', files.filter((f) => /^(image\/|application\/pdf)/.test(f.type) || /\.(pdf|jpe?g|png|webp|gif)$/i.test(f.name)));
        navigate('/expenses?new=expense&shared=1', { replace: true });
      } else {
        stashShared('statement', files.slice(0, 1));
        navigate('/reconcile?tab=import', { replace: true });
      }
    });
    return () => {
      live = false;
    };
  }, [navigate]);

  return (
    <div className={surface.page}>
      <section className={`${surface.card} ${styles.page}`} aria-live="polite">
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}><FileUp size={16} aria-hidden="true" /> {phoneT('inboxTitle')}</span>
        </div>
        <div className={`${surface.cardBody} ${styles.stack}`}>
          <p className={styles.note} data-share-inbox>{message}</p>
          <Link to="/" className={controls.btnOutline}>{phoneT('inboxHome')}</Link>
        </div>
      </section>
    </div>
  );
}
