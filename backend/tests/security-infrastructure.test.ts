import { BoundedAttemptStore, createAuthRateLimit } from "../src/middleware/auth-rate-limit.js";
import { csrfOriginGuard } from "../src/middleware/csrf-origin.js";
import { gracefulShutdown } from "../src/utils/graceful-shutdown.js";

describe("security and shutdown infrastructure", () => {
  test("authentication attempt storage remains bounded and expires old identities", () => {
    const store = new BoundedAttemptStore(2);
    expect(store.increment("a", 0, 100)).toBe(1);
    expect(store.increment("b", 0, 100)).toBe(1);
    expect(store.increment("c", 0, 100)).toBe(1);
    expect(store.size).toBe(2);
    expect(store.increment("b", 50, 100)).toBe(2);
    expect(store.increment("b", 101, 100)).toBe(1);
  });

  test("does not globally lock out 31 refresh sessions but limits one abusive session", () => {
    const store = new BoundedAttemptStore(1000);
    const middleware = createAuthRateLimit(30, "limited", "refresh-test", store, false);
    const invoke = (refreshToken: string) => {
      let error: unknown;
      middleware({ ip: "203.0.113.10", socket: {}, body: { refreshToken }, headers: {} } as never, {} as never, (value?: unknown) => { error = value; });
      return error;
    };
    for (let index = 0; index < 31; index += 1) expect(invoke(`session-${index}`)).toBeUndefined();
    for (let index = 0; index < 30; index += 1) expect(invoke("abusive-session")).toBeUndefined();
    expect(invoke("abusive-session")).toMatchObject({ status: 429, code: "AUTH_RATE_LIMITED" });
  });

  test("login abuse from one IP does not lock out the account on another IP", () => {
    const limiter = createAuthRateLimit(2, "limited", "login-test", new BoundedAttemptStore(), false);
    const invoke = (ip: string) => {
      let error: unknown;
      limiter({ ip, socket: {}, body: { identifier: "staff@example.com" }, headers: {} } as never, {} as never, (value?: unknown) => { error = value; });
      return error;
    };
    expect(invoke("203.0.113.1")).toBeUndefined();
    expect(invoke("203.0.113.1")).toBeUndefined();
    expect(invoke("203.0.113.1")).toMatchObject({ status: 429 });
    expect(invoke("203.0.113.2")).toBeUndefined();
  });

  test("rotating login identifiers cannot bypass the source IP limit", () => {
    const limiter = createAuthRateLimit(1, "limited", "login-ip-test", new BoundedAttemptStore(), false);
    const invoke = (identifier: string) => {
      let error: unknown;
      limiter({ ip: "203.0.113.3", socket: {}, body: { identifier }, headers: {} } as never, {} as never, (value?: unknown) => { error = value; });
      return error;
    };
    for (let index = 0; index < 10; index += 1) expect(invoke(`account-${index}`)).toBeUndefined();
    expect(invoke("account-10")).toMatchObject({ status: 429, code: "AUTH_RATE_LIMITED" });
  });

  test("cookie writes require a trusted origin or referer, while native and bearer requests work", () => {
    const invoke = (headers: Record<string, string>) => {
      let error: unknown;
      csrfOriginGuard({ method: "POST", headers, get: (name: string) => headers[name.toLowerCase()] } as never, {} as never, (value?: unknown) => { error = value; });
      return error;
    };
    const cookie = "accessToken=test";
    expect(invoke({ cookie })).toMatchObject({ status: 403 });
    expect(invoke({ cookie, referer: "https://localhost:5173.attacker.invalid/path" })).toMatchObject({ status: 403 });
    expect(invoke({ cookie, origin: "null" })).toMatchObject({ status: 403 });
    expect(invoke({ cookie, "sec-fetch-site": "cross-site" })).toMatchObject({ status: 403 });
    expect(invoke({ cookie, origin: "https://attacker.invalid", authorization: "Bearer test" })).toMatchObject({ status: 403 });
    expect(invoke({ cookie, referer: "http://localhost:5173/batches" })).toBeUndefined();
    expect(invoke({ cookie, "x-client-platform": "mobile" })).toBeUndefined();
    expect(invoke({ authorization: "Bearer native-token" })).toBeUndefined();
  });

  test("waits for HTTP close before disconnecting the database", async () => {
    const events: string[] = [];
    const server = {
      close(callback: (error?: Error) => void) {
        events.push("close-start");
        setTimeout(() => { events.push("close-finished"); callback(); }, 5);
        return this;
      },
    };
    await gracefulShutdown(server, async () => { events.push("disconnect"); }, 100);
    expect(events).toEqual(["close-start", "close-finished", "disconnect"]);
  });

  test("forces lingering connections only after the shutdown timeout", async () => {
    const events: string[] = [];
    const server = {
      close() { events.push("close-start"); return this; },
      closeIdleConnections() { events.push("close-idle"); },
      closeAllConnections() { events.push("close-all"); },
    };
    await gracefulShutdown(server, async () => { events.push("disconnect"); }, 5);
    expect(events).toEqual(["close-start", "close-idle", "close-all", "disconnect"]);
  });
});
