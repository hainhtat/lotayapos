import { addWalletAmounts, assertCashbookOpen, buildCashbookAdjustmentLines, buildExpenseLines, buildOpeningBalanceLines, buildWalletTransferLines, calculateDailySalaryDeduction, calculateOsSettlementNet, calculateRecognitionTotals, calculateRiderSettlementAmounts, calculateRiderSettlementTotals, calculateWalletBalances, calculateWalletReconciliationVariance, combineRiderOutstandingAggregates, cumulativeReceiptPosition, isOsSettlementCodCovered, settlementWalletMismatch } from "../src/services/finance.service.js";
import { buildRiderReceivableRecognitionLines } from "../src/services/parcel.service.js";
import { ApiError } from "../src/utils/api-error.js";
import { buildPickupAdvanceJournalLines, bulkAssignParcels, calculateReturnExtension, isAssignmentEligible, pickupAdvancePostingDisposition } from "../src/services/operations.service.js";
import { businessDateFor } from "../src/services/master-data.service.js";
import { assertParcelAccess, buildParcelListWhere, buildParcelScope, buildRiderCommissionLines, calculateCommissionAmount, canOverrideStatus, isAllowedTransition, LINKED_MONEY_POSTED_SOURCE_TYPES, MONEY_POSTED_SOURCE_TYPES, overrideLeavesMoneyBearingStatus, requiresOverrideNote, resolveCommissionRateBps, validateConfiguredReason } from "../src/services/parcel.service.js";
import { normalizeReasonCode, normalizeRiderPayFields } from "../src/services/master-data.service.js";
import { assertBalancedLines, buildDeliveryCollectionLines, buildPartialReturnAdjustmentLines, buildPartialReturnCollectionLines, buildReturnDeductionLines, calculatePartialReturnAmounts } from "../src/services/ledger.service.js";
import { generateDispatchManifestPdf } from "../src/utils/manifest-pdf.js";
import { env } from "../src/config/env.js";

