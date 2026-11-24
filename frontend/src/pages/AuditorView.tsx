import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { AuthUser } from "../lib/auth";
import { Layout } from "../components/Layout";

const REPORT_TABS = [
  { id: "sales-register", label: "Sales Register" },
  { id: "gst-summary", label: "GST Summary" },
  { id: "purchase-register", label: "Purchase Register" },
  { id: "stock-summary", label: "Stock Summary" },
  { id: "production", label: "Production" },
  { id: "receivables", label: "Receivables" },
] as const;

type ReportId = (typeof REPORT_TABS)[number]["id"];

interface IntegrityResult {
  healthy: boolean;
  checkedAt: string;
  checks: Array<{
    name: string;
    category: string;
    passed: boolean;
    expected: string;
    actual: string;
  }>;
}

export function AuditorView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<ReportId>("stock-summary");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [title, setTitle] = useState("");
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(false);

  const buildQuery = useCallback(
    (format: string) => {
      const params = new URLSearchParams();
      params.set("format", format);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      return params.toString();
    },
    [fromDate, toDate]
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/${activeTab}?${buildQuery("json")}`);
      setTitle(res.data.title as string);
      setRows(res.data.rows as Record<string, unknown>[]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, buildQuery]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  async function handleExport(format: "xlsx" | "csv" | "pdf") {
    const res = await api.get(`/reports/${activeTab}?${buildQuery(format)}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleVerifyIntegrity() {
    const res = await api.get("/reports/integrity-check");
    setIntegrity(res.data as IntegrityResult);
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Layout user={user} onLogout={onLogout} title="Accountant & Auditor Read-Only Portal">
      <div className="space-y-6">
        {/* Controls & Integrity Check */}
        <div className="card flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">From</label>
              <input
                type="date"
                className="input border p-1.5 text-sm"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                type="date"
                className="input border p-1.5 text-sm"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <button onClick={() => void loadReport()} className="btn-secondary text-sm">
              Apply Filter
            </button>
          </div>

          <button
            onClick={() => void handleVerifyIntegrity()}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700"
          >
            Verify System Integrity
          </button>
        </div>

        {/* Integrity Check Results */}
        {integrity && (
          <div
            className={`card border ${
              integrity.healthy
                ? "border-emerald-300 bg-emerald-50"
                : "border-red-300 bg-red-50"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base">
                System Integrity Check:{" "}
                <span className={integrity.healthy ? "text-emerald-800" : "text-red-800"}>
                  {integrity.healthy ? "HEALTHY (100% Reconciled)" : "MISMATCH DETECTED"}
                </span>
              </h3>
              <span className="text-xs text-gray-500">{integrity.checkedAt}</span>
            </div>
            <div className="space-y-1.5 text-sm">
              {integrity.checks.map((c, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-white px-3 py-2 rounded border"
                >
                  <span>{c.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      c.passed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {c.passed ? "PASS" : `FAIL (${c.expected} vs ${c.actual})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Report Tabs */}
        <div className="flex flex-wrap gap-2">
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={activeTab === t.id ? "btn-primary text-xs" : "btn-secondary text-xs"}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Report Table + Export */}
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <div className="flex gap-2">
              <button onClick={() => void handleExport("xlsx")} className="btn-secondary text-xs">
                Export Excel (.xlsx)
              </button>
              <button onClick={() => void handleExport("csv")} className="btn-secondary text-xs">
                Export CSV
              </button>
              <button onClick={() => void handleExport("pdf")} className="btn-secondary text-xs">
                Export PDF
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading report...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">No records found for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-3 py-2">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-gray-50">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2 whitespace-nowrap text-gray-800">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
