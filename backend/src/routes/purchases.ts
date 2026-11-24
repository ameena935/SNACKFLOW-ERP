import { Router, Request, Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma";
import { createPurchaseSchema } from "../lib/schemas";
import { HttpError } from "../lib/errors";
import { authenticate, requireRole } from "../middleware/auth";

export const purchasesRouter = Router();

purchasesRouter.use(authenticate);

/**
 * POST /api/purchases
 * Allowed roles: ADMIN, PRODUCTION
 * Creates Purchase + PurchaseLines, appends PURCHASE rows to StockLedger, and writes AuditLog.
 */
purchasesRouter.post(
  "/",
  requireRole("ADMIN", "PRODUCTION"),
  async (req: Request, res: Response) => {
    const parsed = createPurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid purchase payload", details: parsed.error.flatten() });
      return;
    }

    const { supplierId, invoiceNo, purchaseDate, lines } = parsed.data;
    const userId = req.user!.userId;

    try {
      const purchase = await prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) {
          throw new HttpError(404, `Supplier not found: ${supplierId}`);
        }

        const itemIds = [...new Set(lines.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
        if (items.length !== itemIds.length) {
          const found = new Set(items.map((i) => i.id));
          const missing = itemIds.filter((id) => !found.has(id));
          throw new HttpError(404, `Item(s) not found: ${missing.join(", ")}`);
        }

        // Compute totalPaisa using Decimal arithmetic to avoid float drift
        let totalPaisa = 0;
        for (const line of lines) {
          const lineTotal = new Decimal(line.qty)
            .mul(line.unitRatePaisa)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber();
          totalPaisa += lineTotal;
        }

        const created = await tx.purchase.create({
          data: {
            supplierId,
            invoiceNo,
            purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
            totalPaisa,
            createdById: userId,
            lines: {
              create: lines.map((line) => ({
                itemId: line.itemId,
                qty: new Decimal(line.qty),
                unitRatePaisa: line.unitRatePaisa,
              })),
            },
          },
          include: {
            supplier: true,
            lines: true,
          },
        });

        // Append immutable StockLedger PURCHASE rows (positive qtyDelta)
        for (const line of lines) {
          await tx.stockLedger.create({
            data: {
              itemId: line.itemId,
              qtyDelta: new Decimal(line.qty),
              unitCostPaisa: new Decimal(line.unitRatePaisa),
              sourceType: "PURCHASE",
              sourceId: created.id,
              notes: `Purchase ${invoiceNo}`,
              createdById: userId,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            entityType: "Purchase",
            entityId: created.id,
            action: "CREATE",
            userId,
            newData: {
              supplierId,
              invoiceNo,
              totalPaisa,
              lineCount: lines.length,
            },
          },
        });

        return created;
      });

      res.status(201).json(purchase);
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
 * GET /api/purchases
 * Allowed roles: ADMIN, PRODUCTION, AUDITOR, OWNER
 */
purchasesRouter.get(
  "/",
  requireRole("ADMIN", "PRODUCTION", "AUDITOR", "OWNER"),
  async (_req: Request, res: Response) => {
    const purchases = await prisma.purchase.findMany({
      include: {
        supplier: true,
        lines: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ purchases });
  }
);