describe("rider settlement formula", () => {
  test("recognizes rider debt at delivery without treating it as a wallet receipt", () => {
    expect(buildRiderReceivableRecognitionLines(100000, 3000, 1200)).toEqual({
      receivableAmount: 101800,
      lines: [
        { account: "RIDER_RECEIVABLE", debit: 101800, credit: 0 },
        { account: "RIDER_COMMISSION_PAYABLE", debit: 1200, credit: 0 },
        { account: "CUSTOMER_COD_RECEIVABLE", debit: 0, credit: 100000 },
        { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 3000 },
      ],
    });
  });
  test("calculates amount owed as COD plus fees less commission", () => {
    expect(calculateRiderSettlementAmounts({ cod: 100000, fees: 5000, commission: 10000, cash: 90000, kbzPay: 5000, wavePay: 0 })).toEqual({
      expectedAmount: 95000,
      actualAmount: 95000,
      variance: 0,
      salaryDeduction: 0,
    });
  });

  test("preserves under-settlement as a negative variance", () => {
    expect(calculateRiderSettlementAmounts({ cod: 100000, fees: 0, commission: 10000, cash: 80000, kbzPay: 0, wavePay: 0 }).variance).toBe(-10000);
  });

  test("reconciles all supported wallets without rounding or dropping zero values", () => {
    expect(calculateRiderSettlementAmounts({ cod: 0, fees: 1250, commission: 250, cash: 500, kbzPay: 500, wavePay: 0 })).toEqual({
      expectedAmount: 1000,
      actualAmount: 1000,
      variance: 0,
      salaryDeduction: 0,
    });
  });

  test("deducts daily salary from expected remittance", () => {
    expect(
      calculateRiderSettlementAmounts({
        cod: 100000,
        fees: 5000,
        commission: 0,
        salaryDeduction: 10000,
        cash: 95000,
        kbzPay: 0,
        wavePay: 0,
      }),
    ).toEqual({ expectedAmount: 95000, actualAmount: 95000, variance: 0, salaryDeduction: 10000 });
  });

  test("pro-rates monthly salary by days in the settlement month", () => {
    expect(calculateDailySalaryDeduction(310000, new Date("2026-08-13T00:00:00.000Z"), "SALARY")).toBe(10000);
    expect(calculateDailySalaryDeduction(310000, new Date("2026-08-13T00:00:00.000Z"), "PERCENTAGE")).toBe(0);
    expect(calculateDailySalaryDeduction(0, new Date("2026-08-13T00:00:00.000Z"), "SALARY")).toBe(0);
  });

  test("compares declared and verified remittance per wallet, not only by total", () => {
    expect(settlementWalletMismatch({ cash: 1000, kbzPay: 500, wavePay: 0 }, { cash: 500, kbzPay: 1000, wavePay: 0 })).toBe(true);
    expect(settlementWalletMismatch({ cash: 1000, kbzPay: 500, wavePay: 0 }, { cash: 1000, kbzPay: 500, wavePay: 0 })).toBe(false);
  });

  test("carries prior-day unpaid and partially paid receivables into dashboard outstanding", () => {
    expect(combineRiderOutstandingAggregates(
      ["unpaid-rider", "partial-rider", "settled-rider"],
      [
        { riderId: "unpaid-rider", _sum: { receivableAmount: 100000 } },
        { riderId: "partial-rider", _sum: { receivableAmount: 200000 } },
        { riderId: "settled-rider", _sum: { receivableAmount: 50000 } },
      ],
      [
        { riderId: "partial-rider", _sum: { actualAmount: 75000 } },
        { riderId: "settled-rider", _sum: { actualAmount: 50000 } },
      ],
    )).toEqual({
      outstandingAmount: 225000,
      unsettledRiderCount: 2,
      rows: [
        { riderId: "unpaid-rider", recognizedAmount: 100000, paidAmount: 0, outstandingAmount: 100000 },
        { riderId: "partial-rider", recognizedAmount: 200000, paidAmount: 75000, outstandingAmount: 125000 },
        { riderId: "settled-rider", recognizedAmount: 50000, paidAmount: 50000, outstandingAmount: 0 },
      ],
    });
  });

  test("reconciles multiple receipts cumulatively", () => {
    expect(cumulativeReceiptPosition({ expectedAmount: 400000, previouslyPaid: 0, receiptAmount: 100000 })).toEqual({ paidAmount: 100000, variance: -300000, status: "PARTIAL" });
    expect(cumulativeReceiptPosition({ expectedAmount: 400000, previouslyPaid: 100000, receiptAmount: 300000 })).toEqual({ paidAmount: 400000, variance: 0, status: "SETTLED" });
    expect(addWalletAmounts({ cash: 100000, kbzPay: 0, wavePay: 0 }, { cash: 0, kbzPay: 200000, wavePay: 100000 })).toEqual({ cash: 100000, kbzPay: 200000, wavePay: 100000 });
  });

  test("recognizes linked COD on each delivery date and group fee only on completion date", () => {
    expect(calculateRecognitionTotals([{ codAmount: 100000, deliveryFee: 0, commissionAmount: 0 }])).toEqual({ cod: 100000, fees: 0, commission: 0 });
    expect(calculateRecognitionTotals([
      { codAmount: 200000, deliveryFee: 0, commissionAmount: 0 },
      { codAmount: 0, deliveryFee: 5000, commissionAmount: 2000 },
    ])).toEqual({ cod: 200000, fees: 5000, commission: 2000 });
  });

  test("counts a linked group fee and commission once using adjusted totals", () => {
    expect(calculateRiderSettlementTotals([
      { codAmount: 10000, deliveryFee: 3000, commissionAmount: 1200, linkGroup: { id: "group-1", totalDeliveryFee: 5000, parcelStatuses: ["DELIVERED", "DELIVERED"] } },
      { codAmount: 20000, deliveryFee: 3000, commissionAmount: 1200, linkGroup: { id: "group-1", totalDeliveryFee: 5000, parcelStatuses: ["DELIVERED", "DELIVERED"] } },
    ], 4000)).toEqual({ cod: 30000, fees: 5000, commission: 2000 });
  });

  test("skips fees and commission for incomplete linked groups", () => {
    expect(calculateRiderSettlementTotals([
      { codAmount: 10000, deliveryFee: 3000, commissionAmount: 1200, linkGroup: { id: "group-1", totalDeliveryFee: 5000, parcelStatuses: ["DELIVERED", "FAILED"] } },
    ], 4000)).toEqual({ cod: 10000, fees: 0, commission: 0 });
  });

  test("uses stored way commission for single parcels and zero rate for salary-linked groups", () => {
    expect(calculateRiderSettlementTotals([
      { codAmount: 10000, deliveryFee: 3000, commissionAmount: 1200, linkGroup: null },
    ], 0)).toEqual({ cod: 10000, fees: 3000, commission: 1200 });
    expect(calculateRiderSettlementTotals([
      { codAmount: 10000, deliveryFee: 3000, commissionAmount: 0, linkGroup: { id: "group-1", totalDeliveryFee: 5000, parcelStatuses: ["DELIVERED", "DELIVERED"] } },
    ], 0)).toEqual({ cod: 10000, fees: 5000, commission: 0 });
  });
});

