import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/database.js";
import { assertFinanceActor, resolveFinanceHub, resolveFinanceListHub } from "../src/services/finance-authorization.js";

describe("finance authorization matrix", () => {
  const suffix = randomUUID();
  const hubId = `finance-auth-hub-${suffix}`;
  const otherHubId = `finance-auth-other-${suffix}`;
  const ids = {
    finance: `finance-auth-finance-${suffix}`,
    inactive: `finance-auth-inactive-${suffix}`,
    auditor: `finance-auth-auditor-${suffix}`,
    orgAuditor: `finance-auth-org-auditor-${suffix}`,
    superadmin: `finance-auth-superadmin-${suffix}`,
  };

  beforeAll(async () => {
    await prisma.hub.createMany({ data: [{ id: hubId, name: `Finance Auth ${suffix}` }, { id: otherHubId, name: `Finance Auth Other ${suffix}` }] });
    await prisma.user.createMany({ data: [
      { id: ids.finance, name: "Finance", email: `${ids.finance}@test.invalid`, passwordHash: "test", role: "FINANCE", hubId },
      { id: ids.inactive, name: "Inactive", email: `${ids.inactive}@test.invalid`, passwordHash: "test", role: "FINANCE", hubId, active: false },
      { id: ids.auditor, name: "Auditor", email: `${ids.auditor}@test.invalid`, passwordHash: "test", role: "AUDITOR", hubId },
      { id: ids.orgAuditor, name: "Org Auditor", email: `${ids.orgAuditor}@test.invalid`, passwordHash: "test", role: "AUDITOR" },
      { id: ids.superadmin, name: "Superadmin", email: `${ids.superadmin}@test.invalid`, passwordHash: "test", role: "SUPERADMIN" },
    ] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.hub.deleteMany({ where: { id: { in: [hubId, otherHubId] } } });
  });

  test("enforces active identity, role equality, and write scope", async () => {
    await expect(assertFinanceActor({ id: ids.finance, role: "FINANCE" })).resolves.toMatchObject({ hubId });
    await expect(assertFinanceActor({ id: ids.inactive, role: "FINANCE" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(assertFinanceActor({ id: ids.finance, role: "SUPERADMIN" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(assertFinanceActor({ id: ids.auditor, role: "AUDITOR" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(resolveFinanceHub({ id: ids.finance, role: "FINANCE" }, otherHubId)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("supports hub-scoped and organization-wide reads without weakening superadmin writes", async () => {
    await expect(resolveFinanceListHub({ id: ids.auditor, role: "AUDITOR" })).resolves.toBe(hubId);
    await expect(resolveFinanceListHub({ id: ids.orgAuditor, role: "AUDITOR" })).resolves.toBeUndefined();
    await expect(resolveFinanceListHub({ id: ids.orgAuditor, role: "AUDITOR" }, otherHubId)).resolves.toBe(otherHubId);
    await expect(resolveFinanceHub({ id: ids.superadmin, role: "SUPERADMIN" })).rejects.toMatchObject({ status: 400, code: "HUB_REQUIRED" });
    await expect(resolveFinanceHub({ id: ids.superadmin, role: "SUPERADMIN" }, hubId)).resolves.toBe(hubId);
  });
});
