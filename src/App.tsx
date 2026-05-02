import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { InvoiceCreator } from './pages/InvoiceCreator';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout><Dashboard /></DashboardLayout>} />
        <Route path="/invoice" element={<DashboardLayout><InvoiceCreator /></DashboardLayout>} />
        <Route path="/invoice/:id" element={<DashboardLayout><InvoiceCreator /></DashboardLayout>} />
        <Route path="/transactions" element={<DashboardLayout><Transactions /></DashboardLayout>} />
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
