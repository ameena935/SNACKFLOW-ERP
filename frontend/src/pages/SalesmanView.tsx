import React, { useEffect, useState, useCallback } from "react";
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

const QUEUE_KEY = "crispledger_offline_orders";

function loadQueue(): OfflineQueuedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as OfflineQueuedOrder[];
  } catch {
    return [];
  }
}

export function SalesmanView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<CustomerSummary[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedOrder[]>(loadQueue);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("150");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const syncOfflineQueue = useCallback(async () => {
    const queue = loadQueue();
    if (queue.length === 0 || !navigator.onLine) return;

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

    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    setOfflineQueue(remaining);
    if (syncedCount > 0) {
      setMessage(`Synced ${syncedCount} offline order(s)`);
      void fetchData();
    }
  }, [fetchData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncOfflineQueue();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncOfflineQueue]);

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

    if (!navigator.onLine) {
      const custName = customers.find((c) => c.id === customerId)?.name ?? customerId;
      const updated = [
        ...offlineQueue,
        {
          clientOrderId,
          customerId,
          customerName: custName,
          lines: payload.lines,
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
      setOfflineQueue(updated);
      setMessage("Saved offline — marked Pending Sync");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/orders", payload);
      setMessage("Order submitted successfully");
      void fetchData();
    } catch {
      const custName = customers.find((c) => c.id === customerId)?.name ?? customerId;
      const updated = [
        ...offlineQueue,
        {
          clientOrderId,
          customerId,
          customerName: custName,
          lines: payload.lines,
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
      setOfflineQueue(updated);
      setMessage("Network unreachable — saved to Offline Queue (Pending Sync)");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedItem = items.find((i) => i.id === itemId);
  const estTotal = selectedItem ? selectedItem.sellingPricePaisa * (Number(qty) || 0) : 0;

  return (
    <Layout
      user={user}
      onLogout={onLogout}
      title="Salesman Mobile Order Entry"
      rightSlot={
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            isOnline ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {isOnline ? "Online" : "Offline Mode"}
        </span>
      }
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Fast Order Entry */}
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
              <div className="text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded p-2.5">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {submitting ? "Submitting..." : "Submit Order"}
            </button>
          </form>
        </div>

        {/* Offline Queue */}
        {offlineQueue.length > 0 && (
          <div className="card border-amber-300 bg-amber-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-amber-900">
                Offline Queue ({offlineQueue.length} Pending Sync)
              </h3>
              <button
                type="button"
                onClick={() => void syncOfflineQueue()}
                className="btn-secondary text-xs px-3 py-1"
              >
                Sync Now
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
                    <span className="text-gray-500 ml-2">Qty: {q.lines[0]?.qty}</span>
                  </div>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 font-medium">
                    Pending Sync
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Customer-wise Sales Summary */}
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

        {/* My Orders */}
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
