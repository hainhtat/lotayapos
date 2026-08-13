import jwt from "jsonwebtoken"; import { env } from "../config/env.js";
export type AuthClaims = { sub: string; role: string; email: string; tokenVersion: number };
export const signAccessToken = (claims: Omit<AuthClaims, "tokenVersion"> & { tokenVersion?: number }) => jwt.sign({ ...claims, tokenVersion: claims.tokenVersion ?? 0 }, env.jwtSecret, { expiresIn: "15m", issuer: env.jwtIssuer, audience: env.jwtAudience });
export const verifyAccessToken = (token: string) => jwt.verify(token, env.jwtSecret, { issuer: env.jwtIssuer, audience: env.jwtAudience, algorithms: ["HS256"] }) as AuthClaims;
