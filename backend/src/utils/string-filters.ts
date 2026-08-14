import type { Prisma } from "@prisma/client";
import { env } from "../config/env.js";

function caseVariants(value: string) {
  const trimmed = value.trim();
  const title = trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase() : trimmed;
  return [...new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase(), title].filter(Boolean))];
}

export function caseInsensitiveContainsFilter(value: string): Prisma.StringFilter {
  const trimmed = value.trim();
  if (!trimmed) return { contains: value };
  if (env.databaseProvider === "postgresql") {
    return { contains: trimmed, mode: "insensitive" } as Prisma.StringFilter;
  }
  const variants = caseVariants(trimmed);
  if (variants.length === 1) return { contains: trimmed };
  return { OR: variants.map((variant) => ({ contains: variant })) } as Prisma.StringFilter;
}

export function caseInsensitiveTextCondition(
  field: "township" | "customerName" | "trackingNumber" | "orderId",
  value: string,
): Prisma.ParcelWhereInput {
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (env.databaseProvider === "postgresql") {
    return { [field]: { contains: trimmed, mode: "insensitive" } } as Prisma.ParcelWhereInput;
  }
  const variants = caseVariants(trimmed);
  if (variants.length === 1) return { [field]: { contains: trimmed } };
  return { OR: variants.map((variant) => ({ [field]: { contains: variant } })) };
}
