import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import { runMigrations } from './lib/migrations';
import { initCrossTab } from './lib/cross-tab';
import { initStorage } from './lib/storage';
import './fonts.css';
import './index.css';

// Load the data into the IndexedDB-backed cache (moving it out of localStorage on first run)
// before anything renders; until then the page shows only its background. Typically a few ms.
void initStorage().then((init) => {
  if (init.backend === 'unavailable') {
    void import('./boot-unavailable').then((m) => m.showUnavailable(init.reason));
    return;
  }

  // Bring stored data up to the current schema before anything reads it.
  const migration = runMigrations();
  if (migration.status === 'failed') console.error('Data migration failed; using the previous data shape.', migration);
  else if (migration.status === 'newer') console.warn('This data was saved by a newer version of the app.', migration);

  initCrossTab();

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Production only: caches the app shell so the tool works fully offline.
  void registerServiceWorker();
});
