import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

function Probe() {
  const { user, loading, login, logout } = useAuth();
  return (
    <>
      <span>{loading ? "loading" : user?.email ?? "anonymous"}</span>
      <button onClick={() => void login("a@example.com", "password123")}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores an authenticated user from verification", async () => {
    localStorage.setItem("lotaya_token", "stored-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: "1", name: "A", email: "a@example.com", role: "ADMIN" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][1].headers.get("authorization")).toBe("Bearer stored-token");
  });

  it("treats verification failure as anonymous and clears the token", async () => {
    localStorage.setItem("lotaya_token", "expired-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(localStorage.getItem("lotaya_token")).toBeNull();
  });

  it("does not verify when no token is stored", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a non-remembered login token in memory, sends it, and clears it on logout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { user: { id: "1", name: "A", email: "a@example.com", role: "ADMIN" }, accessToken: "new-token" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(localStorage.getItem("lotaya_token")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(fetchMock.mock.calls[1][1].headers.get("authorization")).toBe("Bearer new-token");
    expect(localStorage.getItem("lotaya_token")).toBeNull();
  });
});
