import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFound } from './components/layout/NotFound';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { IdleLock } from './components/security/IdleLock';
import { RequireAccess } from './components/security/RequireAccess';
import { isAuthenticated, onRemoteLock } from './lib/auth';

// Heavier report/ledger pages load on first visit so the editor opens fast.
// The editor is code-split too, then prefetched once the first screen is idle (see App).
const loadCreator = () => import('./pages/InvoiceCreator');
const InvoiceCreator = lazy(() => loadCreator().then((m) => ({ default: m.InvoiceCreator })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Reconcile = lazy(() => import('./pages/Reconcile').then((m) => ({ default: m.Reconcile })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Expenses = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.Expenses })));
const Receivables = lazy(() => import('./pages/Receivables').then((m) => ({ default: m.Receivables })));
const Books = lazy(() => import('./pages/Books').then((m) => ({ default: m.Books })));
const GstReports = lazy(() => import('./pages/GstReports').then((m) => ({ default: m.GstReports })));
const Exports = lazy(() => import('./pages/Exports').then((m) => ({ default: m.Exports })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const Recurring = lazy(() => import('./pages/Recurring').then((m) => ({ default: m.Recurring })));
const Time = lazy(() => import('./pages/Time').then((m) => ({ default: m.Time })));
const Cheques = lazy(() => import('./pages/Cheques').then((m) => ({ default: m.Cheques })));
const Tds = lazy(() => import('./pages/Tds').then((m) => ({ default: m.Tds })));
const Pos = lazy(() => import('./pages/Pos').then((m) => ({ default: m.Pos })));
const Gateway = lazy(() => import('./pages/Gateway').then((m) => ({ default: m.Gateway })));
const DesignStudio = lazy(() => import('./components/design/DesignStudio').then((m) => ({ default: m.DesignStudio })));

function PageFallback() {
  return (
    <div role="status" aria-live="polite" style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
      Loading…
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  // Locking in one tab locks them all.
  useEffect(() => onRemoteLock(() => setAuthed(false)), []);
  // Warm the editor chunk after first paint so "New invoice" still opens instantly.
  useEffect(() => {
    if (!authed) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const t = idle ? idle(() => void loadCreator()) : window.setTimeout(() => void loadCreator(), 1500);
    return () => {
      if (!idle) window.clearTimeout(t);
    };
  }, [authed]);

  return (
    <ErrorBoundary>
      {authed ? (
        <BrowserRouter>
          <IdleLock onLock={() => setAuthed(false)} />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<DashboardLayout onLogout={() => setAuthed(false)} />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/invoice" element={<RequireAccess action="doc.create" fallback="/transactions"><InvoiceCreator /></RequireAccess>} />
                <Route path="/invoice/:id" element={<RequireAccess action="doc.edit" fallback="/transactions"><InvoiceCreator /></RequireAccess>} />
                <Route path="/pos" element={<RequireAccess action="doc.create" fallback="/transactions"><Pos /></RequireAccess>} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/recurring" element={<RequireAccess action="books.edit"><Recurring /></RequireAccess>} />
                <Route path="/time" element={<RequireAccess action="books.edit"><Time /></RequireAccess>} />
                <Route path="/receivables" element={<Receivables />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/books" element={<Books />} />
                <Route path="/reconcile" element={<RequireAccess action="books.edit"><Reconcile /></RequireAccess>} />
                <Route path="/cheques" element={<RequireAccess action="books.edit"><Cheques /></RequireAccess>} />
                <Route path="/tds" element={<Tds />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/gst-reports" element={<GstReports />} />
                <Route path="/exports" element={<Exports />} />
                <Route path="/gateway/*" element={<Gateway />} />
                <Route path="/design" element={<RequireAccess action="settings.manage"><DesignStudio /></RequireAccess>} />
                {/* Settings opens for every role and shows each role only the tabs it may use (6.21). */}
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      ) : (
        <LoginPage onSuccess={() => setAuthed(true)} />
      )}
    </ErrorBoundary>
  );
}

export default App;
