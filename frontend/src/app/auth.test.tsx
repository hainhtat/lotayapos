import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { api, clearAuthToken } from "@/lib/api";
import "@/i18n";

const user = { id: "1", name: "A", email: "a@example.com", username: "a@example.com", role: "ADMIN" };

function jsonOk(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

function jsonUnauthorized() {
  return { ok: false, status: 401, json: async () => ({ success: false, error: { message: "unauthorized", code: "UNAUTHORIZED" } }) };
}

function Probe() {
  const { user: current, loading, login, logout } = useAuth();
  const [draft, setDraft] = useState("keep-me");
  const [parcels, setParcels] = useState("");
  return (
    <>
      <span>{loading ? "loading" : current?.email ?? "anonymous"}</span>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => void login("a@example.com", "password123")}>login</button>
      <button onClick={() => void logout()}>logout</button>
      <button
        onClick={() => {
          void api("/parcels")
            .then(() => setParcels("parcels-ok"))
            .catch(() => setParcels("parcels-fail"));
        }}
      >
        load-parcels
      </button>
      <span>{parcels}</span>
    </>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it("restores an authenticated user from verification", async () => {
    localStorage.setItem("lotaya_token", "stored-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: "1", name: "A", email: "a@example.com", role: "ADMIN" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][1].headers.get("authorization")).toBe("Bearer stored-token");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("treats verification failure as anonymous and clears the token", async () => {
    localStorage.setItem("lotaya_token", "expired-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(localStorage.getItem("lotaya_token")).toBeNull();
  });

  it("bootstraps with cookie refresh when no token is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonUnauthorized());
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/refresh");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("keeps a non-remembered login token in memory, sends it, and clears it on logout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) return jsonUnauthorized();
      if (url.includes("/auth/login")) return jsonOk({ user, accessToken: "new-token" });
      if (url.includes("/auth/logout")) return jsonOk(null);
      return jsonUnauthorized();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(localStorage.getItem("lotaya_token")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/auth/logout"));
    expect(logoutCall).toBeDefined();
    const logoutInit = logoutCall![1] as RequestInit;
    expect(new Headers(logoutInit.headers).get("authorization")).toBe("Bearer new-token");
    expect(logoutInit.credentials).toBe("include");
    expect(localStorage.getItem("lotaya_token")).toBeNull();
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe("include");
    }
  });

  it("silently refreshes and retries an API call after 401 without a dialog", async () => {
    let refreshCalls = 0;
    let parcelCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) {
        refreshCalls += 1;
        if (refreshCalls === 1) return jsonUnauthorized();
        return jsonOk({ user, accessToken: "refreshed-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
      }
      if (url.includes("/auth/login")) return jsonOk({ user, accessToken: "new-token" });
      if (url.includes("/parcels")) {
        parcelCalls += 1;
        if (parcelCalls === 1) return jsonUnauthorized();
        return jsonOk([]);
      }
      return jsonUnauthorized();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "load-parcels" }));
    await waitFor(() => expect(screen.getByText("parcels-ok")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Session expired" })).not.toBeInTheDocument();
    expect(parcelCalls).toBe(2);
    expect(localStorage.getItem("lotaya_token")).toBeNull();
  });

  it("keeps drafts mounted and retries the original request after re-auth", async () => {
    let parcelCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) return jsonUnauthorized();
      if (url.includes("/auth/login")) return jsonOk({ user, accessToken: "new-token" });
      if (url.includes("/parcels")) {
        parcelCalls += 1;
        if (parcelCalls === 1) return jsonUnauthorized();
        return jsonOk([]);
      }
      return jsonUnauthorized();
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "unsaved-note" } });
    fireEvent.click(screen.getByRole("button", { name: "load-parcels" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session expired" })).toBeInTheDocument());
    expect(screen.getByLabelText("draft")).toHaveValue("unsaved-note");
    expect(screen.getAllByText("a@example.com").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("parcels-ok")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Session expired" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("draft")).toHaveValue("unsaved-note");
    expect(parcelCalls).toBe(2);
  });
});
