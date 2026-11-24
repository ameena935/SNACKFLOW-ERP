import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Placeholder pages – to be implemented in future sprints
function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold text-brand-700">🥨 CrispLedger ERP</h1>
      <p className="text-gray-500 text-sm">Order-to-Audit ERP for South Indian Snack Manufacturing</p>
      <div className="card mt-6 max-w-md w-full">
        <h2 className="text-lg font-semibold mb-3">Modules</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li>📦 Inventory & Stock Ledger</li>
          <li>🛒 Purchase Management</li>
          <li>🏭 Production Runs (Two-Tier BOM)</li>
          <li>📋 Order Management</li>
          <li>🧾 GST Invoicing (CGST/SGST/IGST)</li>
          <li>💳 Payment Tracking</li>
          <li>📊 Audit Log</li>
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
