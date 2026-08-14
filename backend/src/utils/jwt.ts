import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = { session: 12 * 60 * 60, remember: 7 * 24 * 60 * 60 };

export type AuthClaims = { sub: string; role: string; email: string; tokenVersion: number };

export const accessTokenExpiresAt = () => new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

export const signAccessToken = (claims: Omit<AuthClaims, "tokenVersion"> & { tokenVersion?: number }) =>
  jwt.sign({ ...claims, tokenVersion: claims.tokenVersion ?? 0 }, env.jwtSecret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.jwtSecret, { issuer: env.jwtIssuer, audience: env.jwtAudience, algorithms: ["HS256"] }) as AuthClaims;
