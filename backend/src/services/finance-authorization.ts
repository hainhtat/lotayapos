import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export type FinanceActor = { id: string; role: string };

const financeRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER"];
const financeReadRoles = [...financeRoles, "AUDITOR"];

export function isFinanceRole(role: string) {
  return financeRoles.includes(role);
}

export async function assertFinanceActor(actor: FinanceActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true, active: true, hubId: true },
  });
  if (!user || !user.active || user.role !== actor.role || !financeRoles.includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Active finance scope required");
  }
  return user;
}

export async function assertFinanceReadActor(actor: FinanceActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true, active: true, hubId: true },
  });
  if (!user || !user.active || user.role !== actor.role || !financeReadRoles.includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Active finance read scope required");
  }
  return user;
}

async function resolveHubFromUser(user: { role: string; hubId: string | null }, requestedHubId?: string) {
  if (user.role === "SUPERADMIN" || (user.role === "AUDITOR" && !user.hubId)) {
    if (!requestedHubId) throw new ApiError(400, "HUB_REQUIRED", "Select a hub");
    const hub = await prisma.hub.findUnique({ where: { id: requestedHubId }, select: { id: true } });
    if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");
    return hub.id;
  }
  if (!user.hubId || (requestedHubId && requestedHubId !== user.hubId)) {
    throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  }
  return user.hubId;
}

export async function resolveFinanceHub(actor: FinanceActor, requestedHubId?: string) {
  return resolveHubFromUser(await assertFinanceActor(actor), requestedHubId);
}

export async function resolveFinanceHubForRead(actor: FinanceActor, requestedHubId?: string) {
  return resolveHubFromUser(await assertFinanceReadActor(actor), requestedHubId);
}

export async function resolveFinanceListHub(actor: FinanceActor, requestedHubId?: string) {
  const user = await assertFinanceReadActor(actor);
  if ((user.role === "SUPERADMIN" || (user.role === "AUDITOR" && !user.hubId)) && !requestedHubId) return undefined;
  return resolveHubFromUser(user, requestedHubId);
}
