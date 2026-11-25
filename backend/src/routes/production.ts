import { Router, Request, Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma";
import { createProductionRunSchema } from "../lib/schemas";
import { getCurrentStock, getCurrentWAC } from "../lib/stock";
import { HttpError } from "../lib/errors";
import { authenticate, requireRole } from "../middleware/auth";

export const productionRouter = Router();

productionRouter.use(authenticate);

/**
 * POST /api/production-runs
 * Allowed roles: PRODUCTION, ADMIN
 * Executes full Two-Tier BOM consumption, WAC costing, variance flagging,
 * finished goods output, and audit logging inside a single PG transaction.
 */
productionRouter.post(
  "/",
  requireRole("PRODUCTION", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createProductionRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid production run payload", details: parsed.error.flatten() });
      return;
    }

    const {
      finishedItemId,
      batches,
      actualConsumptions,
      actualOutputQty,
      damagedPouchesQty,
      cartonsUsedQty,
      labourCostPaisa,
      overheadCostPaisa,
    } = parsed.data;
    const userId = req.user!.userId;

    try {
      const run = await prisma.$transaction(async (tx) => {
        const finishedItem = await tx.item.findUnique({
          where: { id: finishedItemId },
          include: {
            recipe: {
              include: { lines: true },
            },
          },
        });

        if (!finishedItem) {
          throw new HttpError(404, `Finished item not found: ${finishedItemId}`);
        }
        if (finishedItem.type !== "FINISHED_GOOD") {
          throw new HttpError(400, `Item ${finishedItem.sku} is not a FINISHED_GOOD`);
        }
        if (!finishedItem.recipe || !finishedItem.packWeightG) {
          throw new HttpError(
            400,
            `Finished item ${finishedItem.sku} is missing recipe or packWeightG configuration`
          );
        }

        const batchesDec = new Decimal(batches);
        const expectedOutputQty = batchesDec
          .mul(finishedItem.recipe.batchYieldG)
          .div(finishedItem.packWeightG)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();

        if (expectedOutputQty <= 0) {
          throw new HttpError(400, "Expected output quantity must be > 0");
        }

        // Map recipe lines by itemId for planned quantity lookup
        const recipeLineMap = new Map(
          finishedItem.recipe.lines.map((rl) => [rl.itemId, rl.qtyPerBatch])
        );

        // Step (a): Compute current WAC & verify stock BEFORE deducting
        const materialDetails: Array<{
          itemId: string;
          plannedQty: Decimal;
          actualQty: Decimal;
          variancePct: Decimal;
          isFlagged: boolean;
          wacPaisa: Decimal;
          lineCostPaisa: Decimal;
        }> = [];

        let totalMaterialCost = new Decimal(0);

        for (const c of actualConsumptions) {
          const item = await tx.item.findUnique({ where: { id: c.itemId } });
          if (!item) {
            throw new HttpError(404, `Raw material item not found: ${c.itemId}`);
          }

          const [onHand, wacPaisa] = await Promise.all([
            getCurrentStock(c.itemId, tx),
            getCurrentWAC(c.itemId, tx),
          ]);

          const actualQty = new Decimal(c.actualQty);
          if (onHand.lt(actualQty)) {
            throw new HttpError(
              400,
              `Insufficient stock for ${item.name}: on-hand ${onHand.toString()}, requested ${actualQty.toString()}`
            );
          }

          const qtyPerBatch = recipeLineMap.get(c.itemId) ?? new Decimal(0);
          const plannedQty = qtyPerBatch.mul(batchesDec);
          const variancePct = plannedQty.gt(0)
            ? actualQty
                .sub(plannedQty)
                .div(plannedQty)
                .mul(100)
                .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            : new Decimal(0);
          const isFlagged = variancePct.abs().gt(3);

          const lineCostPaisa = actualQty.mul(wacPaisa);
          totalMaterialCost = totalMaterialCost.add(lineCostPaisa);

          materialDetails.push({
            itemId: c.itemId,
            plannedQty,
            actualQty,
            variancePct,
            isFlagged,
            wacPaisa,
            lineCostPaisa,
          });
        }

        // Packaging WAC & stock check BEFORE deducting
        const pouchesUsedQty = actualOutputQty + damagedPouchesQty;
        let pouchWac = new Decimal(0);
        let totalPackagingCost = new Decimal(0);

        if (pouchesUsedQty > 0) {
          if (!finishedItem.pouchItemId) {
            throw new HttpError(400, `Finished item ${finishedItem.sku} has no pouchItemId configured`);
          }
          const [pouchOnHand, wac] = await Promise.all([
            getCurrentStock(finishedItem.pouchItemId, tx),
            getCurrentWAC(finishedItem.pouchItemId, tx),
          ]);
          if (pouchOnHand.lt(pouchesUsedQty)) {
            throw new HttpError(
              400,
              `Insufficient pouch stock: on-hand ${pouchOnHand.toString()}, needed ${pouchesUsedQty}`
            );
          }
          pouchWac = wac;
          totalPackagingCost = totalPackagingCost.add(new Decimal(pouchesUsedQty).mul(pouchWac));
        }

        let cartonWac = new Decimal(0);
        if (cartonsUsedQty > 0) {
          if (!finishedItem.cartonItemId) {
            throw new HttpError(400, `Finished item ${finishedItem.sku} has no cartonItemId configured`);
          }
          const [cartonOnHand, wac] = await Promise.all([
            getCurrentStock(finishedItem.cartonItemId, tx),
            getCurrentWAC(finishedItem.cartonItemId, tx),
          ]);
          if (cartonOnHand.lt(cartonsUsedQty)) {
            throw new HttpError(
              400,
              `Insufficient carton stock: on-hand ${cartonOnHand.toString()}, needed ${cartonsUsedQty}`
            );
          }
          cartonWac = wac;
          totalPackagingCost = totalPackagingCost.add(new Decimal(cartonsUsedQty).mul(cartonWac));
        }

        // Step (c): Yield variance %
        const yieldVariancePct = new Decimal(actualOutputQty)
          .sub(expectedOutputQty)
          .div(expectedOutputQty)
          .mul(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const isYieldFlagged = yieldVariancePct.abs().gt(3);

        // Step (d): Exact costPerPacketPaisa
        const totalCostPaisa = totalMaterialCost
          .add(totalPackagingCost)
          .add(labourCostPaisa)
          .add(overheadCostPaisa);
        const costPerPacketPaisa = Math.round(totalCostPaisa.div(actualOutputQty).toNumber());

        const existingCount = await tx.productionRun.count();
        const runCode = `RUN-${new Date().getFullYear()}-${String(existingCount + 1).padStart(3, "0")}`;

        const createdRun = await tx.productionRun.create({
          data: {
            runCode,
            finishedItemId,
            batches: batchesDec,
            expectedOutputQty,
            actualOutputQty,
            damagedPouchesQty,
            cartonsUsedQty,
            labourCostPaisa,
            overheadCostPaisa,
            yieldVariancePct,
            isYieldFlagged,
            costPerPacketPaisa,
            createdById: userId,
            consumptions: {
              create: materialDetails.map((m) => ({
                itemId: m.itemId,
                plannedQty: m.plannedQty,
                actualQty: m.actualQty,
                variancePct: m.variancePct,
                isFlagged: m.isFlagged,
                unitCostPaisa: m.wacPaisa,
              })),
            },
          },
          include: {
            consumptions: true,
          },
        });

        // Step (b): Deduct raw materials & packaging via negative PRODUCTION_ISSUE rows
        for (const m of materialDetails) {
          await tx.stockLedger.create({
            data: {
              itemId: m.itemId,
              qtyDelta: m.actualQty.neg(),
              unitCostPaisa: m.wacPaisa,
              sourceType: "PRODUCTION_ISSUE",
              sourceId: createdRun.id,
              notes: `Production issue for ${runCode}`,
              createdById: userId,
            },
          });
        }

        if (pouchesUsedQty > 0 && finishedItem.pouchItemId) {
          await tx.stockLedger.create({
            data: {
              itemId: finishedItem.pouchItemId,
              qtyDelta: new Decimal(pouchesUsedQty).neg(),
              unitCostPaisa: pouchWac,
              sourceType: "PRODUCTION_ISSUE",
              sourceId: createdRun.id,
              notes: `Pouches (${actualOutputQty} good + ${damagedPouchesQty} damaged) for ${runCode}`,
              createdById: userId,
            },
          });
        }

        if (cartonsUsedQty > 0 && finishedItem.cartonItemId) {
          await tx.stockLedger.create({
            data: {
              itemId: finishedItem.cartonItemId,
              qtyDelta: new Decimal(cartonsUsedQty).neg(),
              unitCostPaisa: cartonWac,
              sourceType: "PRODUCTION_ISSUE",
              sourceId: createdRun.id,
              notes: `Cartons used for ${runCode}`,
              createdById: userId,
            },
          });
        }

        // Step (e): Append positive PRODUCTION_OUTPUT row for the finished good
        await tx.stockLedger.create({
          data: {
            itemId: finishedItemId,
            qtyDelta: new Decimal(actualOutputQty),
            unitCostPaisa: new Decimal(costPerPacketPaisa),
            sourceType: "PRODUCTION_OUTPUT",
            sourceId: createdRun.id,
            notes: `Production output for ${runCode}`,
            createdById: userId,
          },
        });

        // Step (f): Write AuditLog
        await tx.auditLog.create({
          data: {
            entityType: "ProductionRun",
            entityId: createdRun.id,
            action: "CREATE",
            userId,
            newData: {
              runCode,
              finishedItemId,
              expectedOutputQty,
              actualOutputQty,
              yieldVariancePct: yieldVariancePct.toString(),
              isYieldFlagged,
              costPerPacketPaisa,
            },
          },
        });

        return createdRun;
      });

      res.status(201).json(run);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      throw err;
    }
  }
);

/**
 * GET /api/production-runs
 * Allowed roles: PRODUCTION, ADMIN, AUDITOR, OWNER
 */
productionRouter.get(
  "/",
  requireRole("PRODUCTION", "ADMIN", "AUDITOR", "OWNER"),
  async (_req: Request, res: Response) => {
    const runs = await prisma.productionRun.findMany({
      include: { consumptions: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ runs });
  }
);

/**
 * GET /api/production-runs/:id/trace
 * FSSAI Batch-to-Customer Traceability (read-only, zero schema changes)
 * Allowed roles: PRODUCTION, ADMIN, AUDITOR, OWNER
 */
productionRouter.get(
  "/:id/trace",
  requireRole("PRODUCTION", "ADMIN", "AUDITOR", "OWNER"),
  async (req: Request, res: Response) => {
    const runId = String(req.params.id);

    const run = await prisma.productionRun.findUnique({
      where: { id: runId },
      include: { consumptions: true },
    });

    if (!run) {
      res.status(404).json({ error: `Production run not found: ${runId}` });
      return;
    }

    // Get all items for name lookups
    const items = await prisma.item.findMany();
    const itemMap = new Map(items.map((i) => [i.id, i]));

    // 1. Raw material purchases: find purchases that happened before the run date
    //    and contributed items used in this run
    const usedItemIds = run.consumptions.map((c) => c.itemId);
    const purchases = await prisma.purchase.findMany({
      where: {
        purchaseDate: { lte: run.createdAt },
        lines: { some: { itemId: { in: usedItemIds } } },
      },
      include: { supplier: true, lines: { where: { itemId: { in: usedItemIds } } } },
      orderBy: { purchaseDate: "desc" },
      take: 10,
    });

    const rawMaterialPurchases = purchases.flatMap((p) =>
      p.lines.map((l) => ({
        supplierName: p.supplier.name,
        supplierState: p.supplier.stateCode,
        lotNo: p.invoiceNo,
        purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
        itemName: itemMap.get(l.itemId)?.name ?? l.itemId,
        qty: l.qty.toString(),
        unit: itemMap.get(l.itemId)?.unit ?? "",
      }))
    );

    // 2. Production batch details
    const finishedItem = itemMap.get(run.finishedItemId);
    const batch = {
      runCode: run.runCode,
      runDate: run.createdAt.toISOString().slice(0, 10),
      finishedItemName: finishedItem?.name ?? run.finishedItemId,
      batches: run.batches.toString(),
      expectedOutputQty: run.expectedOutputQty,
      actualOutputQty: run.actualOutputQty,
      yieldVariancePct: run.yieldVariancePct.toString(),
      isYieldFlagged: run.isYieldFlagged,
      costPerPacketPaisa: run.costPerPacketPaisa,
      consumptions: run.consumptions.map((c) => ({
        itemName: itemMap.get(c.itemId)?.name ?? c.itemId,
        plannedQty: c.plannedQty.toString(),
        actualQty: c.actualQty.toString(),
        variancePct: c.variancePct.toString(),
        isFlagged: c.isFlagged,
      })),
    };

    // 3. Dispatched customers: find invoices for the finished item that were dispatched
    //    after (or on) the production run date — these are the likely customers for this batch
    const dispatchedInvoices = await prisma.invoice.findMany({
      where: {
        status: "POSTED",
        dispatchedAt: { not: null, gte: run.createdAt },
        creditNoteForId: null,
        order: {
          lines: { some: { itemId: run.finishedItemId } },
        },
      },
      include: {
        order: {
          include: {
            customer: true,
            lines: { where: { itemId: run.finishedItemId } },
          },
        },
        payments: true,
      },
      orderBy: { dispatchedAt: "asc" },
      take: 20,
    });

    const dispatchedCustomers = dispatchedInvoices.map((inv) => {
      const totalPaid = inv.payments.reduce((s, p) => s + p.amountPaisa, 0);
      const qty = inv.order?.lines.reduce((s, l) => s + l.qty, 0) ?? 0;
      return {
        invoiceNumber: inv.invoiceNumber,
        dispatchDate: inv.dispatchedAt?.toISOString().slice(0, 10) ?? "",
        customerName: inv.order?.customer.name ?? "—",
        stateCode: inv.order?.customer.stateCode ?? "—",
        qty,
        totalPaisa: inv.totalPaisa,
        paidPaisa: totalPaid,
        outstandingPaisa: Math.max(0, inv.totalPaisa - totalPaid),
        invoiceStatus: inv.status,
      };
    });

    res.json({
      runId: run.id,
      traceGeneratedAt: new Date().toISOString(),
      rawMaterialPurchases,
      batch,
      dispatchedCustomers,
    });
  }
);
