import { describe, expect, it } from "vitest";
import { resources } from "./resources";

const localeFiles = import.meta.glob<Record<string, unknown>>("./locales/{en,my}/*.json", {
  eager: true,
  import: "default",
});

describe("translation resources", () => {
  it("has one English and Myanmar value for every key, without duplicate keys", () => {
    const keysByLanguage = { en: new Set<string>(), my: new Set<string>() };

    for (const [path, entries] of Object.entries(localeFiles)) {
      const language = path.includes("/en/") ? "en" : "my";
      for (const key of Object.keys(entries)) {
        expect(keysByLanguage[language].has(key), `${path}: duplicate ${key}`).toBe(false);
        keysByLanguage[language].add(key);
      }
    }

    expect([...keysByLanguage.my].sort()).toEqual([...keysByLanguage.en].sort());
    expect(Object.keys(resources.en.translation).sort()).toEqual([...keysByLanguage.en].sort());
    expect(Object.keys(resources.my.translation).sort()).toEqual([...keysByLanguage.my].sort());
  });

  it("keeps interpolation placeholders aligned between languages", () => {
    const placeholders = (value: unknown) => [...JSON.stringify(value).matchAll(/{{\s*([^}]+?)\s*}}/g)]
      .map((match) => match[1]).sort();

    for (const [key, english] of Object.entries(resources.en.translation)) {
      expect(placeholders(resources.my.translation[key]), key).toEqual(placeholders(english));
    }
  });
});
