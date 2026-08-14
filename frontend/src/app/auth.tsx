import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, clearAuthToken, getAuthToken, setAuthToken } from "@/lib/api";
import { setAccessExpiryHandler, setReauthHandler, setRefreshHandler } from "@/lib/session-bridge";
import { SessionExpiredDialog } from "@/components/session-expired-dialog";

export type User = { id: string; name: string; username?: string; email: string; role: string };
type AuthResponse = { user: User; accessToken: string; expiresAt?: string };
type Auth = {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string, remember?: boolean) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiredOpen, setExpiredOpen] = useState(false);
  const [expiredError, setExpiredError] = useState("");
  const [expiredPending, setExpiredPending] = useState(false);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const reauthWaiters = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>([]);
  const refreshTimer = useRef<number>(0);
  const rememberRef = useRef(false);
  const userRef = useRef<User | null>(null);
  const silentRefreshRef = useRef<() => Promise<boolean>>(async () => false);
  const scheduleRefreshRef = useRef<(expiresAt?: string) => void>(() => undefined);
  userRef.current = user;

  const clearRefreshTimer = () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = 0;
  };

  const silentRefresh = () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    refreshInFlight.current = api<AuthResponse>("/auth/refresh", { method: "POST", body: JSON.stringify({}) }, false)
      .then((response) => {
        setAuthToken(response.data.accessToken, false);
        if (response.data.user) setUser(response.data.user);
        scheduleRefresh(response.data.expiresAt);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight.current = null;
      });
    return refreshInFlight.current;
  };

  const scheduleRefresh = (expiresAt?: string) => {
    clearRefreshTimer();
    if (!expiresAt) return;
    const delay = new Date(expiresAt).getTime() - Date.now() - 60_000;
    refreshTimer.current = window.setTimeout(() => {
      void silentRefreshRef.current();
    }, Math.max(5_000, delay));
  };

  silentRefreshRef.current = silentRefresh;
  scheduleRefreshRef.current = scheduleRefresh;

  useEffect(() => {
    setRefreshHandler(() => silentRefreshRef.current());
    setAccessExpiryHandler((expiresAt) => scheduleRefreshRef.current(expiresAt));
    setReauthHandler(
      () =>
        new Promise<void>((resolve, reject) => {
          reauthWaiters.current.push({ resolve, reject });
          setExpiredOpen(true);
          setExpiredError("");
        }),
    );
    return () => {
      setRefreshHandler(null);
      setAccessExpiryHandler(null);
      setReauthHandler(null);
      clearRefreshTimer();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        if (getAuthToken()) {
          const response = await api<User>("/auth/verify", {}, false);
          if (active) setUser(response.data);
          return;
        }
        const refreshed = await silentRefresh();
        if (!refreshed || !active) return;
        const response = await api<User>("/auth/verify", {}, false);
        if (active) setUser(response.data);
      } catch {
        clearAuthToken();
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const authenticate = async (path: string, payload: Record<string, string | boolean>, persist = true) => {
    const response = await api<AuthResponse>(path, { method: "POST", body: JSON.stringify(payload) }, false);
    rememberRef.current = persist;
    setAuthToken(response.data.accessToken, false);
    setUser(response.data.user);
    scheduleRefresh(response.data.expiresAt);
    return response.data.user;
  };

  const login = (identifier: string, password: string, remember = false) =>
    authenticate("/auth/login", { identifier, password, remember }, remember);
  const register = (name: string, email: string, password: string) =>
    authenticate("/auth/register", { name, email, password });
  const logout = async () => {
    try {
      if (getAuthToken()) await api("/auth/logout", { method: "POST" }, false);
    } finally {
      clearRefreshTimer();
      clearAuthToken();
      setUser(null);
      setExpiredOpen(false);
      for (const waiter of reauthWaiters.current.splice(0)) waiter.reject(new Error("signed out"));
    }
  };

  const submitExpired = async (password: string) => {
    const current = userRef.current;
    if (!current) return;
    setExpiredPending(true);
    setExpiredError("");
    try {
      await login(current.username || current.email, password, rememberRef.current);
      setExpiredOpen(false);
      for (const waiter of reauthWaiters.current.splice(0)) waiter.resolve();
    } catch {
      setExpiredError("invalid");
    } finally {
      setExpiredPending(false);
    }
  };

  return (
    <Context.Provider value={{ user, loading, login, register, logout }}>
      {children}
      <SessionExpiredDialog
        open={expiredOpen}
        identifier={user?.username || user?.email || ""}
        error={expiredError ? t("invalid") : ""}
        pending={expiredPending}
        onSubmit={submitExpired}
      />
    </Context.Provider>
  );
}

export const useAuth = () => useContext(Context);
