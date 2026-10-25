import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFound } from './components/layout/NotFound';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { IdleLock } from './components/security/IdleLock';
import { RequireAccess } from './components/security/RequireAccess';
import { getCurrentUser, isAuthenticated, onAuthChange, onRemoteLock } from './lib/auth';

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
const Pos = lazy(() => import('./pages/Pos').then((m) => ({ default: m.Pos })));
const DesignStudio = lazy(() => import('./components/design/DesignStudio').then((m) => ({ default: m.DesignStudio })));

function PageFallback() {
  return (
    <div role="status" aria-live="polite" style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
      Loading…
    </div>
  );
}

/** Who is signed in and with which role: a change remounts the shell so every screen re-reads it. */
const actorSignature = () => {
  const u = getCurrentUser();
  return u ? `${u.id}:${u.role}` : '';
};

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [shellKey, setShellKey] = useState(0);
  const signature = useRef('');
  // Locking in one tab locks them all.
  useEffect(() => onRemoteLock(() => setAuthed(false)), []);
  // Roles (6.21): the session is re-checked whenever it may have changed in another tab (user removed,
  // role changed, PIN reset, owner credential replaced), on focus and on the idle-lock tick. A user who
  // no longer exists is locked out; a changed role remounts the shell with the new permissions.
  useEffect(() => {
    signature.current = authed ? actorSignature() : '';
  }, [authed]);
  useEffect(() => {
    const check = () => {
      if (!isAuthenticated()) {
        setAuthed(false);
        return;
      }
      const next = actorSignature();
      if (signature.current && next !== signature.current) setShellKey((k) => k + 1);
      signature.current = next;
    };
    return onAuthChange(check);
  }, []);
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
        <BrowserRouter key={shellKey}>
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
                <Route path="/reports" element={<Reports />} />
                <Route path="/gst-reports" element={<GstReports />} />
                <Route path="/exports" element={<Exports />} />
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
