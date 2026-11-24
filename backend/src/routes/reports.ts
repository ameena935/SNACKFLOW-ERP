import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma";
import { getCurrentWAC } from "../lib/stock";
import { authenticate, requireRole } from "../middleware/auth";

export const reportsRouter = Router();

reportsRouter.use(authenticate);
reportsRouter.use(requireRole("AUDITOR", "ADMIN", "OWNER"));

function parseDateRange(req: Request): { gte?: Date; lte?: Date } {
  const { from, to } = req.query;
  const range: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    range.gte = new Date(`${from}T00:00:00.000Z`);
  }
  if (typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    range.lte = new Date(`${to}T23:59:59.999Z`);
  }
  return range;
}

function paisaStr(paisa: number): string {
  return (paisa / 100).toFixed(2);
}

interface ReportColumn {
  header: string;
  key: string;
  width?: number;
}

async function sendFormattedReport(
  req: Request,
  res: Response,
  options: {
    filename: string;
    title: string;
    columns: ReportColumn[];
    rows: Record<string, unknown>[];
    extraJson?: Record<string, unknown>;
  }
) {
  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";

  if (format === "xlsx" || format === "csv") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(options.title.slice(0, 31));
    sheet.columns = options.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
    }));
    for (const row of options.rows) {
      sheet.addRow(row);
    }

    if (format === "csv") {
      const buf = await workbook.csv.writeBuffer();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${options.filename}.csv"`);
      res.send(Buffer.from(buf));
      return;
    }

    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${options.filename}.xlsx"`);
    res.send(Buffer.from(buf));
    return;
  }

  if (format === "pdf") {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${options.filename}.pdf"`);
      res.send(Buffer.concat(chunks));
    });

    doc.fontSize(15).text(`CrispLedger ERP — ${options.title}`, { align: "left" });
    doc.fontSize(9).text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(0.8);

    const headers = options.columns.map((c) => c.header).join(" | ");
    doc.fontSize(8).text(headers);
    doc.text("─".repeat(120));

    for (const row of options.rows) {
      const line = options.columns.map((c) => String(row[c.key] ?? "")).join(" | ");
      doc.text(line);
    }

    if (options.rows.length === 0) {
      doc.text("No records found for the selected period.");
    }

    doc.end();
    return;
  }

  res.json({
    title: options.title,
    generatedAt: new Date().toISOString(),
    count: options.rows.length,
    rows: options.rows,
    ...(options.extraJson ?? {}),
  });
}

/**
 * a) GET /api/reports/sales-register
 */
reportsRouter.get("/sales-register", async (req: Request, res: Response) => {
  const dateFilter = parseDateRange(req);
  const orders = await prisma.order.findMany({
    where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : undefined,
    include: { customer: true, lines: true, invoice: true },
    orderBy: { createdAt: "desc" },
  });

  const items = await prisma.item.findMany();
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const rows: Record<string, unknown>[] = [];
  for (const order of orders) {
    for (const line of order.lines) {
      const item = itemMap.get(line.itemId);
      rows.push({
        orderCode: order.orderCode,
        date: order.createdAt.toISOString().slice(0, 10),
        customerName: order.customer.name,
        stateCode: order.customer.stateCode,
        status: order.status,
        itemName: item?.name ?? line.itemId,
        qty: line.qty,
        unitPriceRupees: paisaStr(line.unitPricePaisa),
        lineTotalRupees: paisaStr(line.qty * line.unitPricePaisa),
        invoiceNumber: order.invoice?.invoiceNumber ?? "-",
      });
    }
  }

  await sendFormattedReport(req, res, {
    filename: "sales-register",
    title: "Sales Register",
    columns: [
      { header: "Order Code", key: "orderCode" },
      { header: "Date", key: "date" },
      { header: "Customer", key: "customerName" },
      { header: "State", key: "stateCode" },
      { header: "Status", key: "status" },
      { header: "Product", key: "itemName" },
      { header: "Qty", key: "qty" },
      { header: "Rate (₹)", key: "unitPriceRupees" },
      { header: "Total (₹)", key: "lineTotalRupees" },
      { header: "Invoice", key: "invoiceNumber" },
    ],
    rows,
  });
});

/**
 * b) GET /api/reports/gst-summary
 */
