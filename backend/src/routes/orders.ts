import { Router, Request, Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma";
import { approveOrderSchema, createOrderSchema } from "../lib/schemas";
import { getCurrentStock } from "../lib/stock";
import { HttpError } from "../lib/errors";
import { authenticate, requireRole } from "../middleware/auth";

export const ordersRouter = Router();

ordersRouter.use(authenticate);

/**
 * POST /api/orders
 * Allowed roles: SALESMAN, ADMIN
 * Pulls unitPricePaisa from Item master sellingPricePaisa.
 * Supports idempotent clientOrderId for offline sync retries.
 */
ordersRouter.post(
  "/",
  requireRole("SALESMAN", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid order payload", details: parsed.error.flatten() });
      return;
    }

    const { customerId, clientOrderId, lines } = parsed.data;
    const userId = req.user!.userId;

    // Idempotent offline sync retry check
    if (clientOrderId) {
      const existing = await prisma.order.findUnique({
        where: { orderCode: clientOrderId },
        include: { customer: true, lines: true },
      });
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }

    try {
      const order = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) {
          throw new HttpError(404, `Customer not found: ${customerId}`);
        }

        const itemIds = [...new Set(lines.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
        if (items.length !== itemIds.length) {
          const found = new Set(items.map((i) => i.id));
          const missing = itemIds.filter((id) => !found.has(id));
          throw new HttpError(404, `Item(s) not found: ${missing.join(", ")}`);
        }

        const itemMap = new Map(items.map((i) => [i.id, i]));
        const count = await tx.order.count();
        const orderCode =
          clientOrderId ??
          `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

        const created = await tx.order.create({
          data: {
            orderCode,
            customerId,
            salesmanId: userId,
            status: "SUBMITTED",
            lines: {
              create: lines.map((line) => ({
                itemId: line.itemId,
                qty: line.qty,
                unitPricePaisa: itemMap.get(line.itemId)!.sellingPricePaisa,
              })),
            },
          },
          include: {
            customer: true,
            lines: true,
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Order",
            entityId: created.id,
            action: "CREATE",
            userId,
            newData: {
              orderCode: created.orderCode,
              customerId,
              lineCount: lines.length,
            },
          },
        });

        return created;
      });

      res.status(201).json(order);
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
 * GET /api/orders
 * SALESMAN sees only their own orders + customer-wise sales summary.
 * ADMIN, OWNER, AUDITOR see all orders + customer-wise sales summary.
 */
ordersRouter.get(
  "/",
  requireRole("SALESMAN", "ADMIN", "OWNER", "AUDITOR"),
  async (req: Request, res: Response) => {
    const where =
      req.user!.role === "SALESMAN" ? { salesmanId: req.user!.userId } : {};

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: true,
        lines: true,
        invoice: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const summaryMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        stateCode: string;
        orderCount: number;
        totalValuePaisa: number;
      }
    >();

    for (const order of orders) {
      const orderTotal = order.lines.reduce(
        (sum, l) => sum + l.qty * l.unitPricePaisa,
        0
      );
      const existing = summaryMap.get(order.customerId) ?? {
        customerId: order.customerId,
        customerName: order.customer.name,
        stateCode: order.customer.stateCode,
        orderCount: 0,
        totalValuePaisa: 0,
      };
      existing.orderCount += 1;
      existing.totalValuePaisa += orderTotal;
      summaryMap.set(order.customerId, existing);
    }

    res.json({
      orders,
      customerSummary: Array.from(summaryMap.values()),
    });
  }
);

/**
 * Helper to compute live shortages and recommended batches for an order.
 */
async function computeOrderShortages(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });

  if (!order) {
    throw new HttpError(404, `Order not found: ${orderId}`);
  }

  const shortages: Array<{
    itemId: string;
    itemName: string;
    orderedQty: number;
    availableQty: number;
    shortageQty: number;
    recommendedBatches: number;
    packetsPerBatch: number;
    expectedBatchOutputQty: number;
  }> = [];

  for (const line of order.lines) {
    const item = await prisma.item.findUnique({
      where: { id: line.itemId },
      include: {
        recipe: { include: { lines: true } },
      },
    });
    if (!item) {
      throw new HttpError(404, `Item not found: ${line.itemId}`);
    }

    const availableDec = await getCurrentStock(line.itemId);
    const availableQty = availableDec.toNumber();
    const shortageQty = Math.max(0, line.qty - availableQty);

    if (shortageQty > 0) {
      let packetsPerBatch = 0;
      let recommendedBatches = 0;

      if (item.recipe && item.packWeightG && item.packWeightG > 0) {
        packetsPerBatch = Math.floor(item.recipe.batchYieldG / item.packWeightG);
        if (packetsPerBatch > 0) {
          recommendedBatches = Math.ceil(shortageQty / packetsPerBatch);
        }
      }

      shortages.push({
        itemId: line.itemId,
        itemName: item.name,
        orderedQty: line.qty,
        availableQty,
        shortageQty,
        recommendedBatches,
        packetsPerBatch,
        expectedBatchOutputQty: recommendedBatches * packetsPerBatch,
      });
    }
  }

  return { order, shortages };
}

/**
 * GET /api/orders/:id/stock-check
 * Allowed roles: ADMIN
 */
ordersRouter.get(
  "/:id/stock-check",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    try {
      const { order, shortages } = await computeOrderShortages(String(req.params.id));
      res.json({
        orderId: order.id,
        sufficient: shortages.length === 0,
        shortages,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/**
 * PATCH /api/orders/:id/approve
 * Allowed roles: ADMIN
 * Allows editing qty/price before approval, sets status to APPROVED, logs to AuditLog.
 */
ordersRouter.patch(
  "/:id/approve",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = approveOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid approval payload", details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;

    const orderId = String(req.params.id);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({
          where: { id: orderId },
          include: { lines: true },
        });
        if (!existing) {
          throw new HttpError(404, `Order not found: ${orderId}`);
        }
        if (existing.status !== "SUBMITTED") {
          throw new HttpError(400, `Cannot approve order in status ${existing.status}`);
        }

        if (parsed.data?.lines) {
          await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
          await tx.orderLine.createMany({
            data: parsed.data.lines.map((l) => ({
              orderId: existing.id,
              itemId: l.itemId,
              qty: l.qty,
              unitPricePaisa: l.unitPricePaisa,
            })),
          });
        }

        const approved = await tx.order.update({
          where: { id: existing.id },
          data: { status: "APPROVED" },
          include: { customer: true, lines: true },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Order",
            entityId: existing.id,
            action: "APPROVE",
            userId,
            oldData: { status: existing.status, lines: existing.lines },
            newData: { status: approved.status, lines: approved.lines },
          },
        });

        return approved;
      });

      res.json(updated);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/**
 * PATCH /api/orders/:id/reject
 * Allowed roles: ADMIN
 */
ordersRouter.patch(
  "/:id/reject",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    const orderId = String(req.params.id);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({ where: { id: orderId } });
        if (!existing) {
          throw new HttpError(404, `Order not found: ${orderId}`);
        }
        if (existing.status !== "SUBMITTED") {
          throw new HttpError(400, `Cannot reject order in status ${existing.status}`);
        }

        const rejected = await tx.order.update({
          where: { id: existing.id },
          data: { status: "REJECTED" },
          include: { customer: true, lines: true },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Order",
            entityId: existing.id,
            action: "REJECT",
            userId,
            oldData: { status: existing.status },
            newData: { status: rejected.status },
          },
        });

        return rejected;
      });

      res.json(updated);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/**
 * POST /api/orders/:id/plan-production
 * Allowed roles: ADMIN
 * 1-Click Make-to-Order helper: computes minimum batches needed from Item's Recipe
 * and returns PLANNED production payload(s) for the Production floor.
 */
ordersRouter.post(
  "/:id/plan-production",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    try {
      const { order, shortages } = await computeOrderShortages(String(req.params.id));

      const plans = await Promise.all(
        shortages.map(async (s) => {
          const item = await prisma.item.findUnique({
            where: { id: s.itemId },
            include: { recipe: { include: { lines: true } } },
          });

          const batchesDec = new Decimal(s.recommendedBatches);
          const plannedConsumptions =
            item?.recipe?.lines.map((rl) => ({
              itemId: rl.itemId,
              plannedQty: rl.qtyPerBatch.mul(batchesDec).toString(),
            })) ?? [];

          return {
            status: "PLANNED" as const,
            finishedItemId: s.itemId,
            finishedItemName: s.itemName,
            shortageQty: s.shortageQty,
            batches: String(s.recommendedBatches),
            expectedOutputQty: s.expectedBatchOutputQty,
            plannedConsumptions,
          };
        })
      );

      await prisma.auditLog.create({
        data: {
          entityType: "Order",
          entityId: order.id,
          action: "PLAN_PRODUCTION",
          userId,
          newData: { plans },
        },
      });

      res.json({
        orderId: order.id,
        sufficient: shortages.length === 0,
        plans,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);
