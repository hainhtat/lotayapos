import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";

/** Browser cookie writes need a trusted source; native bearer clients may omit it. */
export const csrfOriginGuard: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const fetchSite = req.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site") return next(new ApiError(403, "FORBIDDEN", "Cross-site request not allowed"));
  const origin = req.get("Origin");
  if (origin) return env.webOrigins.includes(origin)
    ? next()
    : next(new ApiError(403, "FORBIDDEN", "Origin not allowed"));
  const referer = req.get("Referer");
  if (referer) {
    try {
      if (env.webOrigins.includes(new URL(referer).origin)) return next();
    } catch { /* An invalid Referer does not establish a trusted origin. */ }
    return next(new ApiError(403, "FORBIDDEN", "Referer not allowed"));
  }
  const nativeClient = req.get("X-Client-Platform") === "mobile" && !fetchSite;
  const bearerClient = /^Bearer\s+\S+$/i.test(req.get("Authorization") ?? "") && !fetchSite;
  const hasSessionCookie = /(?:^|;\s*)(?:accessToken|refreshToken)=/.test(req.headers.cookie ?? "");
  if (nativeClient || bearerClient || !hasSessionCookie) return next();
  next(new ApiError(403, "FORBIDDEN", "Request origin required"));
};
