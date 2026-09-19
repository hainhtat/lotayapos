import { describe, expect, it } from "vitest";
import { canAccessRoute } from "./role-access";

describe("route access", () => {
  it("allows operational roles into returns while keeping user administration Superadmin-only", () => {
    expect(canAccessRoute("FINANCE", "/operations/returns")).toBe(true);
    expect(canAccessRoute("AUDITOR", "/operations/returns")).toBe(true);
    expect(canAccessRoute("SUPERADMIN", "/settings/users")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/settings/users")).toBe(false);
  });
});
