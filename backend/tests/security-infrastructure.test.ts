import { BoundedAttemptStore, createAuthRateLimit } from "../src/middleware/auth-rate-limit.js";
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
