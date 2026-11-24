/**
 * money.ts – Financial utility helpers.
 *
 * RULE: ALL money values are stored and computed as INTEGER PAISA.
 *       ₹1.00 = 100 paisa.  ₹50.00 = 5000 paisa.
 *       Never use floating-point for monetary arithmetic.
 */

import { Decimal } from "@prisma/client/runtime/library";

/** Paisa → formatted rupee string (e.g. 5000 → "₹50.00") */
export function paisaToRupee(paisa: number): string {
  const rupees = Math.trunc(paisa) / 100;
  return `₹${rupees.toFixed(2)}`;
}

/** Rupee float → paisa integer (round half-up). Use ONLY for user-facing input parsing. */
export function rupeeToPaisa(rupee: number): number {
  return Math.round(rupee * 100);
}

/**
 * Compute Weighted Average Cost (WAC) in PAISA.
 *
 * WAC = (currentStock × currentWAC + newQty × newUnitCost) / (currentStock + newQty)
 *
 * Uses Decimal.js to avoid floating-point drift.
 * Returns an integer (rounds to nearest paisa).
 */
export function computeWAC(
  currentQty: Decimal,
  currentWACPaisa: Decimal,
  newQty: Decimal,
  newUnitCostPaisa: Decimal
): number {
  const totalValue = currentQty
    .mul(currentWACPaisa)
    .add(newQty.mul(newUnitCostPaisa));
  const totalQty = currentQty.add(newQty);

  if (totalQty.isZero()) return 0;

  // Round to integer paisa (Decimal ROUND_HALF_UP)
  return totalValue.div(totalQty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Compute Indian GST split.
 * - Intra-state (same stateCode as factory): CGST = SGST = rate/2
 * - Inter-state (different stateCode): IGST = full rate
 *
 * @param taxablePaisa  taxable amount in paisa (integer)
 * @param gstRateBps    GST rate in basis points (500 = 5.00%)
 * @param isInterState  true → IGST; false → CGST+SGST
 */
export function computeGST(
  taxablePaisa: number,
  gstRateBps: number,
  isInterState: boolean
): { cgstPaisa: number; sgstPaisa: number; igstPaisa: number; totalPaisa: number } {
  // Use integer arithmetic; gstRateBps is in 1/100 of a percent, i.e. 1/10000 of base.
  const taxPaisa = Math.round((taxablePaisa * gstRateBps) / 10000);

  if (isInterState) {
    return { cgstPaisa: 0, sgstPaisa: 0, igstPaisa: taxPaisa, totalPaisa: taxablePaisa + taxPaisa };
  }

  const half = Math.floor(taxPaisa / 2);
  // If taxPaisa is odd, one of CGST/SGST gets +1 (truncate-floor approach is acceptable)
  return {
    cgstPaisa: half,
    sgstPaisa: taxPaisa - half,
    igstPaisa: 0,
    totalPaisa: taxablePaisa + taxPaisa,
  };
}