reportsRouter.get("/gst-summary", async (req: Request, res: Response) => {
  const dateFilter = parseDateRange(req);
  const invoices = await prisma.invoice.findMany({
    where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : undefined,
    include: { order: { include: { customer: true } } },
    orderBy: { createdAt: "desc" },
  });

  let taxablePaisa = 0;
  let cgstPaisa = 0;
  let sgstPaisa = 0;
  let igstPaisa = 0;
  let totalPaisa = 0;

  const rows = invoices.map((inv) => {
    if (inv.status === "POSTED") {
      taxablePaisa += inv.taxablePaisa;
      cgstPaisa += inv.cgstPaisa;
      sgstPaisa += inv.sgstPaisa;
      igstPaisa += inv.igstPaisa;
      totalPaisa += inv.totalPaisa;
    }

    return {
      invoiceNumber: inv.invoiceNumber,
      date: inv.createdAt.toISOString().slice(0, 10),
      type: inv.creditNoteForId ? "CREDIT_NOTE" : "TAX_INVOICE",
      status: inv.status,
      customerName: inv.order?.customer.name ?? "Credit Note",
      gstin: inv.order?.customer.gstin ?? "-",
      stateCode: inv.order?.customer.stateCode ?? "-",
      taxableRupees: paisaStr(inv.taxablePaisa),
      cgstRupees: paisaStr(inv.cgstPaisa),
      sgstRupees: paisaStr(inv.sgstPaisa),
      igstRupees: paisaStr(inv.igstPaisa),
      totalRupees: paisaStr(inv.totalPaisa),
    };
  });

  await sendFormattedReport(req, res, {
    filename: "gst-summary",
    title: "GSTR-1 / GSTR-3B Outward Supplies Summary",
    columns: [
      { header: "Invoice No", key: "invoiceNumber" },
      { header: "Date", key: "date" },
      { header: "Type", key: "type" },
      { header: "Status", key: "status" },
      { header: "Customer", key: "customerName" },
      { header: "GSTIN", key: "gstin" },
      { header: "State", key: "stateCode" },
      { header: "Taxable (₹)", key: "taxableRupees" },
      { header: "CGST (₹)", key: "cgstRupees" },
      { header: "SGST (₹)", key: "sgstRupees" },
      { header: "IGST (₹)", key: "igstRupees" },
      { header: "Total (₹)", key: "totalRupees" },
    ],
    rows,
    extraJson: {
      totals: { taxablePaisa, cgstPaisa, sgstPaisa, igstPaisa, totalPaisa },
    },
  });
});

/**
 * c) GET /api/reports/purchase-register
 */
reportsRouter.get("/purchase-register", async (req: Request, res: Response) => {
  const dateFilter = parseDateRange(req);
  const purchases = await prisma.purchase.findMany({
    where: dateFilter.gte || dateFilter.lte ? { purchaseDate: dateFilter } : undefined,
    include: { supplier: true, lines: true },
    orderBy: { purchaseDate: "desc" },
  });

  const items = await prisma.item.findMany();
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const rows: Record<string, unknown>[] = [];
  for (const p of purchases) {
    for (const l of p.lines) {
      const item = itemMap.get(l.itemId);
      const lineTotal = l.qty.mul(l.unitRatePaisa).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      rows.push({
        invoiceNo: p.invoiceNo,
        date: p.purchaseDate.toISOString().slice(0, 10),
        supplierName: p.supplier.name,
        gstin: p.supplier.gstin ?? "-",
        itemName: item?.name ?? l.itemId,
        qty: l.qty.toString(),
        unit: item?.unit ?? "",
        unitRateRupees: paisaStr(l.unitRatePaisa),
        lineTotalRupees: paisaStr(lineTotal),
      });
    }
  }

  await sendFormattedReport(req, res, {
    filename: "purchase-register",
    title: "Purchase Register",
    columns: [
      { header: "Invoice No", key: "invoiceNo" },
      { header: "Date", key: "date" },
      { header: "Supplier", key: "supplierName" },
      { header: "GSTIN", key: "gstin" },
      { header: "Item", key: "itemName" },
      { header: "Qty", key: "qty" },
      { header: "Unit", key: "unit" },
      { header: "Rate (₹)", key: "unitRateRupees" },
      { header: "Total (₹)", key: "lineTotalRupees" },
    ],
    rows,
  });
});

