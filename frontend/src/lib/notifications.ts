import { toast } from "react-toastify";
import i18n from "@/i18n";

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return i18n.t("actionError");
}

export function notifyError(error: unknown) {
  const message = errorMessage(error);
  toast.error(message, { ariaLabel: message, toastId: `error:${message}` });
}

export function notifySuccess(message: string) {
  toast.success(message, { ariaLabel: message });
}
