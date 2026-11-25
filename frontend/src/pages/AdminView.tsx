import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { AuthUser } from "../lib/auth";
import { paisaToRupee } from "../lib/money";
import { Layout } from "../components/Layout";

interface StockCheckResult {
  orderId: string;
  sufficient: boolean;
  shortages: Array<{
    itemId: string;
    itemName: string;
    orderedQty: number;
    availableQty: number;
    shortageQty: number;
    recommendedBatches: number;
  }>;
}

interface Order {
  id: string;
  orderCode: string;
  status: string;
  customer: { id: string; name: string; stateCode: string; type: string };
  lines: Array<{ id: string; itemId: string; qty: number; unitPricePaisa: number }>;
  invoice: {
    id: string;
    invoiceNumber: string;
    taxablePaisa: number;
    cgstPaisa: number;
    sgstPaisa: number;
    igstPaisa: number;
    totalPaisa: number;
    status: string;
    dispatchedAt: string | null;
  } | null;
  createdAt: string;
}

interface OutstandingCustomer {
  customerId: string;
  customerName: string;
  stateCode: string;
  totalInvoicedPaisa: number;
  totalPaidPaisa: number;
  outstandingPaisa: number;
  ageing: { "0-30": number; "31-60": number; "60+": number };
}

interface ProductionPlan {
  status: string;
  finishedItemName: string;
  shortageQty: number;
  batches: string;
  expectedOutputQty: number;
}

// ─── Delivery Challan Modal ───────────────────────────────────────────────────
interface ChallanData {
  challanNo: string;
  dispatchDate: string;
  customerName: string;
  stateCode: string;
  product: string;
  qty: number;
  invoiceNumber: string;
}

