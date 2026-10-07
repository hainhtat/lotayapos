import { DispatchBulkDialogs } from "./bulk-action-dialogs";
import type { useDispatchController } from "./use-dispatch-controller";
export function BulkDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { selected, rescheduleOpen, setRescheduleOpen, rescheduleDate, setRescheduleDate, rescheduleReason, setRescheduleReason, returnOpen, setReturnOpen, returnDate, setReturnDate, returnRequest, reschedule, confirmReturns } = model;
  return <>
      <DispatchBulkDialogs
        returnOpen={returnOpen} rescheduleOpen={rescheduleOpen} selectedCount={selected.length}
        returnDate={returnDate} onReturnDate={setReturnDate}
        returnRequestPending={Boolean(returnRequest.current)} confirmReturns={confirmReturns}
        onConfirmReturns={() => confirmReturns.mutate()} onCloseReturn={() => setReturnOpen(false)}
        rescheduleDate={rescheduleDate} onRescheduleDate={setRescheduleDate}
        rescheduleReason={rescheduleReason} onRescheduleReason={setRescheduleReason}
        reschedule={reschedule} onReschedule={() => reschedule.mutate()} onCloseReschedule={() => setRescheduleOpen(false)}
      />

  </>;
}
