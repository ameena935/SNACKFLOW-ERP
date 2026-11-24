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
): Promise<{ status: number; data: any; headers: Headers; buffer?: Buffer }> {
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

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    const ab = await res.arrayBuffer();
    return {
      status: res.status,
      data: null,
      headers: res.headers,
      buffer: Buffer.from(ab),
    };
  }

  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

async function loginAs(email: string, password = "password123"): Promise<string> {
  const { status, data } = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expect(status).toBe(200);
  return data.token as string;
}

describe("Section 5 Full End-to-End Benchmark Test (Steps 1–8)", () => {
  beforeAll(async () => {
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
        notes: "Opening stock from E2E benchmark setup",
        createdById: SEED_USER_ID,
      })),
    });

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

  it("completes the full Order-to-Audit ERP loop with exact Section 5 numbers", async () => {
    // ── Step 1: Login & RBAC ──────────────────────────────────────────────────
    const adminToken = await loginAs("admin@factory.in");
    const floorToken = await loginAs("floor@factory.in");
    const salesmanAToken = await loginAs("salesmanA@factory.in");
    const salesmanBToken = await loginAs("salesmanB@factory.in");
    const auditorToken = await loginAs("auditor@factory.in");

    // ── Step 2: Purchase 60 kg Flour @ ₹45/kg ─────────────────────────────────
    const purchaseRes = await apiRequest("/api/purchases", {
      method: "POST",
      token: adminToken,
      body: {
        supplierId: "sup-kaveri-agro-mills",
        invoiceNo: "KAM-E2E-001",
        lines: [{ itemId: "item-flour", qty: "60", unitRatePaisa: 4500 }],
      },
    });
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.data.totalPaisa).toBe(270000);

    // ── Step 3: Production Run #1 (1 batch Murukku 200g) ──────────────────────
    const prod1Res = await apiRequest("/api/production-runs", {
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
    expect(prod1Res.status).toBe(201);
    expect(Number(prod1Res.data.yieldVariancePct)).toBe(-6);
    expect(prod1Res.data.isYieldFlagged).toBe(true);
    expect(prod1Res.data.costPerPacketPaisa).toBe(3114); // ₹31.14

    const oilCons = prod1Res.data.consumptions.find(
      (c: { itemId: string }) => c.itemId === "item-oil"
    );
    expect(Number(oilCons.variancePct)).toBe(5);
    expect(oilCons.isFlagged).toBe(true);

    // Check intermediate inventory balances
    const midSummary = await apiRequest("/api/inventory/summary", { token: auditorToken });
    const midMap = new Map<string, Record<string, string>>(
      midSummary.data.items.map((i: Record<string, string>) => [i.itemId, i])
    );
    expect(Number(midMap.get("item-flour")!.closingQty)).toBe(120);
    expect(Number(midMap.get("item-flour")!.wacPaisa)).toBe(4312.5);
    expect(Number(midMap.get("item-oil")!.closingQty)).toBe(19.5);
    expect(Number(midMap.get("item-pouch-200g")!.closingQty)).toBe(306);
    expect(Number(midMap.get("item-murukku-200g")!.closingQty)).toBe(238);

    // ── Step 4: Retailer A (TN) 150-packet Order, Approval, GST Invoice & PDF ─
    const clientOrderId = "OFFLINE-ORD-RET-A-001";
    const orderARes = await apiRequest("/api/orders", {
      method: "POST",
      token: salesmanAToken,
      body: {
        customerId: "cust-retailer-a",
        clientOrderId,
        lines: [{ itemId: "item-murukku-200g", qty: 150 }],
      },
    });
    expect(orderARes.status).toBe(201);
    expect(orderARes.data.lines[0].unitPricePaisa).toBe(5000); // Pulled from Item master

    // Idempotent offline sync retry returns same order
    const orderARetry = await apiRequest("/api/orders", {
      method: "POST",
      token: salesmanAToken,
      body: {
        customerId: "cust-retailer-a",
        clientOrderId,
        lines: [{ itemId: "item-murukku-200g", qty: 150 }],
      },
    });
    expect(orderARetry.status).toBe(200);
    expect(orderARetry.data.id).toBe(orderARes.data.id);

    // Stock check for Retailer A
    const stockCheckA = await apiRequest(`/api/orders/${orderARes.data.id}/stock-check`, {
      token: adminToken,
    });
    expect(stockCheckA.status).toBe(200);
    expect(stockCheckA.data.sufficient).toBe(true);
    expect(stockCheckA.data.shortages).toHaveLength(0);

    // Approve Retailer A order
    const approveARes = await apiRequest(`/api/orders/${orderARes.data.id}/approve`, {
      method: "PATCH",
      token: adminToken,
      body: {},
    });
    expect(approveARes.status).toBe(200);
    expect(approveARes.data.status).toBe("APPROVED");

    // Generate GST Invoice for Retailer A (TN intra-state: 2.5% CGST + 2.5% SGST)
    const invARes = await apiRequest(`/api/invoices/from-order/${orderARes.data.id}`, {
      method: "POST",
      token: adminToken,
    });
    expect(invARes.status).toBe(201);
    expect(invARes.data.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    expect(invARes.data.taxablePaisa).toBe(750000); // ₹7,500
    expect(invARes.data.cgstPaisa).toBe(18750);     // ₹187.50
    expect(invARes.data.sgstPaisa).toBe(18750);     // ₹187.50
    expect(invARes.data.igstPaisa).toBe(0);
    expect(invARes.data.totalPaisa).toBe(787500);   // ₹7,875

    // Verify PDF generation
    const pdfRes = await apiRequest(`/api/invoices/${invARes.data.id}/pdf`, {
      token: salesmanAToken,
    });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toContain("application/pdf");
    expect(pdfRes.buffer?.subarray(0, 5).toString("utf8")).toBe("%PDF-");

    // ── Step 5: Dispatch Retailer A Invoice -> Finished Goods = 88 packets ───
    const dispatchARes = await apiRequest(`/api/invoices/${invARes.data.id}/dispatch`, {
      method: "POST",
      token: adminToken,
    });
    expect(dispatchARes.status).toBe(200);
    expect(dispatchARes.data.dispatchedAt).toBeTruthy();

    const afterDispatchSummary = await apiRequest("/api/inventory/summary", {
      token: auditorToken,
    });
    const afterDispatchMap = new Map<string, Record<string, string>>(
      afterDispatchSummary.data.items.map((i: Record<string, string>) => [i.itemId, i])
    );
    expect(Number(afterDispatchMap.get("item-murukku-200g")!.closingQty)).toBe(88);

    // ── Step 6: Distributor B (KA) 120-packet Order -> Shortage 32, MTO, IGST ─
    const orderBRes = await apiRequest("/api/orders", {
      method: "POST",
      token: salesmanBToken,
      body: {
        customerId: "cust-distributor-b",
        lines: [{ itemId: "item-murukku-200g", qty: 120 }],
      },
    });
    expect(orderBRes.status).toBe(201);

    // Verify Salesman A only sees their own order, while Salesman B only sees theirs
    const salesmanAOrders = await apiRequest("/api/orders", { token: salesmanAToken });
    expect(salesmanAOrders.data.orders).toHaveLength(1);
    expect(salesmanAOrders.data.orders[0].id).toBe(orderARes.data.id);

    // Stock check flags shortage of 32 packets (120 - 88) and recommends 1 batch
    const stockCheckB = await apiRequest(`/api/orders/${orderBRes.data.id}/stock-check`, {
      token: adminToken,
    });
    expect(stockCheckB.status).toBe(200);
    expect(stockCheckB.data.sufficient).toBe(false);
    expect(stockCheckB.data.shortages).toHaveLength(1);
    expect(stockCheckB.data.shortages[0].shortageQty).toBe(32);
    expect(stockCheckB.data.shortages[0].recommendedBatches).toBe(1);

    // 1-Click Make-to-Order plan
    const planRes = await apiRequest(`/api/orders/${orderBRes.data.id}/plan-production`, {
      method: "POST",
      token: adminToken,
    });
    expect(planRes.status).toBe(200);
    expect(planRes.data.plans).toHaveLength(1);
    expect(planRes.data.plans[0].status).toBe("PLANNED");
    expect(planRes.data.plans[0].batches).toBe("1");

    // Approve Distributor B order & generate IGST (5%) Invoice
    const approveBRes = await apiRequest(`/api/orders/${orderBRes.data.id}/approve`, {
      method: "PATCH",
      token: adminToken,
      body: {},
    });
    expect(approveBRes.status).toBe(200);

    const invBRes = await apiRequest(`/api/invoices/from-order/${orderBRes.data.id}`, {
      method: "POST",
      token: adminToken,
    });
    expect(invBRes.status).toBe(201);
    expect(invBRes.data.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/0002$/);
    expect(invBRes.data.taxablePaisa).toBe(600000); // ₹6,000
    expect(invBRes.data.cgstPaisa).toBe(0);
    expect(invBRes.data.sgstPaisa).toBe(0);
    expect(invBRes.data.igstPaisa).toBe(30000);     // 5% IGST = ₹300
    expect(invBRes.data.totalPaisa).toBe(630000);   // ₹6,300

    // Verify Credit Note cancellation on Distributor B invoice (never deletes posted invoice)
    const cancelBRes = await apiRequest(`/api/invoices/${invBRes.data.id}/cancel`, {
      method: "POST",
      token: adminToken,
    });
    expect(cancelBRes.status).toBe(200);
    expect(cancelBRes.data.cancelledInvoice.status).toBe("CANCELLED");
    expect(cancelBRes.data.creditNote.creditNoteForId).toBe(invBRes.data.id);
    expect(cancelBRes.data.creditNote.totalPaisa).toBe(-630000);

    // ── Step 7: Retailer A Payment of ₹4,000 -> Outstanding = ₹3,875 ─────────
    const payRes = await apiRequest("/api/payments", {
      method: "POST",
      token: adminToken,
      body: {
        invoiceId: invARes.data.id,
        amountPaisa: 400000, // ₹4,000
        mode: "UPI",
      },
    });
    expect(payRes.status).toBe(201);
    expect(payRes.data.totalPaidPaisa).toBe(400000);
    expect(payRes.data.outstandingPaisa).toBe(387500); // ₹3,875

    const outstandingRes = await apiRequest("/api/payments/outstanding", {
      token: auditorToken,
    });
    expect(outstandingRes.status).toBe(200);
    const retailerAOut = outstandingRes.data.customers.find(
      (c: { customerId: string }) => c.customerId === "cust-retailer-a"
    );
    expect(retailerAOut).toBeDefined();
    expect(retailerAOut.totalInvoicedPaisa).toBe(787500);
    expect(retailerAOut.totalPaidPaisa).toBe(400000);
    expect(retailerAOut.outstandingPaisa).toBe(387500);
    expect(retailerAOut.ageing["0-30"]).toBe(387500);

    // ── Step 8: Final Ledger & Audit Check ────────────────────────────────────
    const ledgerRes = await apiRequest("/api/inventory/ledger", { token: auditorToken });
    expect(ledgerRes.status).toBe(200);
    const dispatchRows = ledgerRes.data.entries.filter(
      (e: { sourceType: string }) => e.sourceType === "DISPATCH"
    );
    expect(dispatchRows).toHaveLength(1);
    expect(Number(dispatchRows[0].qtyDelta)).toBe(-150);
  });
});
