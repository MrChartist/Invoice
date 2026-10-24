/** Shown instead of the app when this device's data is in IndexedDB and IndexedDB will not open. */
export function showUnavailable(reason: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  const box = document.createElement('main');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:32rem;margin:15vh auto;padding:0 16px;font-family:system-ui,sans-serif';
  const h = document.createElement('h1');
  h.textContent = 'Your data could not be opened';
  h.style.fontSize = '1.25rem';
  const p = document.createElement('p');
  p.textContent =
    'This browser keeps your invoices in its database (IndexedDB), which is not available right now. ' +
    'Private windows and some browser settings block it. Close other tabs of this app and try again; nothing has been deleted.';
  const detail = document.createElement('p');
  detail.textContent = reason;
  detail.style.cssText = 'opacity:.7;font-size:.85rem';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.onclick = () => window.location.reload();
  box.append(h, p, detail, retry);
  root.replaceChildren(box);
}