/**
 * d) GET /api/reports/stock-summary
 */
reportsRouter.get("/stock-summary", async (req: Request, res: Response) => {
  const dateFilter = parseDateRange(req);
  const items = await prisma.item.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  const ledger = await prisma.stockLedger.findMany({
    where: dateFilter.lte ? { createdAt: { lte: dateFilter.lte } } : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const rows = await Promise.all(
    items.map(async (item) => {
      const entries = ledger.filter((e) => e.itemId === item.id);
      let opening = new Decimal(0);
      let receipts = new Decimal(0);
      let issues = new Decimal(0);
      let closing = new Decimal(0);

      for (const e of entries) {
        closing = closing.add(e.qtyDelta);
        if (e.sourceType === "OPENING") {
          opening = opening.add(e.qtyDelta);
        } else if (e.qtyDelta.gt(0)) {
          receipts = receipts.add(e.qtyDelta);
        } else if (e.qtyDelta.lt(0)) {
          issues = issues.add(e.qtyDelta.abs());
        }
      }

      const wacPaisa = await getCurrentWAC(item.id);
      return {
        sku: item.sku,
        name: item.name,
        type: item.type,
        unit: item.unit,
        openingQty: opening.toString(),
        receiptsQty: receipts.toString(),
        issuesQty: issues.toString(),
        closingQty: closing.toString(),
        wacRupees: (wacPaisa.toNumber() / 100).toFixed(3),
      };
    })
  );

  await sendFormattedReport(req, res, {
    filename: "stock-summary",
    title: "Stock Summary (Derived from StockLedger)",
    columns: [
      { header: "SKU", key: "sku" },
      { header: "Item", key: "name" },
      { header: "Type", key: "type" },
      { header: "Unit", key: "unit" },
      { header: "Opening", key: "openingQty" },
      { header: "Receipts", key: "receiptsQty" },
      { header: "Issues", key: "issuesQty" },
      { header: "Closing", key: "closingQty" },
      { header: "WAC (₹)", key: "wacRupees" },
    ],
    rows,
  });
});

/**
 * e) GET /api/reports/production
 */
reportsRouter.get("/production", async (req: Request, res: Response) => {
  const dateFilter = parseDateRange(req);
  const runs = await prisma.productionRun.findMany({
    where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : undefined,
    include: { consumptions: true },
    orderBy: { createdAt: "desc" },
  });

  const items = await prisma.item.findMany();
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const rows = runs.map((r) => {
    const flagged = r.consumptions
      .filter((c) => c.isFlagged)
      .map((c) => `${itemMap.get(c.itemId)?.name ?? c.itemId} (${c.variancePct}%)`)
      .join("; ");

    return {
      runCode: r.runCode,
      date: r.createdAt.toISOString().slice(0, 10),
      finishedItem: itemMap.get(r.finishedItemId)?.name ?? r.finishedItemId,
      batches: r.batches.toString(),
      expectedOutputQty: r.expectedOutputQty,
      actualOutputQty: r.actualOutputQty,
      yieldVariancePct: r.yieldVariancePct.toString(),
      isYieldFlagged: r.isYieldFlagged ? "FLAGGED" : "OK",
      damagedPouchesQty: r.damagedPouchesQty,
      cartonsUsedQty: r.cartonsUsedQty,
      costPerPacketRupees: paisaStr(r.costPerPacketPaisa),
      flaggedConsumptions: flagged || "None",
    };
  });

  await sendFormattedReport(req, res, {
    filename: "production-report",
    title: "Production Yield & Costing Report",
    columns: [
      { header: "Run Code", key: "runCode" },
      { header: "Date", key: "date" },
      { header: "Finished Good", key: "finishedItem" },
      { header: "Batches", key: "batches" },
      { header: "Expected", key: "expectedOutputQty" },
      { header: "Actual", key: "actualOutputQty" },
      { header: "Yield Var %", key: "yieldVariancePct" },
      { header: "Yield Status", key: "isYieldFlagged" },
      { header: "Damaged Pouches", key: "damagedPouchesQty" },
      { header: "Cost/Pkt (₹)", key: "costPerPacketRupees" },
      { header: "Flagged Materials", key: "flaggedConsumptions" },
    ],
    rows,
  });
});

/**
 * f) GET /api/reports/receivables
 */
reportsRouter.get("/receivables", async (req: Request, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { status: "POSTED", creditNoteForId: null, orderId: { not: null } },
    include: { order: { include: { customer: true } }, payments: true },
  });

  const nowMs = Date.now();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const map = new Map<
    string,
    {
      customerName: string;
      stateCode: string;
      invoicedPaisa: number;
      paidPaisa: number;
      outstandingPaisa: number;
      bucket0_30: number;
      bucket31_60: number;
      bucket60Plus: number;
    }
  >();

  for (const inv of invoices) {
    if (!inv.order) continue;
    const cust = inv.order.customer;
    const paid = inv.payments.reduce((s, p) => s + p.amountPaisa, 0);
    const unpaid = Math.max(0, inv.totalPaisa - paid);
    const ageDays = Math.floor((nowMs - inv.createdAt.getTime()) / MS_PER_DAY);

    const row = map.get(cust.id) ?? {
      customerName: cust.name,
      stateCode: cust.stateCode,
      invoicedPaisa: 0,
      paidPaisa: 0,
      outstandingPaisa: 0,
      bucket0_30: 0,
      bucket31_60: 0,
      bucket60Plus: 0,
    };
    row.invoicedPaisa += inv.totalPaisa;
    row.paidPaisa += paid;
    row.outstandingPaisa += unpaid;
    if (unpaid > 0) {
      if (ageDays <= 30) row.bucket0_30 += unpaid;
      else if (ageDays <= 60) row.bucket31_60 += unpaid;
      else row.bucket60Plus += unpaid;
    }
    map.set(cust.id, row);
  }

  const rows = Array.from(map.values()).map((r) => ({
    customerName: r.customerName,
    stateCode: r.stateCode,
    invoicedRupees: paisaStr(r.invoicedPaisa),
    paidRupees: paisaStr(r.paidPaisa),
    outstandingRupees: paisaStr(r.outstandingPaisa),
    bucket0_30Rupees: paisaStr(r.bucket0_30),
    bucket31_60Rupees: paisaStr(r.bucket31_60),
    bucket60PlusRupees: paisaStr(r.bucket60Plus),
  }));

  await sendFormattedReport(req, res, {
    filename: "receivables-ageing",
    title: "Customer Receivables & Ageing Report",
    columns: [
      { header: "Customer", key: "customerName" },
      { header: "State", key: "stateCode" },
      { header: "Invoiced (₹)", key: "invoicedRupees" },
      { header: "Paid (₹)", key: "paidRupees" },
      { header: "Outstanding (₹)", key: "outstandingRupees" },
      { header: "0-30 Days (₹)", key: "bucket0_30Rupees" },
      { header: "31-60 Days (₹)", key: "bucket31_60Rupees" },
      { header: "60+ Days (₹)", key: "bucket60PlusRupees" },
    ],
    rows,
  });
});

