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
