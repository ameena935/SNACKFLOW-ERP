import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { AuthUser } from "../lib/auth";
import { paisaToRupee } from "../lib/money";
import { Layout } from "../components/Layout";
import { TraceBatchButton } from "../components/TraceBatchButton";

interface RecipeLine {
  itemId: string;
  qtyPerBatch: string;
}

interface Item {
  id: string;
  sku: string;
  name: string;
  type: string;
  unit: string;
  packWeightG: number | null;
  recipe?: {
    id: string;
    name: string;
    batchYieldG: number;
    lines: RecipeLine[];
  } | null;
}

interface Supplier {
  id: string;
  name: string;
  stateCode: string;
}

interface ProductionRun {
  id: string;
  runCode: string;
  batches: string;
  expectedOutputQty: number;
  actualOutputQty: number;
  yieldVariancePct: string;
  isYieldFlagged: boolean;
  costPerPacketPaisa: number;
  consumptions: Array<{
    itemId: string;
    plannedQty: string;
    actualQty: string;
    variancePct: string;
    isFlagged: boolean;
  }>;
}

const LABELS = {
  en: {
    title: "Production Floor Console",
    tabProduction: "Log Production Run",
    tabPurchase: "Record Raw Material Purchase",
    finishedProduct: "Finished Product",
    batches: "Batches",
    rawMaterials: "Actual Raw Materials Issued",
    goodOutput: "Good Output (packets)",
    damagedPouches: "Damaged Pouches",
    cartonsUsed: "Cartons Used",
    labourCost: "Labour Cost (₹)",
    overheadCost: "Overhead Cost (₹)",
    submitRun: "Complete Production Run",
    recentRuns: "Recent Production Runs",
    supplier: "Supplier",
    invoiceNo: "Supplier Invoice No",
    item: "Raw Material / Packaging",
    qty: "Quantity",
    rate: "Unit Rate (₹)",
    submitPurchase: "Record Purchase",
    flagged: "VARIANCE > 3%",
    ok: "OK",
    costPerPacket: "Cost / Packet",
  },
  ta: {
    title: "உற்பத்தி தளம் (Production Floor)",
    tabProduction: "உற்பத்தி பதிவு (Production Run)",
    tabPurchase: "மூலப்பொருள் கொள்முதல் (Purchase)",
    finishedProduct: "தயாரிப்பு பொருள்",
    batches: "பேட்ச் எண்ணிக்கை (Batches)",
    rawMaterials: "பயன்படுத்திய மூலப்பொருட்கள்",
    goodOutput: "நல்ல பாக்கெட்டுகள் (Output)",
    damagedPouches: "சேதமடைந்த பைகள்",
    cartonsUsed: "பயன்படுத்திய அட்டைப்பெட்டிகள்",
    labourCost: "தொழிலாளர் செலவு (₹)",
    overheadCost: "மேல்நிலை செலவு (₹)",
    submitRun: "உற்பத்தியை பதிவு செய்",
    recentRuns: "சமீபத்திய உற்பத்தி பதிவுகள்",
    supplier: "விநியோகஸ்தர் (Supplier)",
    invoiceNo: "பில் எண் (Invoice No)",
    item: "பொருள் (Item)",
    qty: "அளவு (Qty)",
    rate: "விலை (₹)",
    submitPurchase: "கொள்முதல் பதிவு செய்",
    flagged: "வேறுபாடு > 3%",
    ok: "சரி",
    costPerPacket: "ஒரு பாக்கெட் செலவு",
  },
};

