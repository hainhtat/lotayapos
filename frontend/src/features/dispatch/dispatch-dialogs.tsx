import type { useDispatchController } from "./use-dispatch-controller";
import { ManifestAndEditDialogs } from "./manifest-edit-dialogs";
import { RiderStatusDialogs } from "./rider-status-dialogs";
import { DeliveryOutcomeDialogs } from "./delivery-outcome-dialogs";
import { HandoverLinkDialogs } from "./handover-link-dialogs";
import { BulkDialogs } from "./bulk-dialogs";
import { VoidParcelDialog } from "@/components/void-parcel-dialog";
export function DispatchDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { voiding, setVoiding, setMessage } = model;
  return <>
    <ManifestAndEditDialogs model={model} />
    <RiderStatusDialogs model={model} />
    <DeliveryOutcomeDialogs model={model} />
    <HandoverLinkDialogs model={model} />
    <BulkDialogs model={model} />
    {voiding && voiding.batch.id && <VoidParcelDialog parcel={voiding} batchId={voiding.batch.id} finalized={Boolean(voiding.batch.finalizedAt)} onClose={() => setVoiding(null)} onSuccess={(message) => { setVoiding(null); setMessage(message); }} />}
  </>;
}
