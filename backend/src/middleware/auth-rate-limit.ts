import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";

const attempts = new Map<string, { count: number; resetAt: number }>();
const windowMs = 15 * 60 * 1000;
const maximumAttempts = 10;

export const loginRateLimit: RequestHandler = (req, _res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }
  current.count += 1;
  if (current.count > maximumAttempts) {
    next(new ApiError(429, "AUTH_RATE_LIMITED", "Too many login attempts; try again later"));
    return;
  }
  next();
};