describe("OS settlement formula", () => {
  test("keeps every reviewed component visible in the net payable", () => {
    expect(calculateOsSettlementNet({ grossCollectedCod: 500000, advanceDeduction: 250000, returnDeduction: 25000, deliveryFeeDeduction: 20000, adjustmentAmount: -5000 })).toBe(200000);
  });

  test("preserves a negative net as an OS receivable", () => {
    expect(calculateOsSettlementNet({ grossCollectedCod: 10000, advanceDeduction: 20000, returnDeduction: 5000, deliveryFeeDeduction: 0, adjustmentAmount: 0 })).toBe(-15000);
  });

  test("blocks OS settlement when advances and returns are not covered by collected COD", () => {
    expect(isOsSettlementCodCovered({ collectedCod: 512000, advancePaid: 2000000, returnedAdvance: 0 })).toBe(false);
    expect(isOsSettlementCodCovered({ collectedCod: 512000, advancePaid: 2000000, returnedAdvance: 0, priorSettledReturns: 1000 })).toBe(false);
    expect(isOsSettlementCodCovered({ collectedCod: 100000, advancePaid: 40000, returnedAdvance: 10000 })).toBe(true);
    expect(isOsSettlementCodCovered({ collectedCod: 50000, advancePaid: 50000, returnedAdvance: 0 })).toBe(false);
  });

  test("requires collected COD to strictly exceed advances, returns, and prior settled returns", () => {
    expect(isOsSettlementCodCovered({ collectedCod: 100000, advancePaid: 40000, returnedAdvance: 10000, priorSettledReturns: 0 })).toBe(true);
    expect(isOsSettlementCodCovered({ collectedCod: 100000, advancePaid: 40000, returnedAdvance: 10000, priorSettledReturns: 50000 })).toBe(false);
    expect(isOsSettlementCodCovered({ collectedCod: 100001, advancePaid: 40000, returnedAdvance: 10000, priorSettledReturns: 50000 })).toBe(true);
  });
});

