/**
 * money.ts – Frontend financial utilities (mirrors backend/src/lib/money.ts).
 *
 * RULE: Display only. Never perform server-side financial calculations here.
 *       All monetary computations happen in the backend with integer paisa.
 */

/** Paisa integer → formatted rupee string */
export function paisaToRupee(paisa: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paisa / 100);
}

/** Format a quantity with its unit */
export function formatQty(qty: number | string, unit: string): string {
  return `${qty} ${unit}`;
}

/** GST rate in bps → human-readable percent string */
export function formatGstRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
