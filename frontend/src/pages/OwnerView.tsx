import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { AuthUser } from "../lib/auth";
import { paisaToRupee } from "../lib/money";
import { Layout } from "../components/Layout";

interface OwnerSummary {
  todayOrdersCount: number;
  todayOrdersValuePaisa: number;
  stockLevels: Array<{
    itemId: string;
    name: string;
    type: string;
    unit: string;
    closingQty: string;
    isLowStock: boolean;
  }>;
  varianceAlerts: Array<{
    runId: string;
    runCode: string;
    yieldVariancePct: string;
    isYieldFlagged: boolean;
    flaggedMaterials: Array<{ itemId: string; variancePct: string }>;
  }>;
  latestCosting: {
    runCode: string;
    itemName: string;
    costPerPacketPaisa: number;
    sellingPricePaisa: number;
    marginPaisa: number;
  } | null;
  totalOutstandingPaisa: number;
}

// ─── Tiny SVG bar chart ────────────────────────────────────────────────────────
interface BarChartProps {
  bars: Array<{ label: string; value: number; color: string }>;
  formatValue?: (v: number) => string;
  title: string;
}

function MiniBarChart({ bars, formatValue, title }: BarChartProps) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const fmt = formatValue ?? ((v) => String(v));

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="space-y-3">
        {bars.map((bar) => {
          const pct = Math.max((bar.value / max) * 100, 0);
          return (
            <div key={bar.label}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span className="font-medium">{bar.label}</span>
                <span className="font-semibold">{fmt(bar.value)}</span>
              </div>
              <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: bar.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OwnerView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [data, setData] = useState<OwnerSummary | null>(null);

  useEffect(() => {
    void api.get("/reports/owner-summary").then((res) => setData(res.data as OwnerSummary));
  }, []);

  if (!data) {
    return (
      <Layout user={user} onLogout={onLogout} title="Owner Executive Dashboard">
        <p className="text-sm text-gray-500">Loading KPIs...</p>
      </Layout>
    );
  }

  // ── Inventory breakdown by type ───────────────────────────────────────────
  const typeGroups: Record<string, number> = {};
  for (const s of data.stockLevels) {
    const qty = Math.max(parseFloat(s.closingQty) || 0, 0);
    typeGroups[s.type] = (typeGroups[s.type] ?? 0) + qty;
  }

  const TYPE_COLORS: Record<string, string> = {
    RAW_MATERIAL: "#f97316",
    PACKAGING: "#3b82f6",
    FINISHED_GOOD: "#10b981",
  };
  const TYPE_LABELS: Record<string, string> = {
    RAW_MATERIAL: "Raw Materials",
    PACKAGING: "Packaging",
    FINISHED_GOOD: "Finished Goods",
  };

  const inventoryBars = Object.entries(typeGroups).map(([type, qty]) => ({
    label: TYPE_LABELS[type] ?? type,
    value: qty,
    color: TYPE_COLORS[type] ?? "#6b7280",
  }));

  return (
    <Layout user={user} onLogout={onLogout} title="Owner Executive Dashboard">
      <div className="space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card">
            <div className="text-xs font-medium text-gray-500 uppercase">Today's Orders</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{data.todayOrdersCount}</div>
            <div className="text-sm text-brand-700 font-medium mt-1">
              {paisaToRupee(data.todayOrdersValuePaisa)}
            </div>
          </div>

          <div className="card">
            <div className="text-xs font-medium text-gray-500 uppercase">Total Outstanding Dues</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">
              {paisaToRupee(data.totalOutstandingPaisa)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Across posted invoices</div>
          </div>

          <div className="card">
            <div className="text-xs font-medium text-gray-500 uppercase">
              Latest Cost / Packet
            </div>
            {data.latestCosting ? (
              <>
                <div className="text-2xl font-bold text-gray-900 mt-1">
                  {paisaToRupee(data.latestCosting.costPerPacketPaisa)}
                </div>
                <div className="text-xs text-emerald-700 font-medium mt-1">
                  SP: {paisaToRupee(data.latestCosting.sellingPricePaisa)} · Margin:{" "}
                  {paisaToRupee(data.latestCosting.marginPaisa)}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400 mt-2">No runs yet</div>
            )}
          </div>

          <div className="card">
            <div className="text-xs font-medium text-gray-500 uppercase">Variance Alerts</div>
            <div className="text-2xl font-bold text-red-700 mt-1">
              {data.varianceAlerts.length}
            </div>
            <div className="text-xs text-gray-500 mt-1">Runs with &gt; 3% variance</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Inventory / Stock Breakdown */}
          {inventoryBars.length > 0 ? (
            <MiniBarChart
              title="Inventory / Stock Breakdown (Units)"
              bars={inventoryBars}
              formatValue={(v) => `${v.toFixed(1)} units`}
            />
          ) : (
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Inventory / Stock Breakdown</h2>
              <p className="text-sm text-gray-500">No stock data available.</p>
            </div>
          )}

          {/* Chart 2: Receivables Overview */}
          <ReceivablesChart totalOutstandingPaisa={data.totalOutstandingPaisa} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Current Stock Levels */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Live Stock Levels</h2>
            <div className="divide-y divide-gray-100 text-sm">
              {data.stockLevels.map((s) => (
                <div key={s.itemId} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{s.type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {s.closingQty} {s.unit}
                    </span>
                    {s.isLowStock && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
                        LOW
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Variance Alerts */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Active Production Variance Alerts</h2>
            {data.varianceAlerts.length === 0 ? (
              <p className="text-sm text-gray-500">All production runs within ±3% tolerance.</p>
            ) : (
              <div className="space-y-2.5">
                {data.varianceAlerts.map((a) => (
                  <div key={a.runId} className="p-3 rounded border border-red-200 bg-red-50 text-sm">
                    <div className="flex justify-between font-semibold text-red-900">
                      <span>{a.runCode}</span>
                      {a.isYieldFlagged && <span>Yield: {a.yieldVariancePct}%</span>}
                    </div>
                    {a.flaggedMaterials.length > 0 && (
                      <div className="text-xs text-red-800 mt-1">
                        Flagged materials:{" "}
                        {a.flaggedMaterials
                          .map((m) => `${m.itemId} (${m.variancePct}%)`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ─── Receivables chart — fetches /payments/outstanding for real data ──────────
interface OutstandingCustomer {
  customerId: string;
  customerName: string;
  totalInvoicedPaisa: number;
  totalPaidPaisa: number;
  outstandingPaisa: number;
}

function ReceivablesChart({ totalOutstandingPaisa }: { totalOutstandingPaisa: number }) {
  const [customers, setCustomers] = useState<OutstandingCustomer[]>([]);

  useEffect(() => {
    void api
      .get("/payments/outstanding")
      .then((res) => setCustomers((res.data as { customers: OutstandingCustomer[] }).customers))
      .catch(() => setCustomers([]));
  }, []);

  const totalInvoiced = customers.reduce((s, c) => s + c.totalInvoicedPaisa, 0);
  const totalPaid = customers.reduce((s, c) => s + c.totalPaidPaisa, 0);
  const outstanding = totalOutstandingPaisa;

  const bars = [
    { label: "Total Invoiced", value: totalInvoiced, color: "#6366f1" },
    { label: "Collected", value: totalPaid, color: "#10b981" },
    { label: "Outstanding", value: outstanding, color: "#f43f5e" },
  ];

  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Receivables Overview</h2>
      <div className="space-y-3">
        {bars.map((bar) => {
          const pct = Math.max((bar.value / max) * 100, 0);
          return (
            <div key={bar.label}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span className="font-medium">{bar.label}</span>
                <span className="font-semibold">{paisaToRupee(bar.value)}</span>
              </div>
              <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: bar.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
