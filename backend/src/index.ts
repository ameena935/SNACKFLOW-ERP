import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── Routes (to be expanded) ───────────────────────────────────────────────────
// app.use("/api/auth", authRouter);
// app.use("/api/items", itemsRouter);
// app.use("/api/stock", stockRouter);
// app.use("/api/purchases", purchasesRouter);
// app.use("/api/production", productionRouter);
// app.use("/api/orders", ordersRouter);
// app.use("/api/invoices", invoicesRouter);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
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

export { app };
