import { Router, Request, Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerSourceType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getCurrentWAC } from "../lib/stock";
import { authenticate } from "../middleware/auth";

export const inventoryRouter = Router();

inventoryRouter.use(authenticate);

/**
 * GET /api/inventory/summary
 * Computes opening, receipts, issues, closing balance, and current WAC
 * directly from StockLedger (never reads any mutable stock column).
 */
inventoryRouter.get("/summary", async (_req: Request, res: Response) => {
  const items = await prisma.item.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  const ledgerEntries = await prisma.stockLedger.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const entriesByItem = new Map<string, typeof ledgerEntries>();
  for (const entry of ledgerEntries) {
    const list = entriesByItem.get(entry.itemId) ?? [];
    list.push(entry);
    entriesByItem.set(entry.itemId, list);
  }

  const summary = await Promise.all(
    items.map(async (item) => {
      const entries = entriesByItem.get(item.id) ?? [];

      let openingQty = new Decimal(0);
      let receiptsQty = new Decimal(0);
      let issuesQty = new Decimal(0);
      let closingQty = new Decimal(0);

      for (const e of entries) {
        closingQty = closingQty.add(e.qtyDelta);

        if (e.sourceType === "OPENING") {
          openingQty = openingQty.add(e.qtyDelta);
        } else if (e.qtyDelta.gt(0)) {
          receiptsQty = receiptsQty.add(e.qtyDelta);
        } else if (e.qtyDelta.lt(0)) {
          issuesQty = issuesQty.add(e.qtyDelta.abs());
        }
      }

      const wacPaisa = await getCurrentWAC(item.id);

      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        type: item.type,
        unit: item.unit,
        openingQty: openingQty.toString(),
        receiptsQty: receiptsQty.toString(),
        issuesQty: issuesQty.toString(),
        closingQty: closingQty.toString(),
        wacPaisa: wacPaisa.toString(),
      };
    })
  );

  res.json({ items: summary });
});

/**
 * GET /api/inventory/ledger
 * Query params: itemId?, sourceType?, limit?
 */
inventoryRouter.get("/ledger", async (req: Request, res: Response) => {
  const { itemId, sourceType, limit } = req.query;

  const where: {
    itemId?: string;
    sourceType?: LedgerSourceType;
  } = {};

  if (typeof itemId === "string" && itemId.length > 0) {
    where.itemId = itemId;
  }
  if (typeof sourceType === "string" && sourceType.length > 0) {
    where.sourceType = sourceType as LedgerSourceType;
  }

  const take =
    typeof limit === "string" && /^\d+$/.test(limit)
      ? Math.min(Number(limit), 500)
      : 100;

  const entries = await prisma.stockLedger.findMany({
    where,
    include: {
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          type: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });

  res.json({ entries });
});
