import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { InvoiceCreator } from './pages/InvoiceCreator';
import { Clients } from './pages/Clients';
import { Settings } from './pages/Settings';
import { LoginPage } from './pages/LoginPage';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { isAuthenticated } from './lib/auth';

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());

  return (
    <ErrorBoundary>
      {authed ? (
        <BrowserRouter>
          <Routes>
            <Route element={<DashboardLayout onLogout={() => setAuthed(false)} />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/invoice" element={<InvoiceCreator />} />
              <Route path="/invoice/:id" element={<InvoiceCreator />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <LoginPage onSuccess={() => setAuthed(true)} />
      )}
    </ErrorBoundary>
  );
}

export default App;