describe("cashbook close controls", () => {
  test("posts an expense as a balanced category debit and wallet credit", () => {
    expect(buildExpenseLines("RENT", "KBZ_PAY", 25000)).toEqual([
      { account: "EXPENSE:RENT", debit: 25000, credit: 0 },
      { account: "WALLET_KBZ_PAY", debit: 0, credit: 25000 },
    ]);
    expect(() => buildExpenseLines("RENT", "CASH", 0)).toThrow("positive integer");
  });
  test("keeps opening balances as balanced wallet-to-equity journals", () => {
    expect(buildOpeningBalanceLines("CASH", 10000)).toEqual([
      { account: "WALLET_CASH", debit: 10000, credit: 0 },
      { account: "OPENING_BALANCE_EQUITY", debit: 0, credit: 10000 },
    ]);
  });

  test("keeps wallet transfers balanced and rejects same-wallet transfers", () => {
    expect(buildWalletTransferLines("CASH", "KBZ_PAY", 5000)).toEqual([
      { account: "WALLET_KBZ_PAY", debit: 5000, credit: 0 },
      { account: "WALLET_CASH", debit: 0, credit: 5000 },
    ]);
    expect(() => buildWalletTransferLines("CASH", "CASH", 5000)).toThrow("must differ");
  });

  test("represents both directions of cashbook adjustments as balanced journals", () => {
    expect(buildCashbookAdjustmentLines("WAVE_PAY", 2500, "DECREASE")).toEqual([
      { account: "CASHBOOK_ADJUSTMENT", debit: 2500, credit: 0 },
      { account: "WALLET_WAVE_PAY", debit: 0, credit: 2500 },
    ]);
  });

  test("computes signed balances for each supported wallet", () => {
    expect(calculateWalletBalances([
      { account: "WALLET_CASH", debit: 10000, credit: 2500 },
      { account: "WALLET_KBZ_PAY", debit: 5000, credit: 0 },
      { account: "WALLET_CASH", debit: 0, credit: 1000 },
    ])).toEqual([
      { account: "WALLET_CASH", debit: 10000, credit: 3500, balance: 6500 },
      { account: "WALLET_KBZ_PAY", debit: 5000, credit: 0, balance: 5000 },
      { account: "WALLET_WAVE_PAY", debit: 0, credit: 0, balance: 0 },
    ]);
  });

  test("detects a wallet settlement journal mismatch", () => {
    expect(calculateWalletReconciliationVariance([{ wallet: "CASH", journalAmount: 9000, settlementAmount: 10000 }])).toEqual([
      { wallet: "CASH", journalAmount: 9000, settlementAmount: 10000, variance: -1000 },
    ]);
  });

  test("rejects writes for a closed cashbook day", async () => {
    const transaction = { cashbookDay: { findFirst: jest.fn().mockResolvedValue({ closedAt: new Date("2026-08-10T12:00:00.000Z") }) } };
    await expect(assertCashbookOpen(transaction as never, new Date("2026-08-10T00:00:00.000Z"), "hub-a")).rejects.toThrow("already closed");
    expect(transaction.cashbookDay.findFirst).toHaveBeenCalledWith({ where: { hubId: "hub-a", businessDate: new Date("2026-08-10T00:00:00.000Z") }, select: { closedAt: true } });
  });
});

