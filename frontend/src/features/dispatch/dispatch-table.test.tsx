import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { DispatchTable } from "./dispatch-table";

describe("Dispatch table", () => {
  it("labels the row-number column without an unresolved interpolation token", () => {
    render(<MemoryRouter><DispatchTable visible={[]} selected={[]} allSelected={false} canDispatchEdit={false} canVoid={false} sortBy="" sortDirection="asc" riders={[]} riderPending={false} statusPending={false} correctRiderPending={false} paidToOsPending={false} onToggleAll={vi.fn()} onToggleOne={vi.fn()} onRiderChange={vi.fn()} onStatusChange={vi.fn()} onHistory={vi.fn()} onCorrectRider={vi.fn()} onPaidToOs={vi.fn()} onEdit={vi.fn()} onVoid={vi.fn()} onSort={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("columnheader", { name: "#" })).toBeInTheDocument();
    expect(screen.queryByText(/\{\{number\}\}/)).not.toBeInTheDocument();
  });
  it("shows visible linked members together without claiming other pages are complete", () => {
    const parcel = (id: string, groupId?: string) => ({ id, trackingNumber: id, customerName: "Customer", status: "ASSIGNED", codAmount: 1000, deliveryFee: 4000, batch: { label: "Batch", shop: { name: "Shop" } }, linkGroup: groupId ? { id: groupId, address: "Road", baseDeliveryFee: 4000, totalDeliveryFee: 5000 } : null });
    render(<MemoryRouter><DispatchTable visible={[parcel("LTY-1", "group"), parcel("LTY-3"), parcel("LTY-2", "group")]} selected={[]} allSelected={false} canDispatchEdit={false} canVoid={false} sortBy="deliveryFee" sortDirection="asc" riders={[]} riderPending={false} statusPending={false} correctRiderPending={false} paidToOsPending={false} onToggleAll={vi.fn()} onToggleOne={vi.fn()} onRiderChange={vi.fn()} onStatusChange={vi.fn()} onHistory={vi.fn()} onCorrectRider={vi.fn()} onPaidToOs={vi.fn()} onEdit={vi.fn()} onVoid={vi.fn()} onSort={vi.fn()} /></MemoryRouter>);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("LTY-1"), expect.stringContaining("LTY-2"), expect.stringContaining("LTY-3")]);
    expect(screen.getByText("Group fee 5,000 MMK")).toBeInTheDocument();
    expect(screen.getByText(/Other group members may be on another page/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Fee" })).toHaveAttribute("aria-sort", "none");
    expect(rows[0].querySelectorAll("td")[9]).toHaveTextContent("—");
    expect(rows[0].querySelectorAll("td")[11]).toHaveTextContent("—");
  });
});
