import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { InvoiceProvider } from './store/InvoiceContext';
import { initTheme } from './lib/theme';

// Apply persisted theme + accent before first paint to avoid a flash.
initTheme();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InvoiceProvider>
      <App />
    </InvoiceProvider>
  </React.StrictMode>,
);
