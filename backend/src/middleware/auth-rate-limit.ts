import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";

const attempts = new Map<string, { count: number; resetAt: number }>();
const windowMs = 15 * 60 * 1000;

function rateLimit(maximumAttempts: number, message: string, scope: string): RequestHandler {
  return (req, _res, next) => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const now = Date.now();
    const key = `${scope}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > maximumAttempts) {
      next(new ApiError(429, "AUTH_RATE_LIMITED", message));
      return;
    }
    next();
  };
}

export const loginRateLimit = rateLimit(10, "Too many login attempts; try again later", "login");
export const refreshRateLimit = rateLimit(30, "Too many refresh attempts; try again later", "refresh");
