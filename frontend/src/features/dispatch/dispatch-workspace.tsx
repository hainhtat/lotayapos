import { useDispatchController } from "./use-dispatch-controller";
import { DispatchWorkspaceView } from "./dispatch-workspace-view";

export function DispatchOperationsPage({ workspace = "dispatch" }: { workspace?: "dispatch" | "returns" }) {
  const model = useDispatchController({ workspace });
  return <DispatchWorkspaceView model={model} workspace={workspace} />;
}
