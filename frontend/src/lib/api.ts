const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
export const authTokenKey = "lotaya_token";
let sessionToken: string | null = null;

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function getAuthToken() {
  return sessionToken ?? localStorage.getItem(authTokenKey);
}

export function setAuthToken(token: string, persist = true) {
  sessionToken = token;
  if (persist) localStorage.setItem(authTokenKey, token);
  else localStorage.removeItem(authTokenKey);
}

export function clearAuthToken() {
  sessionToken = null;
  localStorage.removeItem(authTokenKey);
}

export async function api<T>(path: string, init: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error?.message ?? "Request failed", body?.error?.code, response.status);
  return body as { success: true; data: T };
}

export async function apiRaw(path: string, init: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, {...init, headers});
  if (!response.ok) { const body = await response.json().catch(() => null); throw new ApiError(body?.error?.message ?? "Request failed", body?.error?.code, response.status); }
  return response;
}
