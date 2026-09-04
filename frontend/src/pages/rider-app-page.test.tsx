import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RiderAppPage } from "./rider-app-page";
import { AuthProvider } from "@/app/auth";
import "@/i18n";

describe("RiderAppPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the live version manifest for the APK download target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.1.9",
          apkUrl: "https://lotaya.mmds.site/app/lotaya-rider.apk",
          sizeBytes: 12345678,
        }),
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <RiderAppPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Use the Lotaya rider app" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Download for Android" })).toHaveAttribute(
      "href",
      "https://lotaya.mmds.site/app/lotaya-rider.apk",
    );
    expect(screen.getByText("Version 0.1.9")).toBeInTheDocument();
  });
});
