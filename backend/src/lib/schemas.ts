/**
 * Zod schemas for shared validation across the backend.
 * All monetary fields validated as non-negative integers (paisa).
 * All qty fields validated as strings or numbers convertible to Prisma Decimal.
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/** Non-negative integer paisa value */
export const paisaSchema = z
  .number()
  .int("Monetary value must be an integer (paisa)")
  .nonnegative("Monetary value must be ≥ 0");

/** Decimal quantity as a string or positive number (compatible with Prisma Decimal) */
export const decimalQtySchema = z
  .union([z.string(), z.number()])
  .transform((val) => String(val))
  .refine(
    (val) => /^\d+(\.\d{1,4})?$/.test(val) && Number(val) > 0,
    "Quantity must be a positive decimal with up to 4 decimal places"
  );

/** Non-empty ID (supports both UUIDs and deterministic seed IDs) */
export const idSchema = z.string().min(1, "ID is required");

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
  itemId: idSchema,
  qty: decimalQtySchema,
  unitRatePaisa: paisaSchema,
});

export const createPurchaseSchema = z.object({
  supplierId: idSchema,
  invoiceNo: z.string().min(1),
  purchaseDate: z.string().datetime().optional(),
  lines: z.array(purchaseLineSchema).min(1),
});

// ── Production ────────────────────────────────────────────────────────────────
export const createProductionRunSchema = z.object({
  finishedItemId: idSchema,
  batches: decimalQtySchema,
  actualOutputQty: z.number().int().positive(),
  damagedPouchesQty: z.number().int().nonnegative().default(0),
  cartonsUsedQty: z.number().int().nonnegative().default(0),
  labourCostPaisa: paisaSchema.default(0),
  overheadCostPaisa: paisaSchema.default(0),
  actualConsumptions: z
    .array(
      z.object({
        itemId: idSchema,
        actualQty: decimalQtySchema,
      })
    )
    .min(1),
});

// ── Order ─────────────────────────────────────────────────────────────────────
export const orderLineSchema = z.object({
  itemId: idSchema,
  qty: z.number().int().positive(),
});

export const createOrderSchema = z.object({
  customerId: idSchema,
  clientOrderId: z.string().min(1).optional(),
  lines: z.array(orderLineSchema).min(1),
});

export const approveOrderSchema = z
  .object({
    lines: z
      .array(
        z.object({
          itemId: idSchema,
          qty: z.number().int().positive(),
          unitPricePaisa: paisaSchema,
        })
      )
      .min(1)
      .optional(),
  })
  .optional();

// ── Payment ───────────────────────────────────────────────────────────────────
export const createPaymentSchema = z.object({
  invoiceId: idSchema,
  amountPaisa: z.number().int().positive("Payment amount must be > 0 paisa"),
  mode: z.enum(["UPI", "NEFT", "CASH", "CHEQUE"]),
  paidAt: z.string().datetime().optional(),
});

// ── Adjustment ────────────────────────────────────────────────────────────────
export const stockAdjustmentSchema = z.object({
  itemId: idSchema,
  qtyDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/, "Delta must be a signed decimal"),
  unitCostPaisa: paisaSchema,
  notes: z.string().min(1),
});
