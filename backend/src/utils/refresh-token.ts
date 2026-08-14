import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { ApiError } from "./api-error.js";
import { REFRESH_TTL_SECONDS } from "./jwt.js";

type Db = Prisma.TransactionClient | typeof prisma;

export function hashRefreshToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function newRefreshTokenValue() {
  return randomBytes(32).toString("base64url");
}

export async function issueRefreshToken(userId: string, remember: boolean, db: Db = prisma) {
  const raw = newRefreshTokenValue();
  const ttl = remember ? REFRESH_TTL_SECONDS.remember : REFRESH_TTL_SECONDS.session;
  const record = await db.refreshToken.create({
    data: { userId, tokenHash: hashRefreshToken(raw), remember, expiresAt: new Date(Date.now() + ttl * 1000) },
  });
  return { raw, record };
}

export async function revokeUserRefreshTokens(userId: string, db: Db = prisma) {
  await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function rotateRefreshToken(raw: string) {
  const tokenHash = hashRefreshToken(raw);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!existing) throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  if (existing.revokedAt) {
    await revokeUserRefreshTokens(existing.userId);
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  }
  if (existing.expiresAt.getTime() <= Date.now() || !existing.user.active) {
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  }
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      await revokeUserRefreshTokens(existing.userId, tx);
      throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
    }
    const next = await issueRefreshToken(existing.userId, existing.remember, tx);
    await tx.refreshToken.update({ where: { id: existing.id }, data: { replacedById: next.record.id } });
    return { user: existing.user, refresh: next, remember: existing.remember };
  });
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return undefined;
}
