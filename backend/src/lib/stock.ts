/**
 * stock.ts – Stock balance helpers.
 *
 * RULE: Current stock is NEVER stored on Item. It is always derived
 *       from SUM(qtyDelta) in StockLedger inside a PG transaction.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";

/**
 * Returns the current on-hand quantity for an item.
 * Uses an aggregate SUM inside the same connection.
 */
export async function getCurrentStock(itemId: string): Promise<Decimal> {
  const result = await prisma.stockLedger.aggregate({
    where: { itemId },
    _sum: { qtyDelta: true },
  });
  return result._sum.qtyDelta ?? new Decimal(0);
}

/**
 * Returns the current Weighted Average Cost (WAC) in paisa for an item.
 *
 * WAC = Σ(qtyDelta × unitCostPaisa) / Σ(qtyDelta)   [only positive IN rows]
 *
 * Returns 0 if no IN rows exist.
 */
export async function getCurrentWAC(itemId: string): Promise<Decimal> {
  // We compute WAC from all inbound (positive) ledger rows.
  const rows = await prisma.stockLedger.findMany({
    where: { itemId, qtyDelta: { gt: 0 } },
    select: { qtyDelta: true, unitCostPaisa: true },
  });

  if (rows.length === 0) return new Decimal(0);

  let totalValue = new Decimal(0);
  let totalQty = new Decimal(0);

  for (const row of rows) {
    totalValue = totalValue.add(row.qtyDelta.mul(row.unitCostPaisa));
    totalQty = totalQty.add(row.qtyDelta);
  }

  if (totalQty.isZero()) return new Decimal(0);
  return totalValue.div(totalQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Snapshot of an item's stock position.
 */
export interface StockPosition {
  itemId: string;
  onHandQty: Decimal;
  wacPaisa: Decimal; // Weighted average cost per unit in paisa (4 decimal places)
}

export async function getStockPosition(itemId: string): Promise<StockPosition> {
  const [onHandQty, wacPaisa] = await Promise.all([
    getCurrentStock(itemId),
    getCurrentWAC(itemId),
  ]);
  return { itemId, onHandQty, wacPaisa };
}
