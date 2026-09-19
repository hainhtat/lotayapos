import { toast } from "react-toastify";

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong. Please try again.";
}

export function notifyError(error: unknown) {
  const message = errorMessage(error);
  toast.error(message, { ariaLabel: message, toastId: `error:${message}` });
}

export function notifySuccess(message: string) {
  toast.success(message, { ariaLabel: message });
}
