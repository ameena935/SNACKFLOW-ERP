# CrispLedger — Order-to-Audit Mini-ERP

**CrispLedger** is an Order-to-Audit Mini-ERP built for a small South Indian snack manufacturer, linking field sales, recipe-driven batch production, GST invoicing, and statutory auditing around a single immutable `StockLedger`. Every stock balance is derived on the fly via `SUM(StockLedger.qtyDelta)` inside PostgreSQL transactions—no mutable `current_stock` column exists anywhere in the schema.

---

## Tech Stack & Justification

We chose **Node.js + Express + TypeScript + Prisma + PostgreSQL 16** for the backend so that every purchase, production run, dispatch, and payment executes inside ACID database transactions with zero-drift integer-paisa monetary math and `Decimal.js` quantities. **React + Vite + Tailwind CSS** powers a fast, role-restricted frontend with mobile-first salesman entry, tablet-friendly Tamil/English production floor screens, and desktop admin/auditor/owner consoles. **Docker Compose** packages PostgreSQL 16 for a deterministic, one-command local startup alongside an automated Vitest benchmark suite (`npm test`).

---

## Quick Start (Run Locally)

### 1. Start PostgreSQL 16
```powershell
docker-compose up -d
```

### 2. Install Dependencies, Migrate & Seed
```powershell
# Backend
cd backend
npm install
npx prisma migrate dev
npm run prisma:seed
npm run verify:seed

# Frontend
cd ../frontend
npm install
```

### 3. Run Automated Unit & Benchmark E2E Tests
```powershell
cd backend
npm test
```

### 4. Start Dev Servers
```powershell
# Terminal 1 — Backend (http://localhost:4000)
cd backend
npm run dev

# Terminal 2 — Frontend (http://localhost:5173, proxies /api -> 4000)
cd frontend
npm run dev
```

---

## Test Logins (`password123` for all accounts)

The login screen also includes **1-Click Quick-Fill** buttons for every role below:

| Role | Name | Email | Password | Workspace |
|---|---|---|---|---|
| `SALESMAN` | Salesman A | `salesmanA@factory.in` | `password123` | Mobile Order Entry + Offline Queue (own orders only) |
| `SALESMAN` | Salesman B | `salesmanB@factory.in` | `password123` | Mobile Order Entry + Offline Queue (own orders only) |
| `ADMIN` | Admin User | `admin@factory.in` | `password123` | Order Approval, 1-Click MTO Plan, GST Invoicing/PDF, Dispatch, Payments |
| `PRODUCTION` | Floor Operator | `floor@factory.in` | `password123` | Raw Material Purchases, BOM Production Runs, Tamil/English Toggle |
| `AUDITOR` | Auditor | `auditor@factory.in` | `password123` | Read-Only Reports (JSON/CSV/XLSX/PDF) + 1-Click Integrity Check |
| `OWNER` | Owner | `owner@factory.in` | `password123` | Executive KPI Dashboard (Orders, Stock, Alerts, Margin, Dues) |

---

## Feature Checklist vs. Section 6 Tiers

### Must-Haves
- [x] Role-based JWT authentication & strict `requireRole(...)` enforcement across all APIs
- [x] Immutable `StockLedger` as the single source of truth (zero mutable stock columns)
- [x] Integer-paisa monetary storage (`₹50.00 = 5000`) & `Decimal.js` quantities/WAC
- [x] Purchase recording with automatic Moving Weighted Average Cost (WAC) updates
- [x] Two-Tier BOM (`Recipe` -> `Item`) production runs with planned vs. actual variance (`>3%` flagged)
- [x] Salesman order entry, Admin stock-check & approval/edit/reject
- [x] GST Tax Invoicing (`CGST+SGST` for intra-state `TN`, `IGST` for inter-state `KA`), sequential FY numbering (`INV/2026-27/0001`), Credit Note cancellation, and `pdfkit` PDF export
- [x] Dispatch stock deduction & Payment/Receivables ageing (`0–30`, `31–60`, `60+` days)
- [x] Full `AuditLog` trail on all mutations

