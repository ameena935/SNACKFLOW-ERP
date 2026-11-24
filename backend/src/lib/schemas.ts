/**
 * Zod schemas for shared validation across the backend.
 * All monetary fields validated as non-negative integers (paisa).
 * All qty fields validated as strings (Prisma Decimal-compatible).
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/** Non-negative integer paisa value */
export const paisaSchema = z
  .number()
  .int("Monetary value must be an integer (paisa)")
  .nonnegative("Monetary value must be ≥ 0");

/** Decimal quantity as a string (compatible with Prisma Decimal) */
export const decimalQtySchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Quantity must be a positive decimal with up to 4 decimal places");

/** UUID */
export const uuidSchema = z.string().uuid();

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// ── Item ──────────────────────────────────────────────────────────────────────
export const createItemSchema = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]),
  unit: z.enum(["kg", "litre", "piece", "packet", "carton"]),
  hsnCode: z.string().optional(),
  gstRateBps: z.number().int().nonnegative().default(0),
  sellingPricePaisa: paisaSchema.default(0),
  reorderLevel: decimalQtySchema.optional(),
});

// ── Purchase ──────────────────────────────────────────────────────────────────
export const purchaseLineSchema = z.object({
  itemId: uuidSchema,
  qty: decimalQtySchema,
  unitRatePaisa: paisaSchema,
});

export const createPurchaseSchema = z.object({
  supplierId: uuidSchema,
  invoiceNo: z.string().min(1),
  purchaseDate: z.string().datetime().optional(),
  lines: z.array(purchaseLineSchema).min(1),
});

// ── Production ────────────────────────────────────────────────────────────────
export const createProductionRunSchema = z.object({
  finishedItemId: uuidSchema,
  batches: decimalQtySchema,
  actualOutputQty: z.number().int().positive(),
  damagedPouchesQty: z.number().int().nonnegative().default(0),
  cartonsUsedQty: z.number().int().nonnegative().default(0),
  labourCostPaisa: paisaSchema.default(0),
  overheadCostPaisa: paisaSchema.default(0),
  consumptions: z.array(
    z.object({
      itemId: uuidSchema,
      actualQty: decimalQtySchema,
    })
  ),
});

// ── Order ─────────────────────────────────────────────────────────────────────
export const orderLineSchema = z.object({
  itemId: uuidSchema,
  qty: z.number().int().positive(),
  unitPricePaisa: paisaSchema,
});

export const createOrderSchema = z.object({
  customerId: uuidSchema,
  lines: z.array(orderLineSchema).min(1),
});

// ── Adjustment ────────────────────────────────────────────────────────────────
export const stockAdjustmentSchema = z.object({
  itemId: uuidSchema,
  qtyDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/, "Delta must be a signed decimal"),
  unitCostPaisa: paisaSchema,
  notes: z.string().min(1),
});
