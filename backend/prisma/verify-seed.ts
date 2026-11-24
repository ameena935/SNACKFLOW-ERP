/**
 * verify-seed.ts
 *
 * Quick verification script: connects to the DB and asserts that all 6 items
 * have exactly the expected opening balances in StockLedger.
 *
 * Run after seeding:
 *   npx ts-node --transpile-only prisma/verify-seed.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

interface ExpectedBalance {
  sku: string;
  name: string;
  expectedQty: Decimal;
  expectedUnitCostPaisa: Decimal;
}

const EXPECTED: ExpectedBalance[] = [
  { sku: "RM-FLOUR-001",    name: "Flour",              expectedQty: new Decimal(100),  expectedUnitCostPaisa: new Decimal(4200) },
  { sku: "RM-OIL-001",      name: "Cooking Oil",        expectedQty: new Decimal(30),   expectedUnitCostPaisa: new Decimal(14000) },
  { sku: "RM-SPICE-001",    name: "Salt and Spice Mix", expectedQty: new Decimal(5),    expectedUnitCostPaisa: new Decimal(20000) },
  { sku: "PKG-POUCH-200G",  name: "200g Pouch",         expectedQty: new Decimal(500),  expectedUnitCostPaisa: new Decimal(250) },
  { sku: "PKG-CARTON-20PK", name: "Carton 20-pack",     expectedQty: new Decimal(30),   expectedUnitCostPaisa: new Decimal(1500) },
  { sku: "FG-MURUKKU-200G", name: "Murukku 200g",       expectedQty: new Decimal(50),   expectedUnitCostPaisa: new Decimal(5000) },
];

async function verify() {
  console.log("\n🔍  Verifying seed data…\n");

  let allPassed = true;
  const colW = 20;

  const header = [
    "Item".padEnd(colW),
    "On-Hand Qty".padStart(12),
    "Expected".padStart(10),
    "Unit Cost (paisa)".padStart(18),
    "Expected".padStart(10),
    "Status".padStart(8),
  ].join("  ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const exp of EXPECTED) {
    const item = await prisma.item.findUnique({ where: { sku: exp.sku } });
    if (!item) {
      console.log(`❌  Item not found: ${exp.sku}`);
      allPassed = false;
      continue;
    }

    // Compute on-hand = SUM(qtyDelta) from StockLedger
    const agg = await prisma.stockLedger.aggregate({
      where: { itemId: item.id },
      _sum: { qtyDelta: true },
    });
    const onHand = agg._sum.qtyDelta ?? new Decimal(0);

    // Get opening row's unit cost
    const openingRow = await prisma.stockLedger.findFirst({
      where: { itemId: item.id, sourceType: "OPENING" },
      orderBy: { createdAt: "asc" },
    });
    const unitCost = openingRow?.unitCostPaisa ?? new Decimal(0);

    const qtyOk = onHand.equals(exp.expectedQty);
    const costOk = unitCost.equals(exp.expectedUnitCostPaisa);
    const pass = qtyOk && costOk;
    if (!pass) allPassed = false;

    const row = [
      item.name.padEnd(colW),
      onHand.toString().padStart(12),
      exp.expectedQty.toString().padStart(10),
      unitCost.toString().padStart(18),
      exp.expectedUnitCostPaisa.toString().padStart(10),
      (pass ? "✅  PASS" : "❌  FAIL").padStart(8),
    ].join("  ");
    console.log(row);
  }

  // ── Extra checks ──────────────────────────────────────────────────────────
  console.log("\n── Additional checks ──");

  // Recipe
  const recipe = await prisma.recipe.findFirst({ where: { name: "Murukku Bulk Mix" }, include: { lines: true } });
  if (!recipe) {
    console.log("❌  Recipe 'Murukku Bulk Mix' not found");
    allPassed = false;
  } else {
    console.log(`✅  Recipe: ${recipe.name} (batchYieldG=${recipe.batchYieldG}, lines=${recipe.lines.length})`);
    if (recipe.lines.length !== 3) {
      console.log("❌  Expected 3 recipe lines");
      allPassed = false;
    }
  }

  // Users
  const userCount = await prisma.user.count();
  if (userCount >= 6) {
    console.log(`✅  Users: ${userCount} found (≥ 6 expected)`);
  } else {
    console.log(`❌  Users: only ${userCount} found (expected ≥ 6)`);
    allPassed = false;
  }

  // Customers
  const custCount = await prisma.customer.count();
  if (custCount >= 2) {
    console.log(`✅  Customers: ${custCount} found`);
  } else {
    console.log(`❌  Customers: only ${custCount} found`);
    allPassed = false;
  }

  // Supplier
  const supplierCount = await prisma.supplier.count();
  if (supplierCount >= 1) {
    console.log(`✅  Suppliers: ${supplierCount} found`);
  } else {
    console.log(`❌  Suppliers: none found`);
    allPassed = false;
  }

  console.log("\n" + (allPassed ? "🎉  All checks PASSED" : "💥  Some checks FAILED"));
  process.exit(allPassed ? 0 : 1);
}

verify()
  .catch((e) => {
    console.error("Verification error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
