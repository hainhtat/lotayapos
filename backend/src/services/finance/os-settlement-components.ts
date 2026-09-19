import { ApiError } from "../../utils/api-error.js";

export type EditableOsSettlementComponents = {
  advanceDeduction: number;
  returnDeduction: number;
  deliveryFeeDeduction: number;
  adjustmentAmount: number;
  adjustmentReason?: string;
};

export function replayMatchesComponents(afterJson: string, input: EditableOsSettlementComponents & { wallet?: string }) {
  const prior = JSON.parse(afterJson) as Record<string, unknown>;
  return prior.advanceDeduction === input.advanceDeduction
    && prior.returnDeduction === input.returnDeduction
    && prior.deliveryFeeDeduction === input.deliveryFeeDeduction
    && prior.adjustmentAmount === input.adjustmentAmount
    && (prior.adjustmentReason ?? null) === (input.adjustmentReason?.trim() || null)
    && (input.wallet === undefined || prior.wallet === input.wallet);
}

export function validateEditableSettlementComponents(
  values: EditableOsSettlementComponents,
  maximums: { grossCollectedCod: number; advanceDeduction: number; returnDeduction: number; deliveryFeeDeduction: number },
) {
  for (const [field, value, maximum] of [
    ["advanceDeduction", values.advanceDeduction, maximums.advanceDeduction],
    ["returnDeduction", values.returnDeduction, maximums.returnDeduction],
    ["deliveryFeeDeduction", values.deliveryFeeDeduction, maximums.deliveryFeeDeduction],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > maximum)
      throw new ApiError(400, "INVALID_SETTLEMENT_COMPONENT", `${field} must be between zero and its statement maximum`);
  }
  const adjustmentLimit = maximums.grossCollectedCod + maximums.advanceDeduction + maximums.returnDeduction + maximums.deliveryFeeDeduction;
  if (!Number.isInteger(values.adjustmentAmount) || Math.abs(values.adjustmentAmount) > adjustmentLimit)
    throw new ApiError(400, "INVALID_SETTLEMENT_ADJUSTMENT", "Adjustment is outside the statement bounds");
  if (values.adjustmentAmount !== 0 && !values.adjustmentReason?.trim())
    throw new ApiError(400, "ADJUSTMENT_REASON_REQUIRED", "A reason is required for a settlement adjustment");
}
