import { createContext, useContext, useEffect, useState } from "react";
import { api, clearAuthToken, getAuthToken, setAuthToken } from "@/lib/api";

export type User = { id: string; name: string; username?: string; email: string; role: string };
type AuthResponse = { user: User; accessToken: string };
type Auth = {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string, remember?: boolean) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAuthToken()) {
      setLoading(false);
      return;
    }
    let active = true;
    api<User>("/auth/verify")
      .then((response) => {
        if (active) setUser(response.data);
      })
      .catch(() => {
        clearAuthToken();
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const authenticate = async (path: string, payload: Record<string, string>, persist = true) => {
    const response = await api<AuthResponse>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setAuthToken(response.data.accessToken, persist);
    setUser(response.data.user);
    return response.data.user;
  };

  const login = (identifier: string, password: string, remember = false) =>
    authenticate("/auth/login", { identifier, password }, remember);
  const register = (name: string, email: string, password: string) =>
    authenticate("/auth/register", { name, email, password });
  const logout = async () => {
    try {
      if (getAuthToken()) await api("/auth/logout", { method: "POST" });
    } finally {
      clearAuthToken();
      setUser(null);
    }
  };

  return <Context.Provider value={{ user, loading, login, register, logout }}>{children}</Context.Provider>;
}

export const useAuth = () => useContext(Context);