export function ProductionView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [tab, setTab] = useState<"production" | "purchase">("production");
  const t = LABELS[lang];

  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Production form state
  const [finishedItemId, setFinishedItemId] = useState("");
  const [batches, setBatches] = useState("1");
  const [consumptions, setConsumptions] = useState<Record<string, string>>({});
  const [actualOutputQty, setActualOutputQty] = useState("188");
  const [damagedPouchesQty, setDamagedPouchesQty] = useState("6");
  const [cartonsUsedQty, setCartonsUsedQty] = useState("9");
  const [labourRupees, setLabourRupees] = useState("1200");
  const [overheadRupees, setOverheadRupees] = useState("600");

  // Purchase form state
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("KAM-2026-001");
  const [purchaseItemId, setPurchaseItemId] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("60");
  const [purchaseRateRupees, setPurchaseRateRupees] = useState("45");

  const loadData = useCallback(async () => {
    const [itemRes, supRes, runRes] = await Promise.all([
      api.get("/master/items"),
      api.get("/master/suppliers"),
      api.get("/production-runs"),
    ]);

    const allItems = itemRes.data.items as Item[];
    const allSups = supRes.data.suppliers as Supplier[];
    setItems(allItems);
    setSuppliers(allSups);
    setRuns(runRes.data.runs as ProductionRun[]);

    const fg = allItems.find((i) => i.type === "FINISHED_GOOD");
    if (fg && !finishedItemId) {
      setFinishedItemId(fg.id);
      if (fg.recipe) {
        const init: Record<string, string> = {};
        for (const rl of fg.recipe.lines) {
          init[rl.itemId] = rl.qtyPerBatch;
        }
        setConsumptions(init);
      }
    }

    const rm = allItems.find((i) => i.type !== "FINISHED_GOOD");
    if (rm && !purchaseItemId) setPurchaseItemId(rm.id);
    if (allSups[0] && !supplierId) setSupplierId(allSups[0].id);
  }, [finishedItemId, purchaseItemId, supplierId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const itemMap = new Map(items.map((i) => [i.id, i]));
  const selectedFg = itemMap.get(finishedItemId);

  function handleBatchChange(val: string) {
    setBatches(val);
    const b = Number(val) || 0;
    if (selectedFg?.recipe && b > 0) {
      const next: Record<string, string> = {};
      for (const rl of selectedFg.recipe.lines) {
        next[rl.itemId] = String(Number(rl.qtyPerBatch) * b);
      }
      setConsumptions(next);
    }
  }

  async function handleSubmitRun(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const payload = {
        finishedItemId,
        batches,
        actualConsumptions: Object.entries(consumptions).map(([itemId, actualQty]) => ({
          itemId,
          actualQty,
        })),
        actualOutputQty: Number(actualOutputQty),
        damagedPouchesQty: Number(damagedPouchesQty),
        cartonsUsedQty: Number(cartonsUsedQty),
        labourCostPaisa: Math.round(Number(labourRupees) * 100),
        overheadCostPaisa: Math.round(Number(overheadRupees) * 100),
      };
      const res = await api.post("/production-runs", payload);
      setMessage(
        `Run ${res.data.runCode} logged · ${t.costPerPacket}: ${paisaToRupee(
          res.data.costPerPacketPaisa
        )}`
      );
      await loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to log production run";
      setMessage(`Error: ${msg}`);
    }
  }

  async function handleSubmitPurchase(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const res = await api.post("/purchases", {
        supplierId,
        invoiceNo,
        lines: [
          {
            itemId: purchaseItemId,
            qty: purchaseQty,
            unitRatePaisa: Math.round(Number(purchaseRateRupees) * 100),
          },
        ],
      });
      setMessage(`Purchase ${res.data.invoiceNo} recorded (${paisaToRupee(res.data.totalPaisa)})`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to record purchase";
      setMessage(`Error: ${msg}`);
    }
  }

  return (
    <Layout
      user={user}
      onLogout={onLogout}
      title={t.title}
      rightSlot={
        <button
          type="button"
          onClick={() => setLang(lang === "en" ? "ta" : "en")}
          className="btn-secondary text-xs px-3 py-1.5 font-semibold"
        >
          {lang === "en" ? "தமிழ்" : "English"}
        </button>
      }
    >
      <div className="space-y-6">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("production")}
            className={tab === "production" ? "btn-primary" : "btn-secondary"}
          >
            {t.tabProduction}
          </button>
          <button
            onClick={() => setTab("purchase")}
            className={tab === "purchase" ? "btn-primary" : "btn-secondary"}
          >
            {t.tabPurchase}
          </button>
        </div>

        {message && (
          <div className="p-3 rounded bg-brand-50 border border-brand-200 text-brand-900 text-sm">
            {message}
          </div>
        )}

        {tab === "production" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">{t.tabProduction}</h2>
              <form onSubmit={handleSubmitRun} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t.finishedProduct}</label>
                    <select
                      className="input border p-2"
                      value={finishedItemId}
                      onChange={(e) => setFinishedItemId(e.target.value)}
                    >
                      {items
                        .filter((i) => i.type === "FINISHED_GOOD")
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t.batches}</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      className="input border p-2"
                      value={batches}
                      onChange={(e) => handleBatchChange(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">{t.rawMaterials}</label>
                  <div className="space-y-2">
                    {selectedFg?.recipe?.lines.map((rl) => {
                      const rm = itemMap.get(rl.itemId);
                      return (
                        <div key={rl.itemId} className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-700">
                            {rm?.name ?? rl.itemId} ({rm?.unit})
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            className="input border p-1.5 w-32 text-right"
                            value={consumptions[rl.itemId] ?? ""}
                            onChange={(e) =>
                              setConsumptions({ ...consumptions, [rl.itemId]: e.target.value })
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">{t.goodOutput}</label>
                    <input
                      type="number"
                      className="input border p-2"
                      value={actualOutputQty}
                      onChange={(e) => setActualOutputQty(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">{t.damagedPouches}</label>
                    <input
                      type="number"
                      className="input border p-2"
                      value={damagedPouchesQty}
                      onChange={(e) => setDamagedPouchesQty(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">{t.cartonsUsed}</label>
                    <input
                      type="number"
                      className="input border p-2"
                      value={cartonsUsedQty}
                      onChange={(e) => setCartonsUsedQty(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t.labourCost}</label>
                    <input
                      type="number"
                      className="input border p-2"
                      value={labourRupees}
                      onChange={(e) => setLabourRupees(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">{t.overheadCost}</label>
                    <input
                      type="number"
                      className="input border p-2"
                      value={overheadRupees}
                      onChange={(e) => setOverheadRupees(e.target.value)}
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full justify-center py-2.5">
                  {t.submitRun}
                </button>
              </form>
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold mb-4">{t.recentRuns}</h2>
              <div className="space-y-3">
                {runs.map((r) => (
                  <div key={r.id} className="p-3 border rounded-md space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm">{r.runCode}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-brand-700">
                          {t.costPerPacket}: {paisaToRupee(r.costPerPacketPaisa)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            r.isYieldFlagged
                              ? "bg-red-100 text-red-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          Yield {r.yieldVariancePct}% ({r.isYieldFlagged ? t.flagged : t.ok})
                        </span>
                        <TraceBatchButton runId={r.id} runCode={r.runCode} />
                      </div>
                    </div>
                    <div className="text-xs text-gray-600">
                      Output: {r.actualOutputQty} / {r.expectedOutputQty} pkts
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.consumptions.map((c) => (
                        <span
                          key={c.itemId}
                          className={`px-2 py-0.5 rounded text-xs ${
                            c.isFlagged
                              ? "bg-red-100 text-red-800 font-semibold"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {itemMap.get(c.itemId)?.name ?? c.itemId}: {c.variancePct}%
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card max-w-xl">
            <h2 className="text-lg font-semibold mb-4">{t.tabPurchase}</h2>
            <form onSubmit={handleSubmitPurchase} className="space-y-4">
              <div>
                <label className="label">{t.supplier}</label>
                <select
                  className="input border p-2"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.stateCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t.invoiceNo}</label>
                <input
                  className="input border p-2"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">{t.item}</label>
                <select
                  className="input border p-2"
                  value={purchaseItemId}
                  onChange={(e) => setPurchaseItemId(e.target.value)}
                >
                  {items
                    .filter((i) => i.type !== "FINISHED_GOOD")
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t.qty}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input border p-2"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">{t.rate}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input border p-2"
                    value={purchaseRateRupees}
                    onChange={(e) => setPurchaseRateRupees(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-2.5">
                {t.submitPurchase}
              </button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
