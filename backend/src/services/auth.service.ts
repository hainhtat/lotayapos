import bcrypt from "bcryptjs";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { accessTokenExpiresAt, signAccessToken } from "../utils/jwt.js";
import { hashRefreshToken, issueRefreshToken, readCookie, rotateRefreshToken, revokeUserRefreshTokens } from "../utils/refresh-token.js";

const publicUser = (user: { id: string; name: string; username: string | null; email: string; role: string }) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  role: user.role,
});

async function sessionFor(user: { id: string; name: string; username: string | null; email: string; role: string; tokenVersion: number }, remember: boolean) {
  const refresh = await issueRefreshToken(user.id, remember);
  return {
    user: publicUser(user),
    accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }),
    refreshToken: refresh.raw,
    expiresAt: accessTokenExpiresAt().toISOString(),
    remember,
  };
}

export async function register(input: { name: string; username: string; email: string; password: string }, actor: { id: string; role: string }) {
  const admin = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
  if (!admin?.active || admin.role !== "SUPERADMIN" || actor.role !== "SUPERADMIN") throw new ApiError(403, "FORBIDDEN", "Active Superadmin access required");
  const username = input.username.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { username }] } });
  if (existing) throw new ApiError(409, "USER_EXISTS", "An account with this email or username already exists");
  const user = await prisma.user.create({ data: { name: input.name, username, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } });
  return sessionFor(user, false);
}

export async function login(input: { identifier?: string; email?: string; password: string; remember?: boolean }) {
  const identifier = (input.identifier ?? input.email)!.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
  if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) throw new ApiError(401, "AUTH_INVALID", "Invalid credentials");
  return sessionFor(user, Boolean(input.remember));
}

export async function refresh(input: { cookieHeader?: string; refreshToken?: string }) {
  const raw = input.refreshToken?.trim() || readCookie(input.cookieHeader, "refreshToken");
  if (!raw) throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  const rotated = await rotateRefreshToken(raw);
  return {
    user: publicUser(rotated.user),
    accessToken: signAccessToken({
      sub: rotated.user.id,
      email: rotated.user.email,
      role: rotated.user.role,
      tokenVersion: rotated.user.tokenVersion,
    }),
    refreshToken: rotated.refresh.raw,
    expiresAt: accessTokenExpiresAt().toISOString(),
    remember: rotated.remember,
  };
}

export async function logout(input: { cookieHeader?: string; refreshToken?: string; userId?: string }) {
  const raw = input.refreshToken?.trim() || readCookie(input.cookieHeader, "refreshToken");
  if (raw) {
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) }, select: { userId: true } });
    if (existing) await revokeUserRefreshTokens(existing.userId);
  } else if (input.userId) {
    await revokeUserRefreshTokens(input.userId);
  }
}

export async function verify(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.active) throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  return publicUser(user);
}
