import { useEffect, useState } from 'react';
import { retailT } from '../i18n/areas/retail';
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
  // QA19 U4: null = the default text, translated at render (an initial state would freeze the first language).
  const [message, setMessage] = useState<string | null>(null);
  // 8E wiring: an image / PDF can be a supplier bill (e-invoice QR → draft bill) or an expense receipt.
  const [choice, setChoice] = useState<File[] | null>(null);
  const [busy, setBusy] = useState(false);

  const asExpense = (files: File[]) => {
    stashShared('receipt', files);
    navigate('/expenses?new=expense&shared=1', { replace: true });
  };
  const asBill = async (files: File[]) => {
    setBusy(true);
    setMessage(retailT('shareReading'));
    try {
      const { openCaptureFromFile } = await import('../lib/capture-browser');
      let route = '/expenses?tab=inbox';
      for (const f of files) route = (await openCaptureFromFile(f, { source: 'share' })).route;
      navigate(route, { replace: true });
    } catch (err) {
      setBusy(false);
      setMessage((err as Error).message);
    }
  };

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
        setChoice(files.filter((f) => /^(image\/|application\/pdf)/.test(f.type) || /\.(pdf|jpe?g|png|webp|gif)$/i.test(f.name)));
        setMessage(retailT('shareAsk'));
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
          <p className={styles.note} data-share-inbox>{message ?? phoneT('inboxReading')}</p>
          {choice && !busy && (
            <>
              <button type="button" className={controls.btnPrimary} onClick={() => void asBill(choice)} data-share-bill>{retailT('shareBill')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => asExpense(choice)} data-share-expense>{retailT('shareExpense')}</button>
            </>
          )}
          <Link to="/" className={controls.btnOutline}>{phoneT('inboxHome')}</Link>
        </div>
      </section>
    </div>
  );
}
