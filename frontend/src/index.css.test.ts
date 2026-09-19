import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("page transition styles", () => {
  it("does not leave a transform that breaks position:fixed modals", () => {
    const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
    const pageIn = css.match(/@keyframes page-in\{[^}]+\}/)?.[0] ?? "";
    const dataIn = css.match(/@keyframes data-in\{[^}]+\}/)?.[0] ?? "";
    expect(pageIn).toContain("opacity");
    expect(pageIn).not.toMatch(/transform/);
    expect(dataIn).not.toMatch(/transform/);
  });
});
