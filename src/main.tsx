import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import { runMigrations } from './lib/migrations';
import { initCrossTab } from './lib/cross-tab';
import { initStorage } from './lib/storage';
import { initI18n } from './i18n';
import './fonts.css';
import './index.css';

function start(root: Root): void {
  // Bring stored data up to the current schema before anything reads it.
  const migration = runMigrations();
  if (migration.status === 'failed') console.error('Data migration failed; using the previous data shape.', migration);
  else if (migration.status === 'newer') console.warn('This data was saved by a newer version of the app.', migration);

  initCrossTab();

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Production only: caches the app shell so the tool works fully offline.
  void registerServiceWorker();
}

// Load the data into the IndexedDB-backed cache (moving it out of localStorage on first run)
// before anything renders; until then the page shows only its background. Typically a few ms.
// The saved interface language (5.4) loads in parallel, so even the PIN / vault screens open translated.
void Promise.all([initStorage(), initI18n()]).then(([init]) => {
  if (init.backend === 'unavailable') {
    void import('./boot-unavailable').then((m) => m.showUnavailable(init.reason, { vaultDamaged: init.vaultDamaged }));
    return;
  }
  const root = createRoot(document.getElementById('root')!);
  if (init.backend === 'locked') {
    // Vault mode: nothing may read the store until the passphrase has decrypted it.
    void import('./components/vault/VaultUnlock').then(({ VaultUnlock }) => {
      root.render(<VaultUnlock onUnlocked={() => start(root)} />);
    });
    return;
  }
  start(root);
});
