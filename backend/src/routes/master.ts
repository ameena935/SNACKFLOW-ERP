import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

export const masterRouter = Router();

masterRouter.use(authenticate);

/**
 * GET /api/master/items
 * Returns all items with their linked Recipe and RecipeLines.
 */
masterRouter.get("/items", async (_req: Request, res: Response) => {
  const items = await prisma.item.findMany({
    include: {
      recipe: {
        include: { lines: true },
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({ items });
});

/**
 * GET /api/master/customers
 */
masterRouter.get("/customers", async (_req: Request, res: Response) => {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
  });
  res.json({ customers });
});

/**
 * GET /api/master/suppliers
 */
masterRouter.get("/suppliers", async (_req: Request, res: Response) => {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
  });
  res.json({ suppliers });
});
