export type Outcome = "DELIVERED" | "PARTIAL" | "FAILED" | "REJECTED";

export function reasonErrorKey(outcome: Outcome): string | undefined {
  return outcome === "DELIVERED" ? undefined : `${outcome.toLowerCase()}Reason`;
}

export function hasRequiredReason(outcome: Outcome, reason: string): boolean {
  return outcome === "DELIVERED" || Boolean(reason.trim());
}

export function parseCollectedCod(value: string, originalCod: number): number | undefined {
  const normalized = value.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const collected = Number(normalized);
  return Number.isSafeInteger(collected) && collected >= 0 && collected <= originalCod ? collected : undefined;
}

export type CollectionWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";
export type OutcomeInput = { outcome: Outcome; reason: string; note?: string; noteRequired?: boolean; actualCod: string; originalCod: number; collectionWallet: CollectionWallet | "" };
export type OutcomeValidationError = "reason" | "noteRequired" | "actualCodRequired" | "actualCodInvalid" | "collectionWalletRequired";

export function buildOutcomePayload(input: OutcomeInput): { payload?: Record<string, string | number>; error?: OutcomeValidationError } {
  if (!hasRequiredReason(input.outcome, input.reason)) return { error: "reason" };
  const payload: Record<string, string | number> = { status: input.outcome };
  if (input.outcome !== "DELIVERED") payload.reasonCode = input.reason.trim();
  if(input.noteRequired&&!input.note?.trim())return {error:"noteRequired"};
  if(input.note?.trim())payload.note=input.note.trim();
  if (input.outcome !== "PARTIAL") return { payload };
  if (!input.actualCod.trim()) return { error: "actualCodRequired" };
  const actualCodCollected = parseCollectedCod(input.actualCod, input.originalCod);
  if (actualCodCollected === undefined) return { error: "actualCodInvalid" };
  if (!input.collectionWallet) return { error: "collectionWalletRequired" };
  return { payload: { ...payload, actualCodCollected, collectionWallet: input.collectionWallet } };
}
