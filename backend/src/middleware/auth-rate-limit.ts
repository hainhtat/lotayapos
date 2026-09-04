import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";

type Attempt = { count: number; resetAt: number };

export class BoundedAttemptStore {
  private readonly attempts = new Map<string, Attempt>();
  private operations = 0;

  constructor(private readonly maximumKeys = 10_000) {}

  increment(key: string, now: number, windowMs: number) {
    if (++this.operations % 100 === 0) this.evictExpired(now);
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.delete(key);
      this.ensureCapacity();
      this.attempts.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  get size() { return this.attempts.size; }

  private evictExpired(now: number) {
    for (const [key, value] of this.attempts) if (value.resetAt <= now) this.attempts.delete(key);
  }

  private ensureCapacity() {
    while (this.attempts.size >= this.maximumKeys) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.attempts.delete(oldest);
    }
  }
}

const windowMs = 15 * 60 * 1000;
const configuredMaximumKeys = Number(process.env.AUTH_RATE_LIMIT_MAX_KEYS ?? 10_000);
if (!Number.isInteger(configuredMaximumKeys) || configuredMaximumKeys < 100) throw new Error("AUTH_RATE_LIMIT_MAX_KEYS must be an integer of at least 100");
const store = new BoundedAttemptStore(configuredMaximumKeys);
const digest = (value: string) => createHash("sha256").update(value).digest("base64url").slice(0, 22);

export function createAuthRateLimit(maximumAttempts: number, message: string, scope: string, attemptStore = store, skipTests = true): RequestHandler {
  return (req, _res, next) => {
    if (skipTests && process.env.NODE_ENV === "test") return next();
    const now = Date.now();
    // Express req.ip honors the production `trust proxy = 1` boundary, so an
    // arbitrary X-Forwarded-For chain cannot choose the effective address.
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const identifier = typeof req.body?.identifier === "string"
      ? req.body.identifier.trim().toLowerCase()
      : typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : typeof req.body?.refreshToken === "string"
          ? req.body.refreshToken.trim()
          : req.headers.cookie ?? "missing";
    const ipCount = attemptStore.increment(`${scope}:ip:${digest(clientIp)}`, now, windowMs);
    const accountCount = identifier === "missing" ? 0 : attemptStore.increment(`${scope}:account:${digest(identifier)}`, now, windowMs);
    if (ipCount > maximumAttempts * 10 || accountCount > maximumAttempts) return next(new ApiError(429, "AUTH_RATE_LIMITED", message));
    next();
  };
}

// This bounded limiter protects one process. Production deployments with more
// than one API replica must enforce the same limits at the gateway/shared store.
export const loginRateLimit = createAuthRateLimit(10, "Too many login attempts; try again later", "login");
export const refreshRateLimit = createAuthRateLimit(30, "Too many refresh attempts; try again later", "refresh");
