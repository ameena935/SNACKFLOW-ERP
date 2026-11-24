import { describe, it, expect } from "vitest";
import { paisaToRupee, rupeeToPaisa, computeWAC, computeGST } from "../lib/money";
import { Decimal } from "@prisma/client/runtime/library";

describe("paisaToRupee", () => {
  it("converts 5000 paisa to ₹50.00", () => {
    expect(paisaToRupee(5000)).toBe("₹50.00");
  });
  it("converts 1 paisa to ₹0.01", () => {
    expect(paisaToRupee(1)).toBe("₹0.01");
  });
  it("converts 0 paisa to ₹0.00", () => {
    expect(paisaToRupee(0)).toBe("₹0.00");
  });
});

describe("rupeeToPaisa", () => {
  it("converts ₹50.00 to 5000", () => {
    expect(rupeeToPaisa(50.0)).toBe(5000);
  });
  it("converts ₹42.50 to 4250 (round half-up)", () => {
    expect(rupeeToPaisa(42.5)).toBe(4250);
  });
  it("converts ₹0.005 to 1 (round half-up)", () => {
    expect(rupeeToPaisa(0.005)).toBe(1);
  });
});

describe("computeWAC", () => {
  it("correct WAC for simple two-lot average", () => {
    // 100 kg @ 4200 paisa + 50 kg @ 4500 paisa → WAC = (100*4200 + 50*4500)/150
    // = (420000 + 225000) / 150 = 645000 / 150 = 4300
    const wac = computeWAC(
      new Decimal(100),
      new Decimal(4200),
      new Decimal(50),
      new Decimal(4500)
    );
    expect(wac).toBe(4300);
  });

  it("returns new cost when current qty is zero", () => {
    const wac = computeWAC(
      new Decimal(0),
      new Decimal(0),
      new Decimal(10),
      new Decimal(14000)
    );
    expect(wac).toBe(14000);
  });

  it("returns 0 when both qtys are zero", () => {
    const wac = computeWAC(
      new Decimal(0),
      new Decimal(0),
      new Decimal(0),
      new Decimal(0)
    );
    expect(wac).toBe(0);
  });

  it("rounds half-up correctly for fractional WAC", () => {
    // 2 units @ 1 paisa + 1 unit @ 2 paisa → WAC = 4/3 = 1.333… → rounds to 1
    const wac = computeWAC(
      new Decimal(2),
      new Decimal(1),
      new Decimal(1),
      new Decimal(2)
    );
    expect(wac).toBe(1);
  });
});

describe("computeGST", () => {
  it("intra-state: CGST + SGST split at 5%", () => {
    // 10000 paisa taxable, 500 bps (5%)
    // tax = 500 paisa → CGST = 250, SGST = 250
    const result = computeGST(10000, 500, false);
    expect(result.cgstPaisa).toBe(250);
    expect(result.sgstPaisa).toBe(250);
    expect(result.igstPaisa).toBe(0);
    expect(result.totalPaisa).toBe(10500);
  });

  it("inter-state: IGST at 5%", () => {
    const result = computeGST(10000, 500, true);
    expect(result.cgstPaisa).toBe(0);
    expect(result.sgstPaisa).toBe(0);
    expect(result.igstPaisa).toBe(500);
    expect(result.totalPaisa).toBe(10500);
  });

  it("intra-state: odd tax split (SGST gets the extra paisa)", () => {
    // 100 paisa @ 1% (100 bps) → tax = 1 paisa → CGST=0, SGST=1
    const result = computeGST(100, 100, false);
    expect(result.cgstPaisa + result.sgstPaisa).toBe(1);
    expect(result.totalPaisa).toBe(101);
  });

  it("zero GST rate produces no tax", () => {
    const result = computeGST(5000, 0, false);
    expect(result.cgstPaisa).toBe(0);
    expect(result.sgstPaisa).toBe(0);
    expect(result.totalPaisa).toBe(5000);
  });
});
