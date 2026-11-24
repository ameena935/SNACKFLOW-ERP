import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { prisma } from "./lib/prisma";
import { authRouter } from "./routes/auth";
import { purchasesRouter } from "./routes/purchases";
import { productionRouter } from "./routes/production";
import { inventoryRouter } from "./routes/inventory";
import { ordersRouter } from "./routes/orders";
import { invoicesRouter } from "./routes/invoices";
import { paymentsRouter } from "./routes/payments";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/production-runs", productionRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start server (skip auto-listen during Vitest imports) ─────────────────────
if (!process.env.VITEST) {
  const server = app.listen(PORT, () => {
    console.log(`🚀  Backend listening on http://localhost:${PORT}`);
  });

  process.on("SIGTERM", async () => {
    console.log("SIGTERM received — shutting down…");
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}

export { app };