### Should-Haves
- [x] 6 Auditor reports (`sales-register`, `gst-summary`, `purchase-register`, `stock-summary`, `production`, `receivables`) with date-range filtering
- [x] Export to **Excel (`.xlsx`)**, **CSV (`.csv`)**, and **PDF (`.pdf`)** via `exceljs` and `pdfkit`
- [x] Owner Executive KPI Dashboard (today's orders, stock levels, variance alerts, cost vs. margin, outstanding dues)
- [x] WhatsApp invoice share link & idempotent `clientOrderId` support

### Stretch Goals
- [x] **Offline Order Queue** (`localStorage` + `navigator.onLine` auto-sync with `"Pending Sync"` badges)
- [x] **1-Click Make-to-Order Shortage Resolver** (`POST /api/orders/:id/plan-production`)
- [x] **English / தமிழ் (Tamil)** language toggle on the Production Floor console
- [x] **1-Click Auditor System Integrity Check** (`GET /api/reports/integrity-check`)
- [x] **Automated Section 5 Benchmark Test Suite** (`backend/src/test/benchmark-production.test.ts` & `benchmark-e2e.test.ts`)

---

## Section 5 Benchmark Results

Verified by `npm test` (`16/16` tests passing in `backend/src/test/`):

| Checkpoint | Expected | Actual (Verified) | Status |
|---|---|---|---|
| Flour Closing & WAC (after 60 kg @ ₹45 + 40 kg issue) | `120 kg`, `₹43.125/kg` | `120 kg`, `4312.5 paisa/kg` | Pass |
| Cooking Oil Closing & Variance (10.5 L vs 10 L planned) | `19.5 L`, `+5%`, Flagged | `19.5 L`, `5%`, `isFlagged = true` | Pass |
| 200g Pouches Closing (500 - 188 good - 6 damaged) | `306 pcs` | `306 pcs` | Pass |
| Finished Murukku 200g after Run #1 (50 + 188) | `238 pkts`, `-6%` yield, Flagged | `238 pkts`, `-6%`, `isYieldFlagged = true` | Pass |
| Cost per Packet (WAC + Packaging + ₹1,200 Labour + ₹600 OH) | `₹31.14` (`3114 paisa`) | `3114 paisa` | Pass |
| Retailer A (TN) 150-pkt GST Invoice | `₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875` | `750000 + 18750 + 18750 = 787500 paisa` | Pass |
| Finished Murukku 200g after Retailer A Dispatch | `88 pkts` (`238 - 150`) | `88 pkts` | Pass |
| Distributor B (KA) 120-pkt Order Shortage & IGST | Short `32 pkts`, `1 batch`, `5% IGST` (`₹300`) | `shortageQty = 32`, `recommendedBatches = 1`, `igstPaisa = 30000` | Pass |
| Retailer A Payment ₹4,000 -> Outstanding | `₹3,875` (`387500 paisa`) | `387500 paisa` | Pass |

---

## Assumptions & Known Gaps

- **Factory Location & Tax Regime:** The factory is assumed to be registered in Tamil Nadu (`stateCode = "TN"`). Intra-state (`TN`) invoices split GST equally into CGST + SGST; inter-state (`KA`, etc.) invoices apply IGST.
- **Variance Tolerance:** Consumption and yield variances exceeding `±3%` are automatically flagged (`isFlagged = true`).
- **Costing Method:** Raw materials and packaging use Moving Weighted Average Cost (WAC); production runs allocate labour and overhead directly across good output packets (`Direct Run Overhead Allocation`).
- **External Integrations:** No live GSTN / e-Invoice IRN / e-Way Bill API or WhatsApp Business API integration is included—WhatsApp sharing uses a standard `wa.me` deep link, and PDFs are generated locally via `pdfkit`.
- **Credit Notes:** Cancelling a posted invoice marks it `CANCELLED` and creates a linked Credit Note row (`creditNoteForId`) without reversing physical dispatch stock automatically (returns/restock would be a separate `ADJUSTMENT` entry).
