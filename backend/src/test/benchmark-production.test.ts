import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import { Decimal } from "@prisma/client/runtime/library";
import { app } from "../index";
import { prisma } from "../lib/prisma";

const SEED_USER_ID = "00000000-0000-0000-0000-000000000001";

let server: http.Server;
let baseUrl: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

async function loginAs(email: string, password = "password123"): Promise<string> {
  const { status, data } = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expect(status).toBe(200);
  expect(data.token).toBeTruthy();
  return data.token as string;
}

describe("Section 5 Benchmark Integration Test: Auth, Purchase, Production & Inventory Ledger", () => {
  beforeAll(async () => {
    // Reset transactional tables to a clean seeded baseline
    await prisma.$transaction([
      prisma.auditLog.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.orderLine.deleteMany(),
      prisma.order.deleteMany(),
      prisma.productionConsumption.deleteMany(),
      prisma.productionRun.deleteMany(),
      prisma.purchaseLine.deleteMany(),
      prisma.purchase.deleteMany(),
      prisma.stockLedger.deleteMany(),
    ]);

    // Re-insert the 6 canonical OPENING StockLedger rows
    const openingRows = [
      { itemId: "item-flour", qtyDelta: new Decimal(100), unitCostPaisa: new Decimal(4200) },
      { itemId: "item-oil", qtyDelta: new Decimal(30), unitCostPaisa: new Decimal(14000) },
      { itemId: "item-spice", qtyDelta: new Decimal(5), unitCostPaisa: new Decimal(20000) },
      { itemId: "item-pouch-200g", qtyDelta: new Decimal(500), unitCostPaisa: new Decimal(250) },
      { itemId: "item-carton-20pk", qtyDelta: new Decimal(30), unitCostPaisa: new Decimal(1500) },
      { itemId: "item-murukku-200g", qtyDelta: new Decimal(50), unitCostPaisa: new Decimal(5000) },
    ];

    await prisma.stockLedger.createMany({
      data: openingRows.map((row) => ({
        ...row,
        sourceType: "OPENING",
        sourceId: "SEED",
        notes: "Opening stock from benchmark test setup",
        createdById: SEED_USER_ID,
      })),
    });

    // Start ephemeral HTTP server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await prisma.$disconnect();
  });

  it("executes Section 5 Steps 1, 2, 3, and 8 with exact financial & inventory accuracy", async () => {
    // ── Step 1: Auth & RBAC ───────────────────────────────────────────────────
    const adminRes = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { email: "admin@factory.in", password: "password123" },
    });
    expect(adminRes.status).toBe(200);
    expect(adminRes.data.user.role).toBe("ADMIN");
    const adminToken = adminRes.data.token as string;

    const floorToken = await loginAs("floor@factory.in");
    const salesmanToken = await loginAs("salesmanA@factory.in");
    const auditorToken = await loginAs("auditor@factory.in");

    // Unauthenticated request blocked
    const unauthRes = await apiRequest("/api/inventory/summary");
    expect(unauthRes.status).toBe(401);

    // SALESMAN cannot create purchases or production runs
    const forbiddenPurchase = await apiRequest("/api/purchases", {
      method: "POST",
      token: salesmanToken,
      body: {
        supplierId: "sup-kaveri-agro-mills",
        invoiceNo: "INV-FORBIDDEN",
        lines: [{ itemId: "item-flour", qty: "10", unitRatePaisa: 4500 }],
      },
    });
    expect(forbiddenPurchase.status).toBe(403);

    const forbiddenProd = await apiRequest("/api/production-runs", {
      method: "POST",
      token: salesmanToken,
      body: {
        finishedItemId: "item-murukku-200g",
        batches: "1",
        actualOutputQty: 200,
        actualConsumptions: [{ itemId: "item-flour", actualQty: "40" }],
      },
    });
    expect(forbiddenProd.status).toBe(403);

    // ── Step 2: Purchase 60 kg Flour @ ₹45/kg (4500 paisa) ────────────────────
    // Opening: 100 kg @ 4200 = 420,000 paisa
    // Purchase: 60 kg @ 4500 = 270,000 paisa
    // Total: 160 kg, Value = 690,000 paisa -> WAC = 4312.5000 paisa (₹43.125/kg)
    const purchaseRes = await apiRequest("/api/purchases", {
      method: "POST",
      token: adminToken,
      body: {
        supplierId: "sup-kaveri-agro-mills",
        invoiceNo: "KAM-2026-001",
        lines: [{ itemId: "item-flour", qty: "60", unitRatePaisa: 4500 }],
      },
    });
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.data.totalPaisa).toBe(270000);

    // Verify GET /api/purchases
    const listPurchasesRes = await apiRequest("/api/purchases", { token: adminToken });
    expect(listPurchasesRes.status).toBe(200);
    expect(listPurchasesRes.data.purchases.length).toBe(1);

    // ── Step 3: Production Run (1 batch Murukku 200g) ─────────────────────────
    // Planned: 40 kg Flour, 10 L Oil, 1.2 kg Spice -> Expected 200 packets
    // Actual:  40 kg Flour, 10.5 L Oil (+5% variance -> flagged), 1.2 kg Spice
    // Output:  188 packets (-6% yield variance -> flagged), 6 damaged pouches, 9 cartons
    // Costs:   Flour (40 * 4312.5 = 172,500) + Oil (10.5 * 14000 = 147,000) + Spice (1.2 * 20000 = 24,000)
    //        + Pouches (194 * 250 = 48,500) + Cartons (9 * 1500 = 13,500)
    //        + Labour (120,000) + Overhead (60,000) = 585,500 paisa
    // Cost per packet = Math.round(585500 / 188) = 3114 paisa (₹31.14)
    const prodRes = await apiRequest("/api/production-runs", {
      method: "POST",
      token: floorToken,
      body: {
        finishedItemId: "item-murukku-200g",
        batches: "1",
        actualConsumptions: [
          { itemId: "item-flour", actualQty: "40" },
          { itemId: "item-oil", actualQty: "10.5" },
          { itemId: "item-spice", actualQty: "1.2" },
        ],
        actualOutputQty: 188,
        damagedPouchesQty: 6,
        cartonsUsedQty: 9,
        labourCostPaisa: 120000,
        overheadCostPaisa: 60000,
      },
    });
    expect(prodRes.status).toBe(201);
    expect(prodRes.data.expectedOutputQty).toBe(200);
    expect(prodRes.data.actualOutputQty).toBe(188);
    expect(Number(prodRes.data.yieldVariancePct)).toBe(-6);
    expect(prodRes.data.isYieldFlagged).toBe(true);
    expect(prodRes.data.costPerPacketPaisa).toBe(3114);

    const oilConsumption = prodRes.data.consumptions.find(
      (c: { itemId: string }) => c.itemId === "item-oil"
    );
    expect(oilConsumption).toBeDefined();
    expect(Number(oilConsumption.variancePct)).toBe(5);
    expect(oilConsumption.isFlagged).toBe(true);

    // Verify GET /api/production-runs
    const listProdRes = await apiRequest("/api/production-runs", { token: auditorToken });
    expect(listProdRes.status).toBe(200);
    expect(listProdRes.data.runs.length).toBe(1);

    // ── Step 8: Inventory Summary & Ledger Verification ───────────────────────
    const summaryRes = await apiRequest("/api/inventory/summary", { token: auditorToken });
    expect(summaryRes.status).toBe(200);

    const byId = new Map<string, Record<string, string>>(
      summaryRes.data.items.map((item: Record<string, string>) => [item.itemId, item])
    );

    const flour = byId.get("item-flour")!;
    expect(Number(flour.closingQty)).toBe(120);
    expect(Number(flour.wacPaisa)).toBe(4312.5); // ₹43.125/kg

    const oil = byId.get("item-oil")!;
    expect(Number(oil.closingQty)).toBe(19.5);

    const pouches = byId.get("item-pouch-200g")!;
    expect(Number(pouches.closingQty)).toBe(306);

    const murukku = byId.get("item-murukku-200g")!;
    expect(Number(murukku.closingQty)).toBe(238); // 50 opening + 188 produced

    // Verify Ledger API
    const ledgerRes = await apiRequest("/api/inventory/ledger", { token: auditorToken });
    expect(ledgerRes.status).toBe(200);
    expect(ledgerRes.data.entries.length).toBeGreaterThanOrEqual(13);

    // Verify AuditLog entries were created for Purchase and ProductionRun
    const auditLogs = await prisma.auditLog.findMany();
    expect(auditLogs.some((a) => a.entityType === "Purchase" && a.action === "CREATE")).toBe(true);
    expect(auditLogs.some((a) => a.entityType === "ProductionRun" && a.action === "CREATE")).toBe(
      true
    );
  });
});
