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
    expect(rows[0]).toHaveTextContent("Σ 5,000");
    expect(rows[0].querySelector('td:nth-child(3) [role="img"]')).toHaveAttribute("title", expect.stringContaining("Linked · 2 shown"));
    expect(rows[0].querySelector('td:first-child > span[aria-hidden="true"]')).toBeInTheDocument();
    expect(rows[1].querySelector('td:first-child > span[aria-hidden="true"]')).toBeInTheDocument();
    expect(rows[2].querySelector('td:first-child > span[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(screen.getByText(/Other group members may be on another page/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Link" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Fee" })).toHaveAttribute("aria-sort", "none");
    expect(rows[0].querySelectorAll("td")[8]).toHaveTextContent("Σ 5,000");
    expect(rows[1].querySelectorAll("td")[8]).toHaveTextContent("—");
    expect(rows[0].querySelectorAll("td")[10]).toHaveTextContent("—");
  });
  it("keeps a lone visible linked parcel at normal row height with its fee in the fee column", () => {
    const parcel = { id: "linked-1", orderId: "2", trackingNumber: "LTY-2090", customerName: "Customer", status: "OUT_FOR_DELIVERY", codAmount: 35600, deliveryFee: 4000, batch: { label: "Batch", shop: { name: "Shop" } }, linkGroup: { id: "group", address: "Road", baseDeliveryFee: 4000, totalDeliveryFee: 5500 } };
    render(<MemoryRouter><DispatchTable visible={[parcel]} selected={[]} allSelected={false} canDispatchEdit={false} canVoid={false} sortBy="orderId" sortDirection="asc" riders={[]} riderPending={false} statusPending={false} correctRiderPending={false} paidToOsPending={false} onToggleAll={vi.fn()} onToggleOne={vi.fn()} onRiderChange={vi.fn()} onStatusChange={vi.fn()} onHistory={vi.fn()} onCorrectRider={vi.fn()} onPaidToOs={vi.fn()} onEdit={vi.fn()} onVoid={vi.fn()} onSort={vi.fn()} /></MemoryRouter>);
    const row = screen.getAllByRole("row")[1]!;
    expect(row.querySelectorAll("td")[2]).not.toHaveTextContent("1 shown");
    expect(row.querySelector('td:nth-child(3) [role="img"]')).toHaveAttribute("title", expect.stringContaining("Linked · 1 shown"));
    expect(row.querySelectorAll("td")[8]).toHaveTextContent("Σ 5,500");
  });
  it("keeps a rescheduled tracking cue compact and shows its details on hover", () => {
    const parcel = { id: "parcel-rescheduled", orderId: "22", trackingNumber: "LTY-2038", customerName: "Customer", status: "OUT_FOR_DELIVERY", reasonCode: "DATE_CHANGE", plannedDeliveryDate: "2026-10-10T00:00:00.000Z", codAmount: 106000, deliveryFee: 4000, batch: { label: "Batch", shop: { name: "Shop" } }, linkGroup: null };
    render(<MemoryRouter><DispatchTable visible={[parcel]} selected={[]} allSelected={false} canDispatchEdit={false} canVoid={false} sortBy="" sortDirection="asc" riders={[]} riderPending={false} statusPending={false} correctRiderPending={false} paidToOsPending={false} onToggleAll={vi.fn()} onToggleOne={vi.fn()} onRiderChange={vi.fn()} onStatusChange={vi.fn()} onHistory={vi.fn()} onCorrectRider={vi.fn()} onPaidToOs={vi.fn()} onEdit={vi.fn()} onVoid={vi.fn()} onSort={vi.fn()} /></MemoryRouter>);
    const tracking = screen.getByRole("button", { name: /View parcel details LTY-2038\. Customer requested/i });
    expect(tracking).toHaveAttribute("title", expect.stringContaining("106,000 MMK"));
    expect(tracking).toHaveAttribute("title", expect.stringContaining("2026-10-10"));
    expect(tracking).toHaveClass("text-amber-700");
    expect(screen.queryByText(/Customer requested another delivery day/)).not.toBeInTheDocument();
  });
});
