/**
 * backend/prisma/seed.ts
 *
 * Idempotent seed – safe to run multiple times.
 * Uses upsert / findFirst guards everywhere so a second run is a no-op.
 *
 * Financial rule: ALL money stored as integer PAISA. No floats.
 * Quantities & WAC: Prisma Decimal (Decimal.js under the hood).
 */

import { PrismaClient, Role, ItemType, LedgerSourceType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// ─── constants ───────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 10;
const SEED_USER_ID = "00000000-0000-0000-0000-000000000001"; // synthetic "system" id for seed ledger rows

// ─── helpers ─────────────────────────────────────────────────────────────────
async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function dec(value: number | string): Decimal {
  return new Decimal(value);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱  Starting seed…");

  // ── 1. Users ──────────────────────────────────────────────────────────────
  const usersToSeed: {
    email: string;
    name: string;
    role: Role;
  }[] = [
    { email: "salesmanA@factory.in", name: "Salesman A", role: "SALESMAN" },
    { email: "salesmanB@factory.in", name: "Salesman B", role: "SALESMAN" },
    { email: "admin@factory.in", name: "Admin User", role: "ADMIN" },
    { email: "floor@factory.in", name: "Floor Operator", role: "PRODUCTION" },
    { email: "auditor@factory.in", name: "Auditor", role: "AUDITOR" },
    { email: "owner@factory.in", name: "Owner", role: "OWNER" },
  ];

  const passwordHash = await hashPassword("password123");

  for (const u of usersToSeed) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
      },
    });
  }
  console.log(`  ✅  ${usersToSeed.length} users upserted`);

  // ── 2. Supplier ───────────────────────────────────────────────────────────
  const supplier = await prisma.supplier.upsert({
    where: { id: "sup-kaveri-agro-mills" },
    update: {},
    create: {
      id: "sup-kaveri-agro-mills",
      name: "Kaveri Agro Mills",
      stateCode: "TN",
      gstin: "33AAACK1234F1Z5",
    },
  });
  console.log(`  ✅  Supplier: ${supplier.name}`);

  // ── 3. Customers ──────────────────────────────────────────────────────────
  await prisma.customer.upsert({
    where: { id: "cust-retailer-a" },
    update: {},
    create: {
      id: "cust-retailer-a",
      name: "Retailer A",
      type: "RETAILER",
      stateCode: "TN",
      gstin: "33AABCU9603R1ZM",
    },
  });

  await prisma.customer.upsert({
    where: { id: "cust-distributor-b" },
    update: {},
    create: {
      id: "cust-distributor-b",
      name: "Distributor B",
      type: "DISTRIBUTOR",
      stateCode: "KA",
      gstin: "29AABCU9603R1ZK",
    },
  });
  console.log("  ✅  2 customers upserted");

  // ── 4. Items ──────────────────────────────────────────────────────────────
  // We use deterministic IDs so ledger upserts are also idempotent.
  const itemDefs: {
    id: string;
    sku: string;
    name: string;
    type: ItemType;
    unit: string;
    hsnCode?: string;
    gstRateBps?: number;
    sellingPricePaisa?: number;
    openingQty: number | string;
    openingUnitCostPaisa: number | string; // integer paisa
  }[] = [
    {
      id: "item-flour",
      sku: "RM-FLOUR-001",
      name: "Flour",
      type: "RAW_MATERIAL",
      unit: "kg",
      openingQty: 100,
      openingUnitCostPaisa: 4200, // ₹42/kg
    },
    {
      id: "item-oil",
      sku: "RM-OIL-001",
      name: "Cooking Oil",
      type: "RAW_MATERIAL",
      unit: "litre",
      openingQty: 30,
      openingUnitCostPaisa: 14000, // ₹140/L
    },
    {
      id: "item-spice",
      sku: "RM-SPICE-001",
      name: "Salt and Spice Mix",
      type: "RAW_MATERIAL",
      unit: "kg",
      openingQty: 5,
      openingUnitCostPaisa: 20000, // ₹200/kg
    },
    {
      id: "item-pouch-200g",
      sku: "PKG-POUCH-200G",
      name: "200g Pouch",
      type: "PACKAGING",
      unit: "piece",
      openingQty: 500,
      openingUnitCostPaisa: 250, // ₹2.50/pc
    },
    {
      id: "item-carton-20pk",
      sku: "PKG-CARTON-20PK",
      name: "Carton 20-pack",
      type: "PACKAGING",
      unit: "piece",
      openingQty: 30,
      openingUnitCostPaisa: 1500, // ₹15/pc
    },
    {
      id: "item-murukku-200g",
      sku: "FG-MURUKKU-200G",
      name: "Murukku 200g",
      type: "FINISHED_GOOD",
      unit: "packet",
      hsnCode: "2106",
      gstRateBps: 500, // 5%
      sellingPricePaisa: 5000, // ₹50
      openingQty: 50,
      openingUnitCostPaisa: 5000, // placeholder WAC for opening stock
    },
  ];

  for (const item of itemDefs) {
    await prisma.item.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        sku: item.sku,
        name: item.name,
        type: item.type,
        unit: item.unit,
        hsnCode: item.hsnCode,
        gstRateBps: item.gstRateBps ?? 0,
        sellingPricePaisa: item.sellingPricePaisa ?? 0,
      },
    });
  }
  console.log(`  ✅  ${itemDefs.length} items upserted`);

  // ── 5. Recipe (Two-Tier BOM) ───────────────────────────────────────────────
  const recipe = await prisma.recipe.upsert({
    where: { id: "recipe-murukku-bulk-mix" },
    update: {},
    create: {
      id: "recipe-murukku-bulk-mix",
      name: "Murukku Bulk Mix",
      batchYieldG: 40000, // 200 packets × 200 g
      lines: {
        createMany: {
          data: [
            { itemId: "item-flour", qtyPerBatch: dec(40) },   // 40 kg Flour
            { itemId: "item-oil", qtyPerBatch: dec(10) },     // 10 L Oil
            { itemId: "item-spice", qtyPerBatch: dec("1.2") }, // 1.2 kg Spice Mix
          ],
          skipDuplicates: true,
        },
      },
    },
  });

  // Link Murukku 200g to recipe
  await prisma.item.update({
    where: { id: "item-murukku-200g" },
    data: {
      recipeId: recipe.id,
      packWeightG: 200,
      packetsPerCarton: 20,
      pouchItemId: "item-pouch-200g",
      cartonItemId: "item-carton-20pk",
    },
  });
  console.log(`  ✅  Recipe "${recipe.name}" upserted & linked`);

  // ── 6. Opening Stock Ledger Entries ───────────────────────────────────────
  // Idempotent: check for existing OPENING rows per item before inserting.
  for (const item of itemDefs) {
    const existing = await prisma.stockLedger.findFirst({
      where: {
        itemId: item.id,
        sourceType: "OPENING",
        sourceId: "SEED",
      },
    });

    if (!existing) {
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          qtyDelta: dec(item.openingQty),
          unitCostPaisa: dec(item.openingUnitCostPaisa),
          sourceType: "OPENING",
          sourceId: "SEED",
          notes: "Opening stock from seed",
          createdById: SEED_USER_ID,
        },
      });
      console.log(
        `     📦  Opening stock: ${item.name} → qty ${item.openingQty} @ ${item.openingUnitCostPaisa} paisa`
      );
    } else {
      console.log(`     ⏭️   Opening stock already exists for ${item.name}, skipping`);
    }
  }

  console.log("\n🎉  Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌  Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
