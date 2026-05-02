import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { InvoiceCreator } from './pages/InvoiceCreator';
import { Clients } from './pages/Clients';
import { Settings } from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout><Dashboard /></DashboardLayout>} />
        <Route path="/invoice" element={<DashboardLayout><InvoiceCreator /></DashboardLayout>} />
        <Route path="/invoice/:id" element={<DashboardLayout><InvoiceCreator /></DashboardLayout>} />
        <Route path="/transactions" element={<DashboardLayout><Transactions /></DashboardLayout>} />
        <Route path="/clients" element={<DashboardLayout><Clients /></DashboardLayout>} />
        <Route path="/settings" element={<DashboardLayout><Settings /></DashboardLayout>} />
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