describe("parcel transitions", () => {
  test("calculates a persisted commission from delivery fee and basis-point policy", () => {
    expect(calculateCommissionAmount(12500, 1000)).toBe(1250);
    expect(buildRiderCommissionLines(1250)).toEqual([
      { account: "RIDER_COMMISSION_EXPENSE", debit: 1250, credit: 0 },
      { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 1250 },
    ]);
  });

  test("resolves commission bps from rider pay model and rate", () => {
    expect(resolveCommissionRateBps({ payModel: "SALARY", commissionRateBps: 0 })).toBe(0);
    expect(resolveCommissionRateBps({ payModel: "SALARY", commissionRateBps: 4000 })).toBe(0);
    expect(resolveCommissionRateBps({ payModel: "PERCENTAGE", commissionRateBps: 4000 })).toBe(4000);
    expect(resolveCommissionRateBps({ payModel: "SALARY_PLUS_PERCENTAGE", commissionRateBps: 2500 })).toBe(2500);
    expect(resolveCommissionRateBps(null)).toBe(env.riderCommissionRateBps);
    expect(resolveCommissionRateBps({ payModel: "PERCENTAGE", commissionRateBps: 0 })).toBe(env.riderCommissionRateBps);
    expect(resolveCommissionRateBps({ payModel: "PERCENTAGE", commissionRateBps: null })).toBe(env.riderCommissionRateBps);
  });

  test("blocks ERP overrides that leave money-bearing statuses until finance reverses", () => {
    expect(overrideLeavesMoneyBearingStatus("DELIVERED", "FAILED", true)).toBe(true);
    expect(overrideLeavesMoneyBearingStatus("PARTIAL", "OUT_FOR_DELIVERY", true)).toBe(true);
    expect(overrideLeavesMoneyBearingStatus("DELIVERED", "DELIVERED", true)).toBe(false);
    expect(overrideLeavesMoneyBearingStatus("OUT_FOR_DELIVERY", "DELIVERED", false)).toBe(false);
    expect(overrideLeavesMoneyBearingStatus("ASSIGNED", "FAILED", true)).toBe(false);
  });

  test("treats delivery and partial journals as money-posted sources that require reversal", () => {
    expect([...MONEY_POSTED_SOURCE_TYPES]).toEqual([
      "RIDER_COMMISSION",
      "RIDER_RECEIVABLE_RECOGNITION",
      "PARTIAL_RETURN_COLLECTION",
      "OS_PARTIAL_RETURN_ADJUSTMENT",
      "DELIVERY_COLLECTION",
    ]);
    expect([...LINKED_MONEY_POSTED_SOURCE_TYPES]).toEqual([
      "LINKED_RIDER_RECEIVABLE_RECOGNITION",
      "LINKED_RIDER_RECEIVABLE_COD",
      "LINKED_RIDER_RECEIVABLE_FEE",
      "LINKED_DELIVERY_COLLECTION",
      "LINKED_RIDER_COMMISSION",
      "LINKED_OS_SHORTFALL",
    ]);
  });

  test("allows delivery outcomes from out-for-delivery", () => {
    expect(isAllowedTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    expect(isAllowedTransition("OUT_FOR_DELIVERY", "FAILED")).toBe(true);
  });

  test("does not allow skipping operational states or reopening returned parcels", () => {
    expect(isAllowedTransition("CREATED", "DELIVERED")).toBe(false);
    expect(isAllowedTransition("RETURNED", "OUT_FOR_DELIVERY")).toBe(false);
  });

  test("allows each rider outcome only from out-for-delivery", () => {
    expect(isAllowedTransition("OUT_FOR_DELIVERY", "PARTIAL")).toBe(true);
    expect(isAllowedTransition("OUT_FOR_DELIVERY", "REJECTED")).toBe(true);
    expect(isAllowedTransition("DELIVERED", "FAILED")).toBe(false);
    expect(isAllowedTransition("FAILED", "DELIVERED")).toBe(false);
  });

  test("ERP roles may override status; riders may not", () => {
    expect(canOverrideStatus("SUPERADMIN")).toBe(true);
    expect(canOverrideStatus("OPERATIONS_MANAGER")).toBe(true);
    expect(canOverrideStatus("DISPATCHER")).toBe(true);
    expect(canOverrideStatus("RIDER")).toBe(false);
    expect(canOverrideStatus("FINANCE")).toBe(false);
  });

  test("override note is required only for non-lifecycle transitions", () => {
    expect(requiresOverrideNote("CREATED", "DELIVERED")).toBe(true);
    expect(requiresOverrideNote("OUT_FOR_DELIVERY", "DELIVERED")).toBe(false);
    expect(requiresOverrideNote("FAILED", "DELIVERED")).toBe(true);
  });
});

describe("rider pay model", () => {
  test("rejects percentage pay model with zero commission bps", () => {
    expect(() => normalizeRiderPayFields({ payModel: "PERCENTAGE", commissionRateBps: 0, monthlySalary: 0 })).toThrow("Commission rate");
  });

  test("rejects salary pay model with zero monthly salary", () => {
    expect(() => normalizeRiderPayFields({ payModel: "SALARY", commissionRateBps: 0, monthlySalary: 0 })).toThrow("Monthly salary");
  });

  test("rejects salary-plus-percentage missing either component", () => {
    expect(() => normalizeRiderPayFields({ payModel: "SALARY_PLUS_PERCENTAGE", commissionRateBps: 0, monthlySalary: 200000 })).toThrow("Commission rate");
    expect(() => normalizeRiderPayFields({ payModel: "SALARY_PLUS_PERCENTAGE", commissionRateBps: 4000, monthlySalary: 0 })).toThrow("Monthly salary");
  });

  test("normalizes valid pay model combinations", () => {
    expect(normalizeRiderPayFields({ payModel: "PERCENTAGE", commissionRateBps: 4000, monthlySalary: 0 })).toEqual({
      payModel: "PERCENTAGE",
      commissionRateBps: 4000,
      monthlySalary: 0,
    });
    expect(normalizeRiderPayFields({ payModel: "SALARY", commissionRateBps: 0, monthlySalary: 250000 })).toEqual({
      payModel: "SALARY",
      commissionRateBps: 0,
      monthlySalary: 250000,
    });
  });
});

describe("parcel authorization scope", () => {
  test("limits operational parcel queries to the actor hub", () => {
    expect(buildParcelScope({ role: "OPERATIONS_MANAGER", hubId: "hub-a", riderId: null })).toEqual({ batch: { hubId: "hub-a" } });
    expect(buildParcelScope({ role: "SUPERADMIN", hubId: null, riderId: null })).toBeUndefined();
  });

  test("limits riders to their own assignments and rejects assigned queries for non-riders", () => {
    expect(buildParcelScope({ role: "RIDER", hubId: "hub-a", riderId: "rider-a" }, true)).toEqual({ riderId: "rider-a" });
    expect(() => buildParcelScope({ role: "DISPATCHER", hubId: "hub-a", riderId: null }, true)).toThrow("Only riders");
  });

  test("rejects cross-hub status changes before transition logic", () => {
    expect(() => assertParcelAccess({ id: "manager-a", role: "OPERATIONS_MANAGER", hubId: "hub-a", riderId: null }, { batchHubId: "hub-b", riderUserId: null })).toThrow("outside your hub");
    expect(() => assertParcelAccess({ id: "rider-a", role: "RIDER", hubId: "hub-a", riderId: "rider-a" }, { batchHubId: "hub-a", riderUserId: "rider-b" })).toThrow("assigned parcels");
  });

  test("filters parcels through district and region identifiers", () => {
    expect(buildParcelListWhere({ id: "admin", role: "SUPERADMIN", hubId: null, riderId: null }, false, { districtId: "district-a", regionStateId: "region-a" })).toEqual({
      AND: [
        { townshipRelation: { districtId: "district-a" } },
        { townshipRelation: { district: { regionStateId: "region-a" } } },
      ],
    });
  });
});

describe("pickup advance funding wallet", () => {
  test("credits the selected KBZ Pay wallet while keeping the entry balanced", () => {
    expect(buildPickupAdvanceJournalLines(25000, "KBZ_PAY")).toEqual([
      { account: "OS_ADVANCE_RECEIVABLE", debit: 25000, credit: 0 },
      { account: "WALLET_KBZ_PAY", debit: 0, credit: 25000 },
    ]);
  });

  test("rejects unsupported funding wallets", () => {
    expect(() => buildPickupAdvanceJournalLines(25000, "UNKNOWN")).toThrow("Funding wallet");
  });

  test("treats a complete retry as idempotent and rejects partial historical posting", () => {
    expect(pickupAdvancePostingDisposition(3, 3)).toBe("ALREADY_POSTED");
    expect(pickupAdvancePostingDisposition(3, 0)).toBe("UNPOSTED");
    expect(pickupAdvancePostingDisposition(3, 1)).toBe("PARTIAL");
  });
});

describe("double-entry ledger rules", () => {
  test("posts delivery COD, delivery fees, and OS shortfall as balanced lines", () => {
    const result = buildDeliveryCollectionLines({ collectedCod: 80000, collectedDeliveryFee: 5000, advanceAmount: 100000, wallet: "KBZ_PAY" });
    expect(result.shortfall).toBe(20000);
    expect(result.lines).toEqual([
      { account: "WALLET_KBZ_PAY", debit: 85000, credit: 0 },
      { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 80000 },
      { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 5000 },
    ]);
    expect(assertBalancedLines(result.lines)).toEqual({ debit: 85000, credit: 85000 });
  });

  test("uses COD payable when collection exceeds the pickup advance", () => {
    const result = buildDeliveryCollectionLines({ collectedCod: 120000, collectedDeliveryFee: 0, advanceAmount: 100000, wallet: "CASH" });
    expect(result.lines).toEqual([
      { account: "WALLET_CASH", debit: 120000, credit: 0 },
      { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 100000 },
      { account: "OS_COD_PAYABLE", debit: 0, credit: 20000 },
    ]);
  });

  test("reclassifies a returned parcel advance into a future OS settlement offset", () => {
    const lines = buildReturnDeductionLines(25000);
    expect(lines).toEqual([
      { account: "OS_SETTLEMENT_OFFSET", debit: 25000, credit: 0 },
      { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 25000 },
    ]);
  });

  test("rejects unbalanced journal lines", () => {
    expect(() => assertBalancedLines([{ account: "WALLET_CASH", debit: 1, credit: 0 }, { account: "REVENUE", debit: 0, credit: 2 }])).toThrow("equal credits");
  });
});

describe("partial return COD adjustments", () => {
  test("calculates the original-vs-collected shortfall and caps the settlement offset at the advanced COD", () => {
    expect(calculatePartialReturnAmounts({ codAmount: 100000, advanceAmount: 75000, actualCodCollected: 60000 })).toEqual({
      originalCod: 100000,
      actualCodCollected: 60000,
      shortfall: 40000,
      settlementOffset: 40000,
    });
    expect(calculatePartialReturnAmounts({ codAmount: 100000, advanceAmount: 25000, actualCodCollected: 0 }).settlementOffset).toBe(25000);
  });

  test("rejects actual COD outside the original COD bounds", () => {
    expect(() => calculatePartialReturnAmounts({ codAmount: 100000, advanceAmount: 75000, actualCodCollected: -1 })).toThrow("non-negative");
    expect(() => calculatePartialReturnAmounts({ codAmount: 100000, advanceAmount: 75000, actualCodCollected: 100001 })).toThrow("original COD");
  });

  test("posts a balanced OS settlement offset for the advanced portion of the shortfall", () => {
    const lines = buildPartialReturnAdjustmentLines(40000);
    expect(lines).toEqual([
      { account: "OS_SETTLEMENT_OFFSET", debit: 40000, credit: 0 },
      { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 40000 },
    ]);
    expect(assertBalancedLines(lines)).toEqual({ debit: 40000, credit: 40000 });
  });

  test("posts actual partial COD collection to the selected wallet", () => {
    const lines = buildPartialReturnCollectionLines(60000, "KBZ_PAY");
    expect(lines).toEqual([
      { account: "WALLET_KBZ_PAY", debit: 60000, credit: 0 },
      { account: "CUSTOMER_COD_RECEIVABLE", debit: 0, credit: 60000 },
    ]);
    expect(assertBalancedLines(lines)).toEqual({ debit: 60000, credit: 60000 });
    expect(buildPartialReturnCollectionLines(0, "CASH")).toEqual([]);
  });
});

describe("bulk dispatch and manifest rules", () => {
  test("only unassigned created or picked-up parcels are dispatchable", () => {
    expect(isAssignmentEligible({ riderId: null, status: "CREATED" })).toBe(true);
    expect(isAssignmentEligible({ riderId: null, status: "PICKED_UP" })).toBe(true);
    expect(isAssignmentEligible({ riderId: "rider-a", status: "PICKED_UP" })).toBe(false);
    expect(isAssignmentEligible({ riderId: null, status: "DELIVERED" })).toBe(false);
  });

  test("rejects dispatch selections larger than 500 parcels before persistence", async () => {
    const parcelIds = Array.from({ length: 501 }, (_, index) => `parcel-${index}`);
    await expect(
      bulkAssignParcels({ parcelIds, riderId: "rider-1" }, { id: "user-1", role: "DISPATCHER" }),
    ).rejects.toEqual(expect.any(ApiError));
    await expect(
      bulkAssignParcels({ parcelIds, riderId: "rider-1" }, { id: "user-1", role: "DISPATCHER" }),
    ).rejects.toMatchObject({ status: 400, code: "BATCH_TOO_LARGE" });
  });

  test("combines assignment, location, batch, and date filters", () => {
    expect(buildParcelListWhere({ id: "manager", role: "OPERATIONS_MANAGER", hubId: "hub-a", riderId: null }, false, {
      batchId: "batch-a",
      assignmentStatus: "UNASSIGNED",
      zone: "Downtown",
      township: "Yangon",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-11",
    })).toEqual({
      AND: [
        { batch: { hubId: "hub-a" } },
        { batchId: "batch-a" },
        { riderId: null },
        { zone: "Downtown" },
        { township: "Yangon" },
        { batch: { pickupDate: { gte: new Date("2026-08-10"), lt: new Date("2026-08-12") } } },
      ],
    });
  });

  test("combines scoped identifier, shop, status, and reason searches", () => {
    expect(buildParcelListWhere({ id: "manager", role: "OPERATIONS_MANAGER", hubId: "hub-a", riderId: null }, false, {
      trackingNumber: "PKG-10",
      orderId: "OS-22",
      shopId: "shop-a",
      status: "FAILED",
      reasonCode: "NO_ANSWER",
    })).toEqual({ AND: [
      { batch: { hubId: "hub-a" } },
      { trackingNumber: { contains: "PKG-10" } },
      { orderId: { contains: "OS-22" } },
      { batch: { shopId: "shop-a" } },
      { status: "FAILED" },
      { reasonCode: "NO_ANSWER" },
    ] });
  });

  test("generates a PDF manifest containing the assigned rider and parcel identifiers", () => {
    const pdf = generateDispatchManifestPdf({
      riderName: "Aung Aung",
      batchLabels: ["snmd 15.06.2026"],
      generatedAt: new Date("2026-08-10T00:00:00.000Z"),
      parcels: [{ trackingNumber: "PKG-001", orderId: "130", customerName: "Ma Ma", customerPhone: "0912345678", address: "No. 1 Main Road", codAmount: 25000, deliveryFee: 1500, zone: "Downtown", township: "Yangon", batchLabel: "snmd 15.06.2026", shopName: "snmd" }],
    });
    const content = pdf.toString("latin1");
    expect(content.startsWith("%PDF-1.4")).toBe(true);
    expect(content).toContain("Aung Aung");
    expect(content).toContain("PKG-001");
    expect(content).toContain("All Active Deliveries");
    expect(content).toContain("COD:");
    expect(content).toContain("Fees:");
    expect(content).toContain("Total:");
  });

  test("supports multi-rider sections as separate active rider sheets", () => {
    const pdf = generateDispatchManifestPdf({
      generatedAt: new Date("2026-08-10T00:00:00.000Z"),
      sections: [
        {
          riderName: "Aung Aung",
          parcels: [{ trackingNumber: "PKG-001", customerName: "Ma Ma", customerPhone: "0912345678", address: "No. 1 Main Road", codAmount: 25000, deliveryFee: 1500, zone: "Downtown", township: "Yangon" }],
        },
        {
          riderName: "Ko Ko",
          parcels: [{ trackingNumber: "PKG-002", customerName: "Su Su", customerPhone: null, address: "No. 2 Side Road", codAmount: 10000, deliveryFee: 2000, zone: null, township: "Hlaing" }],
        },
      ],
    });
    const content = pdf.toString("latin1");
    expect(content).toContain("Aung Aung");
    expect(content).toContain("Ko Ko");
    expect(content).toContain("PKG-002");
    expect(content).toContain("Active Rider Sheet");
    expect(content).toContain("Selected statuses:");
  });
});

describe("configured exception reasons", () => {
  test("normalizes stable codes and enforces outcome and note policy", () => {
    expect(normalizeReasonCode(" no_answer ")).toBe("NO_ANSWER");
    expect(validateConfiguredReason({ code: "NO_ANSWER", outcome: "FAILED", noteRequired: false, active: true }, "FAILED")).toBe("NO_ANSWER");
    expect(() => validateConfiguredReason({ code: "DAMAGED", outcome: "REJECTED", noteRequired: true, active: true }, "REJECTED")).toThrow("note is required");
    expect(() => validateConfiguredReason({ code: "NO_ANSWER", outcome: "FAILED", noteRequired: false, active: false }, "FAILED")).toThrow("not active");
  });
});

describe("hub business dates and pending returns", () => {
  test("uses the configured hub timezone to select the dashboard business date", () => {
    expect(businessDateFor(new Date("2026-08-10T18:30:00.000Z"), "Asia/Yangon").toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  test("extends an existing return deadline by bounded calendar days", () => {
    expect(calculateReturnExtension(new Date("2026-08-14T06:30:00.000Z"), 3).toISOString()).toBe("2026-08-17T06:30:00.000Z");
    expect(() => calculateReturnExtension(new Date("2026-08-14T06:30:00.000Z"), 31)).toThrow("between 1 and 30 days");
  });
});
