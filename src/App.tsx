import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFound } from './components/layout/NotFound';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { InvoiceCreator } from './pages/InvoiceCreator';
import { LoginPage } from './pages/LoginPage';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { IdleLock } from './components/security/IdleLock';
import { isAuthenticated } from './lib/auth';

// Heavier report/ledger pages load on first visit so the editor opens fast.
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

  return (
    <ErrorBoundary>
      {authed ? (
        <BrowserRouter>
          <IdleLock onLock={() => setAuthed(false)} />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<DashboardLayout onLogout={() => setAuthed(false)} />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/invoice" element={<InvoiceCreator />} />
                <Route path="/invoice/:id" element={<InvoiceCreator />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/recurring" element={<Recurring />} />
                <Route path="/receivables" element={<Receivables />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/books" element={<Books />} />
                <Route path="/reconcile" element={<Reconcile />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/gst-reports" element={<GstReports />} />
                <Route path="/exports" element={<Exports />} />
                <Route path="/design" element={<DesignStudio />} />
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
