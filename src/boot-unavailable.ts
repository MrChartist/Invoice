/** Shown instead of the app when this device's data is in IndexedDB and IndexedDB will not open. */
export function showUnavailable(reason: string, opts: { vaultDamaged?: boolean } = {}): void {
  const root = document.getElementById('root');
  if (!root) return;
  const box = document.createElement('main');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:32rem;margin:15vh auto;padding:0 16px;font-family:var(--font-body, "Chartist Sans Flex", system-ui, sans-serif)';
  const h = document.createElement('h1');
  h.textContent = 'Your data could not be opened';
  h.style.fontSize = '1.25rem';
  const p = document.createElement('p');
  p.textContent = opts.vaultDamaged
    ? 'The data on this device is encrypted (vault mode), but the record needed to decrypt it is damaged or missing. ' +
      'Nothing has been changed or deleted. If you cannot fix it, erase this device and restore a backup.'
    : 'This browser keeps your invoices in its database (IndexedDB), which is not available right now. ' +
      'Private windows and some browser settings block it. Close other tabs of this app and try again; nothing has been deleted.';
  const detail = document.createElement('p');
  detail.textContent = reason;
  detail.style.cssText = 'opacity:.7;font-size:.85rem';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.onclick = () => window.location.reload();
  box.append(h, p, detail, retry);
  if (opts.vaultDamaged) {
    // Without an intact vault record the encrypted data can never be opened: offer a fresh start.
    const erase = document.createElement('button');
    erase.type = 'button';
    erase.textContent = 'Erase this device…';
    erase.style.marginLeft = '0.5rem';
    erase.onclick = () => {
      const typed = window.prompt('The encrypted data on this device cannot be opened without its vault record. Type ERASE to delete everything this app stored here (then restore a backup).');
      if (typed !== 'ERASE') return;
      void import('./lib/storage').then((m) => m.eraseLockedDevice()).finally(() => window.location.reload());
    };
    box.append(erase);
  }
  root.replaceChildren(box);
}

