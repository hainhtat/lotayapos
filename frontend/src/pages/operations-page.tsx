import { DispatchOperationsPage } from "@/features/dispatch/dispatch-workspace";
import { ReturnToOsWorkspace } from "./return-to-os-workspace";

export function OperationsPage({ workspace = "dispatch" }: { workspace?: "dispatch" | "returns" }) {
  return workspace === "returns" ? <ReturnToOsWorkspace /> : <DispatchOperationsPage workspace={workspace} />;
}
