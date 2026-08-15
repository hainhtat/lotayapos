import { describe, expect, it } from "vitest";
import { parseContentDispositionFilename, resolveManifestPdfFilename } from "./content-disposition";

describe("parseContentDispositionFilename", () => {
  it("reads a quoted filename parameter", () => {
    expect(parseContentDispositionFilename('attachment; filename="dispatch-manifest-a1b2.pdf"')).toBe(
      "dispatch-manifest-a1b2.pdf",
    );
  });

  it("reads an unquoted filename parameter", () => {
    expect(parseContentDispositionFilename("attachment; filename=lotaya-manifest-2-riders.pdf")).toBe(
      "lotaya-manifest-2-riders.pdf",
    );
  });

  it("prefers RFC 5987 filename* over filename", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''lotaya-%E1%80%80.pdf",
      ),
    ).toBe("lotaya-က.pdf");
  });

  it("uses filename* alone when plain filename is absent", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''lotaya-manifest-rider.pdf")).toBe(
      "lotaya-manifest-rider.pdf",
    );
  });

  it("falls back to plain filename when filename* is not decodable", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="safe.pdf"; filename*=UTF-8\'\'%E0%A4%A',
      ),
    ).toBe("safe.pdf");
  });

  it("returns null when the header is missing or has no filename", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });
});

describe("resolveManifestPdfFilename", () => {
  it("uses the server filename when present", () => {
    expect(resolveManifestPdfFilename('attachment; filename="dispatch-manifest-2-riders.pdf"')).toBe(
      "dispatch-manifest-2-riders.pdf",
    );
  });

  it("falls back to lotaya-manifest with the local calendar date", () => {
    expect(resolveManifestPdfFilename(null, new Date(2026, 7, 15, 14, 30))).toBe("lotaya-manifest-2026-08-15.pdf");
    expect(resolveManifestPdfFilename("attachment", new Date(2026, 0, 5))).toBe("lotaya-manifest-2026-01-05.pdf");
  });
});
