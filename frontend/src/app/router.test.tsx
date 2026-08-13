import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./router";
import { AuthProvider } from "./auth";
import "@/i18n";

function findRouteElement(routes: typeof router.routes, path: string): ReactNode | undefined {
  for (const route of routes) {
    if (route.path === path) return route.element;
    if (route.children) {
      const found = findRouteElement(route.children, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe("operations router", () => {
  it("redirects /operations to dispatch and preserves the query string", async () => {
    const operationsElement = findRouteElement(router.routes, "operations");
    expect(operationsElement).toBeTruthy();

    const memoryRouter = createMemoryRouter(
      [
        { path: "/operations", element: operationsElement },
        { path: "/operations/dispatch", element: <div>dispatch-destination</div> },
      ],
      { initialEntries: ["/operations?batchId=batch-7&assignmentStatus=UNASSIGNED"] },
    );

    render(<RouterProvider router={memoryRouter} />);

    await waitFor(() => expect(screen.getByText("dispatch-destination")).toBeInTheDocument());
    expect(memoryRouter.state.location.pathname).toBe("/operations/dispatch");
    expect(memoryRouter.state.location.search).toBe("?batchId=batch-7&assignmentStatus=UNASSIGNED");
  });
});

describe("rider web gate", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps authenticated riders on /rider-app instead of the ERP shell", async () => {
    localStorage.setItem("lotaya_token", "rider-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "rider-1", name: "Rider One", email: "rider@example.com", role: "RIDER" },
        }),
      }),
    );

    const memoryRouter = createMemoryRouter(router.routes, { initialEntries: ["/"] });
    render(
      <AuthProvider>
        <RouterProvider router={memoryRouter} />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Use the Lotaya rider app" })).toBeInTheDocument());
    expect(memoryRouter.state.location.pathname).toBe("/rider-app");
  });
});
