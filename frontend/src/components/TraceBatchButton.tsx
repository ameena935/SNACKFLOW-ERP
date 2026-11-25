import { useState } from "react";
import { api } from "../lib/api";
import { paisaToRupee } from "../lib/money";

interface TraceData {
  runId: string;
  traceGeneratedAt: string;
  rawMaterialPurchases: Array<{
    supplierName: string;
    supplierState: string;
    lotNo: string;
    purchaseDate: string;
    itemName: string;
    qty: string;
    unit: string;
  }>;
  batch: {
    runCode: string;
    runDate: string;
    finishedItemName: string;
    batches: string;
    expectedOutputQty: number;
    actualOutputQty: number;
    yieldVariancePct: string;
    isYieldFlagged: boolean;
    costPerPacketPaisa: number;
    consumptions: Array<{
      itemName: string;
      plannedQty: string;
      actualQty: string;
      variancePct: string;
      isFlagged: boolean;
    }>;
  };
  dispatchedCustomers: Array<{
    invoiceNumber: string;
    dispatchDate: string;
    customerName: string;
    stateCode: string;
    qty: number;
    totalPaisa: number;
    paidPaisa: number;
    outstandingPaisa: number;
    invoiceStatus: string;
  }>;
}

interface TraceBatchButtonProps {
  runId: string;
  runCode: string;
}