/**
 * g) GET /api/reports/integrity-check
 * Verifies:
 * 1. For every item: Opening + Receipts - Issues === Closing
 * 2. Total Invoiced - Payments - Credit Notes === Outstanding
 */
reportsRouter.get("/integrity-check", async (_req: Request, res: Response) => {
  const items = await prisma.item.findMany({ orderBy: { name: "asc" } });
  const ledger = await prisma.stockLedger.findMany();

  const checks: Array<{
    name: string;
    category: "INVENTORY" | "FINANCIAL";
    passed: boolean;
    expected: string;
    actual: string;
  }> = [];

  for (const item of items) {
    const entries = ledger.filter((e) => e.itemId === item.id);
    let opening = new Decimal(0);
    let receipts = new Decimal(0);
    let issues = new Decimal(0);
    let closing = new Decimal(0);

    for (const e of entries) {
      closing = closing.add(e.qtyDelta);
      if (e.sourceType === "OPENING") {
        opening = opening.add(e.qtyDelta);
      } else if (e.qtyDelta.gt(0)) {
        receipts = receipts.add(e.qtyDelta);
      } else if (e.qtyDelta.lt(0)) {
        issues = issues.add(e.qtyDelta.abs());
      }
    }

    const expected = opening.add(receipts).sub(issues);
    checks.push({
      name: `Stock Ledger Reconciliation: ${item.name} (${item.sku})`,
      category: "INVENTORY",
      passed: expected.equals(closing),
      expected: expected.toString(),
      actual: closing.toString(),
    });
  }

  const allInvoices = await prisma.invoice.findMany({ include: { payments: true } });
  const regularInvoices = allInvoices.filter((i) => !i.creditNoteForId);
  const creditNotes = allInvoices.filter((i) => i.creditNoteForId !== null);

  const totalGrossInvoiced = regularInvoices.reduce((s, i) => s + i.totalPaisa, 0);
  const totalCreditNotesAbs = creditNotes.reduce((s, cn) => s + Math.abs(cn.totalPaisa), 0);
  const totalPayments = regularInvoices
    .filter((i) => i.status === "POSTED")
    .reduce((s, i) => s + i.payments.reduce((ps, p) => ps + p.amountPaisa, 0), 0);

  const expectedOutstanding = totalGrossInvoiced - totalPayments - totalCreditNotesAbs;
  const actualOutstanding = regularInvoices
    .filter((i) => i.status === "POSTED")
    .reduce((s, i) => {
      const paid = i.payments.reduce((ps, p) => ps + p.amountPaisa, 0);
      return s + (i.totalPaisa - paid);
    }, 0);

  checks.push({
    name: "AR Reconciliation: Total Invoiced - Payments - Credit Notes === Outstanding",
    category: "FINANCIAL",
    passed: expectedOutstanding === actualOutstanding,
    expected: String(expectedOutstanding),
    actual: String(actualOutstanding),
  });

  const healthy = checks.every((c) => c.passed);

  res.json({
    healthy,
    checkedAt: new Date().toISOString(),
    checks,
  });
});

