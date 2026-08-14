import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";

/** Reject cross-site browser writes when Origin is present (mobile/native omit Origin). */
export const csrfOriginGuard: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  if (env.webOrigins.includes(origin)) {
    next();
    return;
  }
  next(new ApiError(403, "FORBIDDEN", "Origin not allowed"));
};
