import { repairIdentityEncodedMyanmar, repairPdfText, reorderVisualMyanmar } from "../src/utils/myanmar-pdf-font.js";

describe("Myanmar PDF identity-encoding repair", () => {
  const map = new Map<number, string>([
    [0x23, "ွှ"],
    [0x36, "္မ"],
    [0x37, "ရ"],
    [0x3b, "ှု"],
    [0x3c, "ြ"],
    [0x3d, "ု့"],
    [0x45, "ု့"],
    [0x51, "ွှ"],
    [0x5e, "္ဓ"],
    [0x61, "ြ"],
    [0x68, "္ဘ"],
  ]);

  test("restores township, stacked marks, and visual e/ra vowels", () => {
    expect(repairIdentityEncodedMyanmar("အင်းစိန်<မိ=နယ်", map)).toContain("မြို့နယ်");
    expect(repairIdentityEncodedMyanmar("လ;ိင်", map)).toBe("လှိုင်");
    expect(repairIdentityEncodedMyanmar("ကမhာ", map)).toBe("ကမ္ဘာ");
    expect(repairIdentityEncodedMyanmar("ဓမ6ာ", map)).toBe("ဓမ္မာ");
    expect(repairIdentityEncodedMyanmar("ေရ#နန်းမဒီ", map)).toBe("ရွှေနန်းမဒီ");
    expect(repairIdentityEncodedMyanmar("လမ်းမaကီး", map)).toBe("လမ်းမကြီး");
    expect(repairIdentityEncodedMyanmar("သိဒ^ိ", map)).toBe("သိဒ္ဓိ");
    expect(repairIdentityEncodedMyanmar("ပိEလိE", map)).toBe("ပို့လို့");
    expect(repairIdentityEncodedMyanmar("တပင်ေရQထီး", map)).toBe("တပင်ရွှေထီး");
  });

  test("does not rewrite already-correct Unicode", () => {
    expect(reorderVisualMyanmar("ရံုးပိတ်")).toBe("ရုံးပိတ်");
    expect(repairIdentityEncodedMyanmar("ကိုအောင်", map)).toBe("ကိုအောင်");
  });

  test("repairs text for matching PostScript font names and leaves other fonts unchanged", () => {
    const fonts = new Map([["NotoSansMyanmar-Regular", map]]);
    expect(repairPdfText("လ;ိင်", "ABC+NotoSansMyanmar-Regular", fonts)).toBe("လှိုင်");
    expect(repairPdfText("လ;ိင်", "NotoSansMyanmar-Regular", fonts)).toBe("လှိုင်");
    expect(repairPdfText("လ;ိင်", "Helvetica", fonts)).toBe("လ;ိင်");
    expect(repairPdfText("လ;ိင်", undefined, fonts)).toBe("လ;ိင်");
  });
});