function DeliveryChallanModal({
  challan,
  onClose,
}: {
  challan: ChallanData;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
        {/* Screen-only controls */}
        <div className="flex items-center justify-between p-4 border-b print:hidden">
          <h3 className="font-semibold text-gray-900">Delivery Challan Preview</h3>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="btn-primary text-xs px-3 py-1.5"
            >
              Print Challan
            </button>
            <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">
              Close
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div className="p-6 print:p-0 font-mono text-sm" id="challan-printable">
          <div className="text-center border-b-2 border-gray-900 pb-3 mb-4">
            <div className="text-xl font-bold tracking-widest">SnackFlow ERP</div>
            <div className="text-xs text-gray-500">
              Plot 42, SIDCO Industrial Estate, Madurai, Tamil Nadu – 625001
            </div>
            <div className="text-base font-bold mt-2 uppercase tracking-wider">
              Delivery Challan
            </div>
          </div>

          <table className="w-full text-xs border-collapse mb-4">
            <tbody>
              <tr>
                <td className="py-1 pr-3 font-semibold text-gray-600 w-40">Challan No.</td>
                <td className="py-1 font-bold">{challan.challanNo}</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-semibold text-gray-600">Dispatch Date</td>
                <td className="py-1">{challan.dispatchDate}</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-semibold text-gray-600">Invoice Ref.</td>
                <td className="py-1">{challan.invoiceNumber}</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-semibold text-gray-600">Customer</td>
                <td className="py-1 font-bold">{challan.customerName}</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-semibold text-gray-600">State</td>
                <td className="py-1">{challan.stateCode}</td>
              </tr>
            </tbody>
          </table>

          <table className="w-full text-xs border border-gray-400 border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-400 px-2 py-1.5 text-left">Product</th>
                <th className="border border-gray-400 px-2 py-1.5 text-right">Dispatched Qty</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1.5">{challan.product}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right font-bold">
                  {challan.qty} pkts
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-8 flex justify-between text-xs text-gray-500">
            <div>
              <div className="border-t border-gray-400 w-32 mt-8 pt-1">Prepared By</div>
            </div>
            <div>
              <div className="border-t border-gray-400 w-32 mt-8 pt-1">Received By</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main AdminView ───────────────────────────────────────────────────────────
export function AdminView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockChecks, setStockChecks] = useState<Record<string, StockCheckResult>>({});
  const [outstanding, setOutstanding] = useState<OutstandingCustomer[]>([]);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<number>(0);
  const [editPricePaisa, setEditPricePaisa] = useState<number>(0);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [payRupees, setPayRupees] = useState<string>("4000");
  const [payMode, setPayMode] = useState<"UPI" | "NEFT" | "CASH" | "CHEQUE">("UPI");
  const [planResult, setPlanResult] = useState<{ orderCode: string; plans: ProductionPlan[] } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [challan, setChallan] = useState<ChallanData | null>(null);
  const [copiedInvId, setCopiedInvId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [ordRes, outRes] = await Promise.all([
      api.get("/orders"),
      api.get("/payments/outstanding"),
    ]);
    const list = ordRes.data.orders as Order[];
    setOrders(list);
    setOutstanding(outRes.data.customers as OutstandingCustomer[]);

    const checks: Record<string, StockCheckResult> = {};
    await Promise.all(
      list
        .filter((o) => o.status === "SUBMITTED" || o.status === "APPROVED")
        .map(async (o) => {
          try {
            const res = await api.get(`/orders/${o.id}/stock-check`);
            checks[o.id] = res.data as StockCheckResult;
          } catch {
            // ignore
          }
        })
    );
    setStockChecks(checks);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleApprove(order: Order, withEdits = false) {
    setBanner(null);
    const body = withEdits
      ? {
          lines: order.lines.map((l, idx) =>
            idx === 0 ? { itemId: l.itemId, qty: editQty, unitPricePaisa: editPricePaisa } : l
          ),
        }
      : {};
    await api.patch(`/orders/${order.id}/approve`, body);
    setEditingOrderId(null);
    setBanner(`Approved order ${order.orderCode}`);
    await loadAll();
  }

  async function handleReject(order: Order) {
    await api.patch(`/orders/${order.id}/reject`);
    setBanner(`Rejected order ${order.orderCode}`);
    await loadAll();
  }

  async function handlePlanProduction(order: Order) {
    const res = await api.post(`/orders/${order.id}/plan-production`);
    setPlanResult({ orderCode: order.orderCode, plans: res.data.plans as ProductionPlan[] });
    setBanner(`Created 1-Click Production Plan for ${order.orderCode}`);
  }

  async function handleCreateInvoice(order: Order) {
    const res = await api.post(`/invoices/from-order/${order.id}`);
    setBanner(`Generated GST Invoice ${res.data.invoiceNumber}`);
    await loadAll();
  }

  async function handleDispatch(invoiceId: string, invoiceNumber: string) {
    try {
      await api.post(`/invoices/${invoiceId}/dispatch`);
      setBanner(`Dispatched ${invoiceNumber} & deducted StockLedger`);
      await loadAll();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Dispatch failed";
      setBanner(`Error: ${msg}`);
    }
  }

  async function handleCancelInvoice(invoiceId: string, invoiceNumber: string) {
    const res = await api.post(`/invoices/${invoiceId}/cancel`);
    setBanner(`Cancelled ${invoiceNumber} via Credit Note ${res.data.creditNote.invoiceNumber}`);
    await loadAll();
  }

  async function handleDownloadPdf(invoiceId: string, invoiceNumber: string) {
    const res = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber.replace(/\//g, "-")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRecordPayment(invoiceId: string) {
    const amountPaisa = Math.round(Number(payRupees) * 100);
    if (amountPaisa <= 0) return;
    await api.post("/payments", { invoiceId, amountPaisa, mode: payMode });
    setPaymentInvoiceId(null);
    setBanner(`Recorded ${paisaToRupee(amountPaisa)} payment (${payMode})`);
    await loadAll();
  }

  function openChallan(order: Order, inv: Order["invoice"]) {
    if (!inv) return;
    const qty = order.lines.reduce((s, l) => s + l.qty, 0);
    const productName = `Order ${order.orderCode} goods`;
    setChallan({
      challanNo: `DC-${inv.invoiceNumber.replace(/\//g, "-")}`,
      dispatchDate: inv.dispatchedAt
        ? new Date(inv.dispatchedAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      customerName: order.customer.name,
      stateCode: order.customer.stateCode,
      product: productName,
      qty,
      invoiceNumber: inv.invoiceNumber,
    });
  }

  function handleCopyWhatsApp(inv: Order["invoice"], customerName: string) {
    if (!inv) return;
    const msg =
      `*SnackFlow ERP* 🏭\n` +
      `Invoice No: ${inv.invoiceNumber}\n` +
      `Customer: ${customerName}\n` +
      `Total: ${paisaToRupee(inv.totalPaisa)}\n` +
      `Status: ${inv.status}${inv.dispatchedAt ? " · Dispatched" : ""}`;

    void navigator.clipboard.writeText(msg).then(() => {
      setCopiedInvId(inv.id);
      setTimeout(() => setCopiedInvId(null), 2000);
    });
  }

  return (
    <Layout user={user} onLogout={onLogout} title="Factory Admin Operations">
      {challan && (
        <DeliveryChallanModal challan={challan} onClose={() => setChallan(null)} />
      )}

      <div className="space-y-6">
        {banner && (
          <div className="p-3 rounded-md bg-brand-50 border border-brand-200 text-brand-900 text-sm flex justify-between items-center">
            <span>{banner}</span>
            <button onClick={() => setBanner(null)} className="text-xs underline">
              Dismiss
            </button>
          </div>
        )}

        {planResult && (
          <div className="card border-blue-200 bg-blue-50">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-blue-900">
                1-Click Make-to-Order Plan for {planResult.orderCode}
              </h3>
              <button onClick={() => setPlanResult(null)} className="text-xs text-blue-700 underline">
                Close
              </button>
            </div>
            {planResult.plans.map((p, i) => (
              <div key={i} className="text-sm text-blue-900 bg-white p-3 rounded border border-blue-200">
                <span className="font-semibold">{p.finishedItemName}</span> · Shortage:{" "}
                <strong>{p.shortageQty}</strong> · Recommended Batches:{" "}
                <strong>{p.batches}</strong> (Expected Output: {p.expectedOutputQty}) · Status:{" "}
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-semibold">
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Orders Queue */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Incoming Orders & Invoicing</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2.5">Order</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Qty / Value</th>
                  <th className="px-3 py-2.5">Stock Check</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => {
                  const qty = o.lines.reduce((s, l) => s + l.qty, 0);
                  const val = o.lines.reduce((s, l) => s + l.qty * l.unitPricePaisa, 0);
                  const sc = stockChecks[o.id];
                  const inv = o.invoice;

                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-900">{o.orderCode}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{o.customer.name}</div>
                        <div className="text-xs text-gray-500">State: {o.customer.stateCode}</div>
                      </td>
                      <td className="px-3 py-3">
                        {editingOrderId === o.id ? (
                          <div className="flex gap-2 items-center">
                            <input
                              type="number"
                              className="input border w-20 p-1 text-xs"
                              value={editQty}
                              onChange={(e) => setEditQty(Number(e.target.value))}
                            />
                            <input
                              type="number"
                              className="input border w-24 p-1 text-xs"
                              value={editPricePaisa}
                              onChange={(e) => setEditPricePaisa(Number(e.target.value))}
                            />
                            <button
                              onClick={() => void handleApprove(o, true)}
                              className="btn-primary text-xs px-2 py-1"
                            >
                              Save & Approve
                            </button>
                          </div>
                        ) : (
                          <div>
                            <span>{qty} pkts</span> ·{" "}
                            <span className="font-semibold">{paisaToRupee(val)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {sc ? (
                          sc.sufficient ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Sufficient
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                Short {sc.shortages[0]?.shortageQty} pkts
                              </span>
                              <div>
                                <button
                                  onClick={() => void handlePlanProduction(o)}
                                  className="text-xs text-blue-700 underline font-medium"
                                >
                                  Create Production Plan ({sc.shortages[0]?.recommendedBatches} batch)
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
                          {o.status}
                        </span>
                        {inv && (
                          <div className="text-xs text-gray-500 mt-1">
                            {inv.invoiceNumber} ({inv.status})
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {o.status === "SUBMITTED" && (
                            <>
                              <button
                                onClick={() => void handleApprove(o, false)}
                                className="btn-primary text-xs px-2.5 py-1"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setEditingOrderId(o.id);
                                  setEditQty(o.lines[0]?.qty ?? 0);
                                  setEditPricePaisa(o.lines[0]?.unitPricePaisa ?? 0);
                                }}
                                className="btn-secondary text-xs px-2.5 py-1"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => void handleReject(o)}
                                className="btn-secondary text-xs px-2.5 py-1 text-red-700"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {o.status === "APPROVED" && (
                            <button
                              onClick={() => void handleCreateInvoice(o)}
                              className="btn-primary text-xs px-2.5 py-1"
                            >
                              Raise GST Invoice
                            </button>
                          )}
                          {inv && (
                            <>
                              <button
                                onClick={() => void handleDownloadPdf(inv.id, inv.invoiceNumber)}
                                className="btn-secondary text-xs px-2.5 py-1"
                              >
                                PDF
                              </button>
                              {/* Copy WhatsApp Summary */}
                              <button
                                onClick={() => handleCopyWhatsApp(inv, o.customer.name)}
                                className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors ${
                                  copiedInvId === inv.id
                                    ? "bg-green-100 text-green-800 border-green-300"
                                    : "btn-secondary text-green-700"
                                }`}
                                title="Copy WhatsApp Summary"
                              >
                                {copiedInvId === inv.id ? "✓ Copied!" : "📋 WA Summary"}
                              </button>
                              {inv.status === "POSTED" && !inv.dispatchedAt && (
                                <button
                                  onClick={() => void handleDispatch(inv.id, inv.invoiceNumber)}
                                  className="btn-primary text-xs px-2.5 py-1"
                                >
                                  Dispatch
                                </button>
                              )}
                              {/* Delivery Challan — only shown after dispatch */}
                              {inv.dispatchedAt && (
                                <button
                                  onClick={() => openChallan(o, inv)}
                                  className="btn-secondary text-xs px-2.5 py-1 text-indigo-700"
                                >
                                  Delivery Challan
                                </button>
                              )}
                              {inv.status === "POSTED" && (
                                <>
                                  <button
                                    onClick={() => setPaymentInvoiceId(inv.id)}
                                    className="btn-secondary text-xs px-2.5 py-1"
                                  >
                                    Record Payment
                                  </button>
                                  <button
                                    onClick={() => void handleCancelInvoice(inv.id, inv.invoiceNumber)}
                                    className="btn-secondary text-xs px-2.5 py-1 text-red-700"
                                  >
                                    Credit Note
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>

                        {paymentInvoiceId === inv?.id && inv && (
                          <div className="mt-2 p-2 bg-gray-50 border rounded flex gap-2 items-center">
                            <input
                              type="number"
                              className="input border w-24 p-1 text-xs"
                              value={payRupees}
                              onChange={(e) => setPayRupees(e.target.value)}
                              placeholder="Amount ₹"
                            />
                            <select
                              className="input border p-1 text-xs"
                              value={payMode}
                              onChange={(e) =>
                                setPayMode(e.target.value as "UPI" | "NEFT" | "CASH" | "CHEQUE")
                              }
                            >
                              <option value="UPI">UPI</option>
                              <option value="NEFT">NEFT</option>
                              <option value="CASH">CASH</option>
                              <option value="CHEQUE">CHEQUE</option>
                            </select>
                            <button
                              onClick={() => void handleRecordPayment(inv.id)}
                              className="btn-primary text-xs px-2 py-1"
                            >
                              Save
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Customer Outstanding</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Invoiced</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Outstanding</th>
                  <th className="px-3 py-2">0-30d</th>
                  <th className="px-3 py-2">31-60d</th>
                  <th className="px-3 py-2">60+d</th>
                  <th className="px-3 py-2">WA Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outstanding.map((c) => (
                  <tr key={c.customerId}>
                    <td className="px-3 py-2 font-medium">{c.customerName}</td>
                    <td className="px-3 py-2">{paisaToRupee(c.totalInvoicedPaisa)}</td>
                    <td className="px-3 py-2">{paisaToRupee(c.totalPaidPaisa)}</td>
                    <td className="px-3 py-2 font-bold text-brand-700">
                      {paisaToRupee(c.outstandingPaisa)}
                    </td>
                    <td className="px-3 py-2">{paisaToRupee(c.ageing["0-30"])}</td>
                    <td className="px-3 py-2">{paisaToRupee(c.ageing["31-60"])}</td>
                    <td className="px-3 py-2">{paisaToRupee(c.ageing["60+"])}</td>
                    <td className="px-3 py-2">
                      <OutstandingWACopyButton customer={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ─── WhatsApp Summary Copy button for the Outstanding table ──────────────────
function OutstandingWACopyButton({ customer }: { customer: OutstandingCustomer }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const msg =
      `*SnackFlow ERP* 🏭\n` +
      `Customer: ${customer.customerName} (${customer.stateCode})\n` +
      `Total Invoiced: ${paisaToRupee(customer.totalInvoicedPaisa)}\n` +
      `Paid: ${paisaToRupee(customer.totalPaidPaisa)}\n` +
      `Balance Due: ${paisaToRupee(customer.outstandingPaisa)}`;

    void navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
        copied
          ? "bg-green-100 text-green-800 border-green-300"
          : "bg-white text-green-700 border-green-300 hover:bg-green-50"
      }`}
    >
      {copied ? "✓ Copied!" : "📋 Copy WA"}
    </button>
  );
}
