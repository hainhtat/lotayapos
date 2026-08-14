type ReauthHandler = () => Promise<void>;

let reauthHandler: ReauthHandler | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;
let expiresHandler: ((expiresAt: string) => void) | null = null;

export function setRefreshHandler(handler: (() => Promise<boolean>) | null) {
  refreshHandler = handler;
}

export function setReauthHandler(handler: ReauthHandler | null) {
  reauthHandler = handler;
}

export function setAccessExpiryHandler(handler: ((expiresAt: string) => void) | null) {
  expiresHandler = handler;
}

export function noteAccessExpiry(expiresAt?: string) {
  if (expiresAt) expiresHandler?.(expiresAt);
}

export function requestSilentRefresh() {
  return refreshHandler?.() ?? Promise.resolve(false);
}

export function requestReauth() {
  if (!reauthHandler) return Promise.reject(new Error("session expired"));
  return reauthHandler();
}
