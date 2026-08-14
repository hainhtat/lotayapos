import { noteAccessExpiry, requestReauth, requestSilentRefresh } from "@/lib/session-bridge";

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

const skipRefresh = (path: string) =>
  path.startsWith("/auth/login") || path.startsWith("/auth/refresh") || path.startsWith("/auth/register");

async function parseBody(response: Response) {
  return response.json().catch(() => null);
}

function failed(body: { error?: { message?: string; code?: string } } | null, status: number) {
  return new ApiError(body?.error?.message ?? "Request failed", body?.error?.code, status);
}

export async function api<T>(path: string, init: RequestInit = {}, allowReauth = true): Promise<{ success: true; data: T }> {
  const response = await send(path, init);
  const body = await parseBody(response);
  if (response.ok) {
    if (body?.data?.expiresAt) noteAccessExpiry(body.data.expiresAt);
    if (body?.data?.accessToken) setAuthToken(body.data.accessToken, false);
    return body as { success: true; data: T };
  }
  if (response.status === 401 && !skipRefresh(path)) {
    const refreshed = await requestSilentRefresh();
    if (refreshed) return api<T>(path, init, false);
    if (allowReauth) {
      await requestReauth();
      return api<T>(path, init, false);
    }
  }
  throw failed(body, response.status);
}

export async function apiRaw(path: string, init: RequestInit = {}, allowReauth = true) {
  const response = await send(path, init);
  if (response.ok) return response;
  if (response.status === 401 && !skipRefresh(path)) {
    const refreshed = await requestSilentRefresh();
    if (refreshed) return apiRaw(path, init, false);
    if (allowReauth) {
      await requestReauth();
      return apiRaw(path, init, false);
    }
  }
  const body = await parseBody(response);
  throw failed(body, response.status);
}

async function send(path: string, init: RequestInit) {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData) && !(init.body instanceof Blob)) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
}
