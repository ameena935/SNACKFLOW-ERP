import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { createPaymentSchema } from "../lib/schemas";
import { HttpError } from "../lib/errors";
import { authenticate, requireRole } from "../middleware/auth";

export const paymentsRouter = Router();

paymentsRouter.use(authenticate);

/**
 * POST /api/payments
 * Allowed roles: ADMIN
 * Records a payment against a posted invoice and writes an AuditLog entry.
 */
paymentsRouter.post(
  "/",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payment payload", details: parsed.error.flatten() });
      return;
    }

    const { invoiceId, amountPaisa, mode, paidAt } = parsed.data;
    const userId = req.user!.userId;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          include: { payments: true },
        });

        if (!invoice) {
          throw new HttpError(404, `Invoice not found: ${invoiceId}`);
        }
        if (invoice.status === "CANCELLED" || invoice.creditNoteForId) {
          throw new HttpError(400, "Cannot record payment against a cancelled invoice or credit note");
        }

        const alreadyPaid = invoice.payments.reduce((sum, p) => sum + p.amountPaisa, 0);
        const remaining = invoice.totalPaisa - alreadyPaid;
        if (amountPaisa > remaining) {
          throw new HttpError(
            400,
            `Payment ${amountPaisa} paisa exceeds remaining invoice balance ${remaining} paisa`
          );
        }

        const payment = await tx.payment.create({
          data: {
            invoiceId,
            amountPaisa,
            mode,
            paidAt: paidAt ? new Date(paidAt) : new Date(),
            recordedBy: userId,
          },
        });

        const totalPaidPaisa = alreadyPaid + amountPaisa;
        const outstandingPaisa = invoice.totalPaisa - totalPaidPaisa;

        await tx.auditLog.create({
          data: {
            entityType: "Payment",
            entityId: payment.id,
            action: "CREATE",
            userId,
            newData: {
              invoiceId,
              amountPaisa,
              mode,
              totalPaidPaisa,
              outstandingPaisa,
            },
          },
        });

        return {
          payment,
          invoiceTotalPaisa: invoice.totalPaisa,
          totalPaidPaisa,
          outstandingPaisa,
        };
      });

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/**
 * GET /api/payments/outstanding
 * Allowed roles: ADMIN, AUDITOR, OWNER
 * Returns customer-wise total invoiced, total paid, outstanding balance,
 * and ageing buckets (0-30, 31-60, 60+ days).
 */
paymentsRouter.get(
  "/outstanding",
  requireRole("ADMIN", "AUDITOR", "OWNER"),
  async (_req: Request, res: Response) => {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: "POSTED",
        creditNoteForId: null,
        orderId: { not: null },
      },
      include: {
        order: {
          include: { customer: true },
        },
        payments: true,
      },
    });

    const nowMs = Date.now();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        stateCode: string;
        totalInvoicedPaisa: number;
        totalPaidPaisa: number;
        outstandingPaisa: number;
        ageing: {
          "0-30": number;
          "31-60": number;
          "60+": number;
        };
      }
    >();

    for (const inv of invoices) {
      if (!inv.order) continue;
      const cust = inv.order.customer;
      const paid = inv.payments.reduce((sum, p) => sum + p.amountPaisa, 0);
      const unpaid = Math.max(0, inv.totalPaisa - paid);
      const ageDays = Math.floor((nowMs - inv.createdAt.getTime()) / MS_PER_DAY);

      const entry = byCustomer.get(cust.id) ?? {
        customerId: cust.id,
        customerName: cust.name,
        stateCode: cust.stateCode,
        totalInvoicedPaisa: 0,
        totalPaidPaisa: 0,
        outstandingPaisa: 0,
        ageing: {
          "0-30": 0,
          "31-60": 0,
          "60+": 0,
        },
      };

      entry.totalInvoicedPaisa += inv.totalPaisa;
      entry.totalPaidPaisa += paid;
      entry.outstandingPaisa += unpaid;

      if (unpaid > 0) {
        if (ageDays <= 30) {
          entry.ageing["0-30"] += unpaid;
        } else if (ageDays <= 60) {
          entry.ageing["31-60"] += unpaid;
        } else {
          entry.ageing["60+"] += unpaid;
        }
      }

      byCustomer.set(cust.id, entry);
    }

    res.json({ customers: Array.from(byCustomer.values()) });
  }
);