export function TraceBatchButton({ runId, runCode }: TraceBatchButtonProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (data) return; // already fetched
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/production-runs/${runId}/trace`);
      setData(res.data as TraceData);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to load trace data";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => void handleOpen()}
        className="text-xs px-2.5 py-1 rounded border font-medium bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100 transition-colors"
        title={`FSSAI Batch Traceability for ${runCode}`}
      >
        🔍 Trace Batch
      </button>

      {open && (
        <TraceBatchModal
          runCode={runCode}
          data={data}
          loading={loading}
          error={error}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TraceBatchModal({
  runCode,
  data,
  loading,
  error,
  onClose,
}: {
  runCode: string;
  data: TraceData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full my-6">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-bold text-gray-900 text-base">
              🔍 FSSAI Batch Traceability
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Run: {runCode}</p>
          </div>
          <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">
            Close
          </button>
        </div>

        <div className="p-5">
          {loading && (
            <div className="text-center py-10 text-sm text-gray-500">
              Loading trace data...
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
              {error}
            </div>
          )}
          {data && !loading && (
            <div className="space-y-6">
              {/* Timeline */}
              <div className="relative">
                {/* Step 1: Raw Material Purchases */}
                <TimelineStep
                  step={1}
                  color="orange"
                  title="Raw Material Purchases (Supplier & Lot)"
                >
                  {data.rawMaterialPurchases.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No matching purchases found before this run.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 text-left">
                            <th className="pr-3 pb-1 font-semibold">Supplier</th>
                            <th className="pr-3 pb-1 font-semibold">Lot / Invoice</th>
                            <th className="pr-3 pb-1 font-semibold">Date</th>
                            <th className="pr-3 pb-1 font-semibold">Material</th>
                            <th className="pb-1 font-semibold text-right">Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.rawMaterialPurchases.map((p, i) => (
                            <tr key={i} className="text-gray-700">
                              <td className="pr-3 py-1 font-medium">{p.supplierName}</td>
                              <td className="pr-3 py-1 font-mono">{p.lotNo}</td>
                              <td className="pr-3 py-1">{p.purchaseDate}</td>
                              <td className="pr-3 py-1">{p.itemName}</td>
                              <td className="py-1 text-right">
                                {p.qty} {p.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TimelineStep>

                {/* Step 2: Production Batch */}
                <TimelineStep
                  step={2}
                  color="blue"
                  title={`Production Batch — ${data.batch.runCode}`}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-3">
                    <KV label="Product" value={data.batch.finishedItemName} />
                    <KV label="Run Date" value={data.batch.runDate} />
                    <KV label="Batches" value={data.batch.batches} />
                    <KV label="Expected Output" value={`${data.batch.expectedOutputQty} pkts`} />
                    <KV label="Actual Output" value={`${data.batch.actualOutputQty} pkts`} />
                    <KV
                      label="Yield Variance"
                      value={`${data.batch.yieldVariancePct}%`}
                      highlight={data.batch.isYieldFlagged}
                    />
                    <KV
                      label="Cost / Packet"
                      value={paisaToRupee(data.batch.costPerPacketPaisa)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.batch.consumptions.map((c, i) => (
                      <span
                        key={i}
                        className={`px-2 py-0.5 rounded text-xs ${
                          c.isFlagged
                            ? "bg-red-100 text-red-800 font-semibold"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {c.itemName}: {c.actualQty} (plan {c.plannedQty}) · {c.variancePct}%
                      </span>
                    ))}
                  </div>
                </TimelineStep>

                {/* Step 3: Dispatched Customers */}
                <TimelineStep
                  step={3}
                  color="green"
                  title="Dispatched Customers & Invoices"
                  last
                >
                  {data.dispatchedCustomers.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No dispatches found for this batch yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 text-left">
                            <th className="pr-3 pb-1 font-semibold">Invoice</th>
                            <th className="pr-3 pb-1 font-semibold">Date</th>
                            <th className="pr-3 pb-1 font-semibold">Customer</th>
                            <th className="pr-3 pb-1 font-semibold">State</th>
                            <th className="pr-3 pb-1 font-semibold text-right">Qty</th>
                            <th className="pr-3 pb-1 font-semibold text-right">Total</th>
                            <th className="pb-1 font-semibold text-right">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.dispatchedCustomers.map((d, i) => (
                            <tr key={i} className="text-gray-700">
                              <td className="pr-3 py-1 font-mono">{d.invoiceNumber}</td>
                              <td className="pr-3 py-1">{d.dispatchDate}</td>
                              <td className="pr-3 py-1 font-medium">{d.customerName}</td>
                              <td className="pr-3 py-1">{d.stateCode}</td>
                              <td className="pr-3 py-1 text-right">{d.qty}</td>
                              <td className="pr-3 py-1 text-right">
                                {paisaToRupee(d.totalPaisa)}
                              </td>
                              <td className="py-1 text-right">
                                <span
                                  className={`font-semibold ${
                                    d.outstandingPaisa > 0 ? "text-red-700" : "text-green-700"
                                  }`}
                                >
                                  {paisaToRupee(d.outstandingPaisa)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TimelineStep>
              </div>

              <p className="text-xs text-gray-400 text-right">
                Trace generated: {new Date(data.traceGeneratedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineStep({
  step,
  color,
  title,
  children,
  last = false,
}: {
  step: number;
  color: "orange" | "blue" | "green";
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  const colorMap = {
    orange: "bg-orange-500",
    blue: "bg-blue-500",
    green: "bg-green-500",
  };
  const borderMap = {
    orange: "border-orange-200 bg-orange-50",
    blue: "border-blue-200 bg-blue-50",
    green: "border-green-200 bg-green-50",
  };
  const textMap = {
    orange: "text-orange-900",
    blue: "text-blue-900",
    green: "text-green-900",
  };

  return (
    <div className="flex gap-3">
      {/* Dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 rounded-full ${colorMap[color]} text-white flex items-center justify-center text-xs font-bold shrink-0`}
        >
          {step}
        </div>
        {!last && <div className="w-0.5 bg-gray-200 flex-1 my-1" />}
      </div>

      {/* Content */}
      <div className={`flex-1 mb-4 p-3 rounded-lg border ${borderMap[color]}`}>
        <h4 className={`text-sm font-semibold mb-2 ${textMap[color]}`}>{title}</h4>
        {children}
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className={`font-semibold ${highlight ? "text-red-700" : "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}
