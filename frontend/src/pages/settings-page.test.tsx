import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { SettingsPage } from "./settings-page";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "admin-1", role: "OPERATIONS_MANAGER" } }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
}

describe("SettingsPage", () => {
  beforeEach(() => apiMock.mockImplementation((path: string) => {
    if (path === "/master-data") return Promise.resolve({ data: { hubs: [{ id: "hub-1", name: "Main Hub" }], shops: [], zones: [], riders: [] } });
    if (path === "/master-data/locations/townships") return Promise.resolve({ data: [] });
    if (path === "/master-data/reason-codes") return Promise.resolve({ data: [{ id: "reason-1", code: "NO_ANSWER", labelEn: "No answer", labelMy: "မကိုင်", outcome: "FAILED", noteRequired: false, active: true }] });
    return Promise.resolve({ data: { id: "new" } });
  }));

  it("keeps invalid rider submission disabled and sends a complete valid rider", async () => {
    renderPage();
    const add = await screen.findByRole("button", { name: "Add rider" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Rider" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "rider@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getAllByLabelText("Hub").at(-1)!, { target: { value: "hub-1" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "new.rider" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/master-data/riders", {
        method: "POST",
        body: JSON.stringify({
          name: "New Rider",
          username: "new.rider",
          email: "rider@example.com",
          password: "password123",
          hubId: "hub-1",
          payModel: "PERCENTAGE",
          commissionRateBps: 4000,
          monthlySalary: 0,
        }),
      }),
    );
  });

  it("patches rider pay fields from the edit form", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({
          data: {
            hubs: [{ id: "hub-1", name: "Main Hub" }],
            shops: [],
            zones: [],
            riders: [
              {
                id: "rider-1",
                user: { name: "Ada Rider", email: "ada@example.com" },
                hub: { name: "Main Hub" },
                payModel: "PERCENTAGE",
                commissionRateBps: 4000,
              },
            ],
          },
        });
      }
      if (path === "/master-data/locations/townships") return Promise.resolve({ data: [] });
      if (path === "/master-data/reason-codes") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { id: "ok" } });
    });
    renderPage();
    await screen.findByText("Ada Rider");
    fireEvent.click(screen.getByRole("button", { name: "Edit pay" }));
    fireEvent.change(screen.getAllByLabelText("Pay model")[1]!, { target: { value: "SALARY" } });
    fireEvent.change(screen.getByLabelText("Monthly salary (MMK)"), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pay" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/master-data/riders/rider-1", {
        method: "PATCH",
        body: JSON.stringify({ payModel: "SALARY", commissionRateBps: 0, monthlySalary: 250000 }),
      }),
    );
  });

  it("creates and deactivates configured exception reasons", async () => {
    renderPage();
    await screen.findByText("No answer");
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "customer short" } });
    fireEvent.change(screen.getByLabelText("English label"), { target: { value: "Customer short-paid" } });
    fireEvent.change(screen.getByLabelText("Myanmar label"), { target: { value: "ငွေလျော့ပေး" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reason" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/master-data/reason-codes", { method: "POST", body: JSON.stringify({ code: "CUSTOMER_SHORT", labelEn: "Customer short-paid", labelMy: "ငွေလျော့ပေး", outcome: "PARTIAL", noteRequired: false }) }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate NO_ANSWER" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/master-data/reason-codes/reason-1", { method: "PATCH", body: JSON.stringify({ active: false }) }));
  });
});