/**
 * h) GET /api/reports/owner-summary
 */
reportsRouter.get("/owner-summary", async (_req: Request, res: Response) => {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [todayOrders, items, ledger, runs, postedInvoices] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: { gte: startOfDay } },
      include: { lines: true },
    }),
    prisma.item.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.stockLedger.findMany(),
    prisma.productionRun.findMany({
      include: { consumptions: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.invoice.findMany({
      where: { status: "POSTED", creditNoteForId: null },
      include: { payments: true },
    }),
  ]);

  const todayOrdersValuePaisa = todayOrders.reduce(
    (sum, o) => sum + o.lines.reduce((ls, l) => ls + l.qty * l.unitPricePaisa, 0),
    0
  );

  const stockLevels = items.map((item) => {
    const qty = ledger
      .filter((e) => e.itemId === item.id)
      .reduce((s, e) => s.add(e.qtyDelta), new Decimal(0));
    const isLowStock = item.reorderLevel ? qty.lte(item.reorderLevel) : false;
    return {
      itemId: item.id,
      name: item.name,
      type: item.type,
      unit: item.unit,
      closingQty: qty.toString(),
      isLowStock,
    };
  });

  const varianceAlerts = runs
    .filter((r) => r.isYieldFlagged || r.consumptions.some((c) => c.isFlagged))
    .map((r) => ({
      runId: r.id,
      runCode: r.runCode,
      yieldVariancePct: r.yieldVariancePct.toString(),
      isYieldFlagged: r.isYieldFlagged,
      flaggedMaterials: r.consumptions
        .filter((c) => c.isFlagged)
        .map((c) => ({ itemId: c.itemId, variancePct: c.variancePct.toString() })),
      createdAt: r.createdAt,
    }));

  const latestRun = runs[0] ?? null;
  const fgItem = latestRun ? items.find((i) => i.id === latestRun.finishedItemId) : null;
  const latestCosting =
    latestRun && fgItem
      ? {
          runCode: latestRun.runCode,
          itemName: fgItem.name,
          costPerPacketPaisa: latestRun.costPerPacketPaisa,
          sellingPricePaisa: fgItem.sellingPricePaisa,
          marginPaisa: fgItem.sellingPricePaisa - latestRun.costPerPacketPaisa,
        }
      : null;

  const totalOutstandingPaisa = postedInvoices.reduce((sum, inv) => {
    const paid = inv.payments.reduce((ps, p) => ps + p.amountPaisa, 0);
    return sum + Math.max(0, inv.totalPaisa - paid);
  }, 0);

  res.json({
    todayOrdersCount: todayOrders.length,
    todayOrdersValuePaisa,
    stockLevels,
    varianceAlerts,
    latestCosting,
    totalOutstandingPaisa,
  });
});
