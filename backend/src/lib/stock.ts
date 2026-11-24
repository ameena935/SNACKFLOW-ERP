/**
 * stock.ts – Stock balance helpers.
 *
 * RULE: Current stock is NEVER stored on Item. It is always derived
 *       from SUM(qtyDelta) in StockLedger inside a PG transaction.
 */

import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Returns the current on-hand quantity for an item.
 * Uses an aggregate SUM inside the same connection/transaction.
 */
export async function getCurrentStock(itemId: string, db: DbClient = prisma): Promise<Decimal> {
  const result = await db.stockLedger.aggregate({
    where: { itemId },
    _sum: { qtyDelta: true },
  });
  return result._sum.qtyDelta ?? new Decimal(0);
}

/**
 * Returns the current Moving Weighted Average Cost (WAC) in paisa for an item.
 *
 * Replays ledger chronologically:
 * - On IN (qtyDelta > 0): newWAC = (prevQty * prevWAC + qtyDelta * unitCostPaisa) / (prevQty + qtyDelta)
 * - On OUT (qtyDelta < 0): quantity decreases, WAC stays unchanged
 *
 * Returns Decimal(0) if no stock / no IN rows exist.
 */
export async function getCurrentWAC(itemId: string, db: DbClient = prisma): Promise<Decimal> {
  const rows = await db.stockLedger.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { qtyDelta: true, unitCostPaisa: true },
  });

  if (rows.length === 0) return new Decimal(0);

  let runningQty = new Decimal(0);
  let runningWac = new Decimal(0);

  for (const row of rows) {
    if (row.qtyDelta.gt(0)) {
      const newQty = runningQty.add(row.qtyDelta);
      if (newQty.gt(0)) {
        const totalValue = runningQty
          .mul(runningWac)
          .add(row.qtyDelta.mul(row.unitCostPaisa));
        runningWac = totalValue.div(newQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      }
      runningQty = newQty;
    } else {
      runningQty = runningQty.add(row.qtyDelta);
      if (runningQty.lte(0)) {
        runningQty = new Decimal(0);
      }
    }
  }

  return runningWac;
}

/**
 * Snapshot of an item's stock position.
 */
export interface StockPosition {
  itemId: string;
  onHandQty: Decimal;
  wacPaisa: Decimal; // Weighted average cost per unit in paisa (4 decimal places)
}

export async function getStockPosition(itemId: string, db: DbClient = prisma): Promise<StockPosition> {
  const [onHandQty, wacPaisa] = await Promise.all([
    getCurrentStock(itemId, db),
    getCurrentWAC(itemId, db),
  ]);
  return { itemId, onHandQty, wacPaisa };
}
