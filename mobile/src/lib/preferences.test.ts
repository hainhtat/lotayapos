import {nextTheme,resolveStoredLocale,resolveStoredTheme} from "./preferences";

describe("persisted settings",()=>{
  it("restores a valid saved theme ahead of the device theme",()=>{
    expect(resolveStoredTheme("dark","light")).toBe("dark");
    expect(resolveStoredTheme("light","dark")).toBe("light");
  });

  it("falls back safely for absent or corrupted values",()=>{
    expect(resolveStoredTheme(null,"dark")).toBe("dark");
    expect(resolveStoredTheme("sepia","light")).toBe("light");
    expect(resolveStoredLocale("unsupported")).toBe("en");
  });

  it("supports both persisted locales and deterministic theme toggling",()=>{
    expect(resolveStoredLocale("my")).toBe("my");
    expect(resolveStoredLocale("en")).toBe("en");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });
});
