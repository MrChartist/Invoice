import styles from '../invoice-paper.module.css';

/**
 * "ORIGINAL FOR RECIPIENT" / "DUPLICATE FOR TRANSPORTER" … (CGST Rule 48, P0-9), printed at the top
 * of every layout when the print job has more than the legacy single paper. Coloured only through
 * the template's accent variable; renders nothing for an empty label.
 */
export function CopyBanner({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <div className={styles.copyBanner} data-copy-banner>
      <span>({label})</span>
    </div>
  );
}
