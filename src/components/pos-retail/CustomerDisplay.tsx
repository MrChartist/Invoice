import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { openBroadcast } from '../../lib/cross-tab';
import { DISPLAY_CHANNEL, readDisplayMessage, type DisplayMessage } from '../../lib/pos-display';
import { readServing } from '../../lib/pos-serving';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import styles from './retail.module.css';

/**
 * `/pos-display` (8.143): the customer-facing window. It shows only what the counter tab broadcasts
 * (BroadcastChannel, same browser); it reads no data of its own and stores nothing. On load it asks
 * the counter for the current bill.
 */
export function CustomerDisplay() {
  useT();
  const [msg, setMsg] = useState<DisplayMessage | null>(null);
  const [serving, setServing] = useState<number | null>(null); // PENDING 12: the services queue's called token
  useEffect(() => {
    const ch = openBroadcast(DISPLAY_CHANNEL);
    if (!ch) return;
    ch.onmessage = (e: MessageEvent) => {
      const s = readServing(e.data);
      if (s !== undefined) return setServing(s);
      const m = readDisplayMessage(e.data);
      if (m && m.type !== 'hello') setMsg(m);
    };
    ch.postMessage({ v: 1, type: 'hello' });
    document.title = retailT('displayTitle');
    return () => ch.close();
  }, []);

  const now = serving !== null && <p className={styles.displayServing} data-display-serving={serving}>{retailT('displayServing', { n: serving })}</p>;
  if (!msg || msg.type === 'idle' || msg.type === 'hello') {
    return (
      <main className={styles.display} data-pos-display="idle">
        {now}
        <div className={styles.displayIdle}>
          {(msg && msg.type === 'idle' && msg.business) || retailT('displayWelcome')}
          <small>{typeof BroadcastChannel === 'undefined' ? retailT('displayNoChannel') : retailT('displayWaiting')}</small>
        </div>
      </main>
    );
  }
  if (msg.type === 'thanks') {
    return (
      <main className={styles.display} data-pos-display="thanks">
        {now}
        <div className={styles.displayIdle}>
          {retailT('displayThanks')}
          <small>{retailT('displayPaid', { total: formatCurrency(msg.total) })}{msg.change > 0 ? ` · ${retailT('displayChange', { amount: formatCurrency(msg.change) })}` : ''}</small>
        </div>
      </main>
    );
  }
  return (
    <main className={cn(styles.display, msg.upi && styles.withQr)} data-pos-display="bill">
      {now}
      <header className={styles.displayHead}>{msg.business || retailT('displayWelcome')}</header>
      <section className={styles.displayLines} aria-label={retailT('displayItems')}>
        <table>
          <tbody>
            {msg.more > 0 && <tr><td colSpan={3}>{retailT('displayMore', { n: msg.more })}</td></tr>}
            {msg.lines.map((l, n) => (
              <tr key={n}>
                <td>{l.name}</td>
                <td className={styles.r}>{l.qty} {l.unit} × {formatCurrency(l.rate)}</td>
                <td>{formatCurrency(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {msg.upi && (
        <aside className={styles.displayQr} data-display-upi={msg.upi.amount.toFixed(2)}>
          <strong>{retailT('displayScan')}</strong>
          <div className={styles.qrBox}><QRCodeSVG value={msg.upi.link} size={260} level="M" marginSize={2} role="img" aria-label={retailT('displayScan')} /></div>
          <strong>{formatCurrency(msg.upi.amount)}</strong>
        </aside>
      )}
      <footer className={styles.displayTotal}>
        <span>{retailT('displayTotal', { n: msg.count })}</span>
        <span data-display-total>{formatCurrency(msg.total)}</span>
      </footer>
    </main>
  );
}
