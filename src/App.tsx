import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { InvoiceCreator } from './pages/InvoiceCreator';
import { Clients } from './pages/Clients';
import { Settings } from './pages/Settings';
import { LoginPage } from './pages/LoginPage';
import { isAuthenticated } from './lib/auth';

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout onLogout={() => setAuthed(false)}><Dashboard /></DashboardLayout>} />
        <Route path="/invoice" element={<DashboardLayout onLogout={() => setAuthed(false)}><InvoiceCreator /></DashboardLayout>} />
        <Route path="/invoice/:id" element={<DashboardLayout onLogout={() => setAuthed(false)}><InvoiceCreator /></DashboardLayout>} />
        <Route path="/transactions" element={<DashboardLayout onLogout={() => setAuthed(false)}><Transactions /></DashboardLayout>} />
        <Route path="/clients" element={<DashboardLayout onLogout={() => setAuthed(false)}><Clients /></DashboardLayout>} />
        <Route path="/settings" element={<DashboardLayout onLogout={() => setAuthed(false)}><Settings /></DashboardLayout>} />
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
