import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Renders overlays on document.body so position:fixed is viewport-relative. */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
