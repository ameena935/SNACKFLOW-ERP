import { Router, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma";
import { computeGST, paisaToRupee } from "../lib/money";
import { getCurrentStock, getCurrentWAC } from "../lib/stock";
import { HttpError } from "../lib/errors";
import { authenticate, requireRole } from "../middleware/auth";

export const invoicesRouter = Router();

invoicesRouter.use(authenticate);

const FACTORY_STATE_CODE = "TN";
const FACTORY_NAME = "CrispLedger Foods Pvt. Ltd.";
const FACTORY_GSTIN = "33AAACC1234F1Z5";
const FACTORY_ADDRESS = "Plot 42, SIDCO Industrial Estate, Madurai, Tamil Nadu - 625001";

function getIndianFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan, 3 = Apr
  if (month >= 3) {
    return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  }
  return `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}

/**
 * POST /api/invoices/from-order/:orderId
 * Allowed roles: ADMIN
 * Creates a sequential GST Tax Invoice (CGST+SGST for TN, IGST for other states)
 * and updates the order status to INVOICED.
 */
invoicesRouter.post(
  "/from-order/:orderId",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    const orderId = String(req.params.orderId);

    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            customer: true,
            lines: true,
            invoice: true,
          },
        });

        if (!order) {
          throw new HttpError(404, `Order not found: ${orderId}`);
        }
        if (order.invoice) {
          throw new HttpError(400, `Order ${order.orderCode} is already invoiced`);
        }
        if (order.status !== "APPROVED") {
          throw new HttpError(
            400,
            `Order ${order.orderCode} must be APPROVED before invoicing (current: ${order.status})`
          );
        }

        const itemIds = [...new Set(order.lines.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
        const itemMap = new Map(items.map((i) => [i.id, i]));

        const isInterState = order.customer.stateCode !== FACTORY_STATE_CODE;

        let taxablePaisa = 0;
        let cgstPaisa = 0;
        let sgstPaisa = 0;
        let igstPaisa = 0;
        let totalPaisa = 0;

        for (const line of order.lines) {
          const item = itemMap.get(line.itemId);
          if (!item) {
            throw new HttpError(404, `Item not found: ${line.itemId}`);
          }
          const lineTaxable = line.qty * line.unitPricePaisa;
          const gst = computeGST(lineTaxable, item.gstRateBps, isInterState);

          taxablePaisa += lineTaxable;
          cgstPaisa += gst.cgstPaisa;
          sgstPaisa += gst.sgstPaisa;
          igstPaisa += gst.igstPaisa;
          totalPaisa += gst.totalPaisa;
        }

        const now = new Date();
        const financialYear = getIndianFinancialYear(now);
        const existingInFy = await tx.invoice.count({
          where: {
            financialYear,
            creditNoteForId: null,
          },
        });
        const invoiceNumber = `INV/${financialYear}/${String(existingInFy + 1).padStart(4, "0")}`;

        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            financialYear,
            orderId: order.id,
            taxablePaisa,
            cgstPaisa,
            sgstPaisa,
            igstPaisa,
            totalPaisa,
            status: "POSTED",
            createdById: userId,
          },
          include: {
            order: {
              include: {
                customer: true,
                lines: true,
              },
            },
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: { status: "INVOICED" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Invoice",
            entityId: created.id,
            action: "CREATE",
            userId,
            newData: {
              invoiceNumber,
              financialYear,
              orderId: order.id,
              taxablePaisa,
              cgstPaisa,
              sgstPaisa,
              igstPaisa,
              totalPaisa,
            },
          },
        });

        return created;
      });

      res.status(201).json(invoice);
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
 * POST /api/invoices/:id/dispatch
 * Allowed roles: ADMIN
 * Verifies finished-goods stock in StockLedger, appends negative DISPATCH rows,
 * sets dispatchedAt, updates order status to DISPATCHED, and writes AuditLog.
 */
invoicesRouter.post(
  "/:id/dispatch",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    const invoiceId = String(req.params.id);

    try {
      const dispatched = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          include: {
            order: {
              include: {
                lines: true,
                customer: true,
              },
            },
          },
        });

        if (!invoice || !invoice.order) {
          throw new HttpError(404, `Invoice not found: ${invoiceId}`);
        }
        if (invoice.status !== "POSTED") {
          throw new HttpError(400, `Cannot dispatch invoice in status ${invoice.status}`);
        }
        if (invoice.dispatchedAt) {
          throw new HttpError(400, `Invoice ${invoice.invoiceNumber} is already dispatched`);
        }

        for (const line of invoice.order.lines) {
          const [onHand, wac] = await Promise.all([
            getCurrentStock(line.itemId, tx),
            getCurrentWAC(line.itemId, tx),
          ]);

          if (onHand.lt(line.qty)) {
            throw new HttpError(
              400,
              `Insufficient finished-goods stock for item ${line.itemId}: available ${onHand.toString()}, ordered ${line.qty}`
            );
          }

          await tx.stockLedger.create({
            data: {
              itemId: line.itemId,
              qtyDelta: new Decimal(line.qty).neg(),
              unitCostPaisa: wac,
              sourceType: "DISPATCH",
              sourceId: invoice.id,
              notes: `Dispatch for ${invoice.invoiceNumber}`,
              createdById: userId,
            },
          });
        }

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { dispatchedAt: new Date() },
          include: {
            order: {
              include: {
                customer: true,
                lines: true,
              },
            },
          },
        });

        await tx.order.update({
          where: { id: invoice.order.id },
          data: { status: "DISPATCHED" },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Invoice",
            entityId: invoice.id,
            action: "DISPATCH",
            userId,
            newData: {
              invoiceNumber: invoice.invoiceNumber,
              dispatchedAt: updatedInvoice.dispatchedAt,
            },
          },
        });

        return updatedInvoice;
      });

      res.json(dispatched);
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
 * POST /api/invoices/:id/cancel
 * Allowed roles: ADMIN
 * Marks original invoice CANCELLED and creates a linked Credit Note (creditNoteForId).
 * Never deletes a posted invoice.
 */
invoicesRouter.post(
  "/:id/cancel",
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    const invoiceId = String(req.params.id);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const original = await tx.invoice.findUnique({
          where: { id: invoiceId },
        });

        if (!original) {
          throw new HttpError(404, `Invoice not found: ${invoiceId}`);
        }
        if (original.creditNoteForId) {
          throw new HttpError(400, "Cannot cancel a credit note");
        }
        if (original.status === "CANCELLED") {
          throw new HttpError(400, `Invoice ${original.invoiceNumber} is already cancelled`);
        }

        const cancelledInvoice = await tx.invoice.update({
          where: { id: original.id },
          data: { status: "CANCELLED" },
        });

        const cnCount = await tx.invoice.count({
          where: {
            financialYear: original.financialYear,
            creditNoteForId: { not: null },
          },
        });
        const cnNumber = `CN/${original.financialYear}/${String(cnCount + 1).padStart(4, "0")}`;

        const creditNote = await tx.invoice.create({
          data: {
            invoiceNumber: cnNumber,
            financialYear: original.financialYear,
            orderId: null,
            taxablePaisa: -original.taxablePaisa,
            cgstPaisa: -original.cgstPaisa,
            sgstPaisa: -original.sgstPaisa,
            igstPaisa: -original.igstPaisa,
            totalPaisa: -original.totalPaisa,
            status: "POSTED",
            creditNoteForId: original.id,
            createdById: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "Invoice",
            entityId: original.id,
            action: "CANCEL",
            userId,
            oldData: { status: "POSTED", invoiceNumber: original.invoiceNumber },
            newData: {
              status: "CANCELLED",
              creditNoteId: creditNote.id,
              creditNoteNumber: cnNumber,
            },
          },
        });

        return { cancelledInvoice, creditNote };
      });

      res.json(result);
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
 * GET /api/invoices/:id/pdf
 * Allowed roles: ADMIN, SALESMAN, AUDITOR, OWNER
 * Streams a GST-compliant Tax Invoice PDF using pdfkit.
 */
invoicesRouter.get(
  "/:id/pdf",
  requireRole("ADMIN", "SALESMAN", "AUDITOR", "OWNER"),
  async (req: Request, res: Response) => {
    const invoiceId = String(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          include: {
            customer: true,
            lines: true,
          },
        },
      },
    });

    if (!invoice || !invoice.order) {
      res.status(404).json({ error: `Invoice not found: ${invoiceId}` });
      return;
    }

    const itemIds = [...new Set(invoice.order.lines.map((l) => l.itemId))];
    const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${invoice.invoiceNumber.replace(/\//g, "-")}.pdf"`
      );
      res.send(pdfBuffer);
    });

    // Header
    doc.fontSize(18).text("TAX INVOICE", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(12).text(FACTORY_NAME, { align: "left" });
    doc.fontSize(9).text(FACTORY_ADDRESS);
    doc.text(`Factory GSTIN: ${FACTORY_GSTIN}  |  State Code: ${FACTORY_STATE_CODE}`);
    doc.moveDown();

    // Invoice Meta & Customer
    doc.fontSize(10).text(`Invoice No: ${invoice.invoiceNumber}`);
    doc.text(`Financial Year: ${invoice.financialYear}`);
    doc.text(`Date: ${invoice.createdAt.toISOString().slice(0, 10)}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown(0.5);

    const cust = invoice.order.customer;
    doc.fontSize(11).text("Bill To:");
    doc.fontSize(10).text(`${cust.name} (${cust.type})`);
    doc.text(`Customer GSTIN: ${cust.gstin ?? "N/A"}  |  Place of Supply: ${cust.stateCode}`);
    doc.moveDown();

    // Line Items Table
    doc.fontSize(10).text("Line Items", { underline: true });
    doc.moveDown(0.3);

    for (const line of invoice.order.lines) {
      const item = itemMap.get(line.itemId);
      const lineTaxable = line.qty * line.unitPricePaisa;
      const gstPct = item ? (item.gstRateBps / 100).toFixed(2) : "0.00";
      doc.text(
        `${item?.name ?? line.itemId} | HSN: ${item?.hsnCode ?? "-"} | Qty: ${line.qty} ${
          item?.unit ?? ""
        } | Rate: ${paisaToRupee(line.unitPricePaisa)} | Taxable: ${paisaToRupee(
          lineTaxable
        )} | GST: ${gstPct}%`
      );
    }

    doc.moveDown();
    doc.text(`Taxable Value: ${paisaToRupee(invoice.taxablePaisa)}`, { align: "right" });
    if (invoice.igstPaisa > 0) {
      doc.text(`IGST: ${paisaToRupee(invoice.igstPaisa)}`, { align: "right" });
    } else {
      doc.text(`CGST: ${paisaToRupee(invoice.cgstPaisa)}`, { align: "right" });
      doc.text(`SGST: ${paisaToRupee(invoice.sgstPaisa)}`, { align: "right" });
    }
    doc.fontSize(12).text(`Grand Total: ${paisaToRupee(invoice.totalPaisa)}`, {
      align: "right",
    });

    doc.end();
  }
);
