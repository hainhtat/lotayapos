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
});
