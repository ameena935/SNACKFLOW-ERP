import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { AuthUser } from "../lib/auth";
import { paisaToRupee } from "../lib/money";
import { Layout } from "../components/Layout";

interface Customer {
  id: string;
  name: string;
  type: string;
  stateCode: string;
}

interface Item {
  id: string;
  sku: string;
  name: string;
  type: string;
  unit: string;
  sellingPricePaisa: number;
}

interface OrderLine {
  id: string;
  itemId: string;
  qty: number;
  unitPricePaisa: number;
}

interface Order {
  id: string;
  orderCode: string;
  status: string;
  customer: Customer;
  lines: OrderLine[];
  createdAt: string;
}

interface CustomerSummary {
  customerId: string;
  customerName: string;
  stateCode: string;
  orderCount: number;
  totalValuePaisa: number;
}

interface OfflineQueuedOrder {
  clientOrderId: string;
  customerId: string;
  customerName: string;
  lines: { itemId: string; qty: number }[];
  createdAt: string;
}

const QUEUE_KEY = "crispledger_pending_orders";
const PING_INTERVAL_MS = 5_000;

function loadQueue(): OfflineQueuedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as OfflineQueuedOrder[];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineQueuedOrder[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Probe the backend health endpoint with fetch (not axios) so it bypasses
 * axios interceptors and uses `cache: 'no-store'` to skip service-worker
 * and browser caches. Returns true if the server is reachable.
 *
 * We deliberately avoid relying on `navigator.onLine` because on Windows with
 * Docker Desktop active, virtual network adapters keep that flag `true` even
 * when the real internet / local backend is unreachable.
 */
async function probeConnectivity(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function SalesmanView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<CustomerSummary[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedOrder[]>(loadQueue);

  // ----- Connectivity state -----
  // Start as "unknown" (null) so we don't flash green before the first probe.
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  // "Simulate offline" toggle for clean live demos
  const [simulateOffline, setSimulateOffline] = useState(false);
  const simulateOfflineRef = useRef(simulateOffline);
  simulateOfflineRef.current = simulateOffline;

  // Derived: treat as offline when simulating OR when probe says false
  const effectivelyOnline = isOnline === true && !simulateOffline;

  // ----- Form state -----
  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("150");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // ── fetchData ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [custRes, itemRes, ordRes] = await Promise.all([
        api.get("/master/customers"),
        api.get("/master/items"),
        api.get("/orders"),
      ]);
      const custs = custRes.data.customers as Customer[];
      const fgItems = (itemRes.data.items as Item[]).filter((i) => i.type === "FINISHED_GOOD");
      setCustomers(custs);
      setItems(fgItems);
      setOrders(ordRes.data.orders as Order[]);
      setSummary(ordRes.data.customerSummary as CustomerSummary[]);
      if (!customerId && custs[0]) setCustomerId(custs[0].id);
      if (!itemId && fgItems[0]) setItemId(fgItems[0].id);
    } catch {
      // Offline or transient error — keep cached state
    }
  }, [customerId, itemId]);

  // ── syncOfflineQueue ─────────────────────────────────────────────────────────
  const syncOfflineQueue = useCallback(async () => {
    const queue = loadQueue();
    if (queue.length === 0) return;

    // Don't attempt sync when simulating offline
    if (simulateOfflineRef.current) {
      setMessage("Simulation mode active — Sync Now is disabled.");
      return;
    }

    setSyncing(true);
    const remaining: OfflineQueuedOrder[] = [];
    let syncedCount = 0;

    for (const q of queue) {
      try {
        await api.post("/orders", {
          customerId: q.customerId,
          clientOrderId: q.clientOrderId,
          lines: q.lines,
        });
        syncedCount += 1;
      } catch {
        remaining.push(q);
      }
    }

    saveQueue(remaining);
    setOfflineQueue(remaining);
    setSyncing(false);

    if (syncedCount > 0) {
      setMessage(`✅ Synced ${syncedCount} queued order(s) successfully.`);
      void fetchData();
    } else if (remaining.length > 0) {
      setMessage("⚠️ Sync attempted — some orders still failed. Will retry.");
    }
  }, [fetchData]);

  // ── Connectivity probe ───────────────────────────────────────────────────────
  const runProbe = useCallback(async () => {
    // If the demo toggle is on, skip the network probe — stay "offline"
    if (simulateOfflineRef.current) return;

    const online = await probeConnectivity();

    setIsOnline((prev) => {
      // Came back online → trigger queue sync
      if (!prev && online) {
        // schedule async so state has settled
        setTimeout(() => void syncOfflineQueue(), 0);
      }
      return online;
    });
  }, [syncOfflineQueue]);

  // ── Mount: initial probe + data fetch ────────────────────────────────────────
  useEffect(() => {
    void runProbe();
    void fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── window online/offline events ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => void runProbe();
    const handleOffline = () => {
      if (!simulateOfflineRef.current) setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [runProbe]);

  // ── 5-second polling probe ───────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => void runProbe(), PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runProbe]);

  // ── Simulate offline toggle effect ───────────────────────────────────────────
  useEffect(() => {
    if (!simulateOffline) {
      // Resumed — run a real probe immediately
      void runProbe();
    }
  }, [simulateOffline, runProbe]);

  // ── handleSubmitOrder ────────────────────────────────────────────────────────
  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const qtyNum = Number(qty);
    if (!customerId || !itemId || qtyNum <= 0) return;

    const clientOrderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const payload = {
      customerId,
      clientOrderId,
      lines: [{ itemId, qty: qtyNum }],
    };

    // Queue immediately if we know we're offline
    if (!effectivelyOnline) {
      enqueueOrder(payload.clientOrderId, payload.customerId, payload.lines);
      setMessage("📦 Offline — order saved to Pending Sync queue.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/orders", payload);
      setMessage("✅ Order submitted successfully.");
      void fetchData();
    } catch {
      // Network error while apparently online — treat as offline, queue it
      setIsOnline(false);
      enqueueOrder(payload.clientOrderId, payload.customerId, payload.lines);
      setMessage("🔴 Network error — order saved to Pending Sync queue.");
    } finally {
      setSubmitting(false);
    }
  }

  function enqueueOrder(
    clientOrderId: string,
    cId: string,
    lines: { itemId: string; qty: number }[]
  ) {
    const custName = customers.find((c) => c.id === cId)?.name ?? cId;
    const updated = [
      ...loadQueue(), // re-read in case multiple tabs
      {
        clientOrderId,
        customerId: cId,
        customerName: custName,
        lines,
        createdAt: new Date().toISOString(),
      },
    ];
    saveQueue(updated);
    setOfflineQueue(updated);
  }

  const selectedItem = items.find((i) => i.id === itemId);
  const estTotal = selectedItem ? selectedItem.sellingPricePaisa * (Number(qty) || 0) : 0;

  // Status pill colour
  const statusPillClass =
    isOnline === null
      ? "bg-gray-100 text-gray-600"          // unknown / initialising
      : effectivelyOnline
      ? "bg-green-100 text-green-800"         // online
      : "bg-red-100 text-red-700";            // offline (real or simulated)

  const statusLabel =
    isOnline === null
      ? "Checking…"
      : simulateOffline
      ? "⚡ Simulated Offline"
      : effectivelyOnline
      ? "🟢 Online"
      : "🔴 Offline Mode";

  return (
    <Layout
      user={user}
      onLogout={onLogout}
      title="Salesman Mobile Order Entry"
      rightSlot={
        <div className="flex items-center gap-2">
          {/* Connectivity status pill */}
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusPillClass}`}>
            {statusLabel}
          </span>

          {/* Simulate Offline toggle — useful for live demos */}
          <button
            type="button"
            title="Toggle simulated offline mode for demos"
            onClick={() => setSimulateOffline((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              simulateOffline
                ? "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"
            }`}
          >
            {simulateOffline ? "↩ Resume Online" : "📡 Simulate Offline"}
          </button>
        </div>
      }
    >
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Offline / Pending-Sync Banner ── */}
        {offlineQueue.length > 0 && (
          <div className="card border-amber-300 bg-amber-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-amber-900">
                ⏳ Pending Sync ({offlineQueue.length} order{offlineQueue.length !== 1 ? "s" : ""})
              </h3>
              <button
                type="button"
                onClick={() => void syncOfflineQueue()}
                disabled={syncing || !effectivelyOnline}
                className="btn-secondary text-xs px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!effectivelyOnline ? "Cannot sync while offline" : "Sync now"}
              >
                {syncing ? "Syncing…" : "Sync Now"}
              </button>
            </div>
            <ul className="space-y-2 text-sm">
              {offlineQueue.map((q) => (
                <li
                  key={q.clientOrderId}
                  className="flex items-center justify-between bg-white p-2.5 rounded border border-amber-200"
                >
                  <div>
                    <span className="font-medium">{q.customerName}</span>
                    {q.lines.map((l, idx) => (
                      <span key={idx} className="text-gray-500 ml-2">
                        Qty: {l.qty}
                      </span>
                    ))}
                    <span className="text-gray-400 ml-2 text-xs">
                      {new Date(q.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 font-medium">
                    Pending Sync
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Fast Order Entry ── */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Order Entry</h2>
          <form onSubmit={handleSubmitOrder} className="space-y-4">
            <div>
              <label className="label">Customer</label>
              <select
                className="input border p-2.5"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.stateCode} · {c.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Product</label>
                <select
                  className="input border p-2.5"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  required
                >
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} — {paisaToRupee(i.sellingPricePaisa)}/{i.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quantity ({selectedItem?.unit ?? "packets"})</label>
                <input
                  type="number"
                  min={1}
                  className="input border p-2.5"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-brand-50 rounded-md p-3 text-sm">
              <span className="text-gray-600">Estimated Taxable Value</span>
              <span className="font-bold text-brand-800">{paisaToRupee(estTotal)}</span>
            </div>

            {message && (
              <div
                className={`text-sm rounded p-2.5 border ${
                  message.startsWith("✅")
                    ? "bg-green-50 border-green-200 text-green-800"
                    : message.startsWith("🔴") || message.startsWith("📦")
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-brand-50 border-brand-200 text-brand-800"
                }`}
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {submitting
                ? "Submitting…"
                : !effectivelyOnline
                ? "Save to Queue (Offline)"
                : "Submit Order"}
            </button>
          </form>
        </div>

        {/* ── Customer-wise Sales Summary ── */}
        {summary.length > 0 && (
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              My Customer-Wise Sales
            </h3>
            <div className="space-y-2">
              {summary.map((s) => (
                <div
                  key={s.customerId}
                  className="flex items-center justify-between text-sm py-2 border-b last:border-b-0"
                >
                  <div>
                    <span className="font-medium text-gray-900">{s.customerName}</span>
                    <span className="text-xs text-gray-500 ml-2">({s.orderCount} orders)</span>
                  </div>
                  <span className="font-semibold text-gray-900">
                    {paisaToRupee(s.totalValuePaisa)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── My Submitted Orders ── */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-3">My Submitted Orders</h3>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500">No orders yet.</p>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const total = o.lines.reduce((s, l) => s + l.qty * l.unitPricePaisa, 0);
                return (
                  <div
                    key={o.id}
                    className="p-3 rounded-md border border-gray-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm text-gray-900">
                        {o.orderCode} · {o.customer.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Qty: {o.lines.reduce((s, l) => s + l.qty, 0)} · {paisaToRupee(total)}
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
                      {o.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
