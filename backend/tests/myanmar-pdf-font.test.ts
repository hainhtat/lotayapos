import { deflateSync } from "node:zlib";
import { myanmarFontRepairs, repairIdentityEncodedMyanmar, repairPdfText, reorderVisualMyanmar } from "../src/utils/myanmar-pdf-font.js";

function u16(value: number) {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(value);
  return result;
}

function u32(value: number) {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function makeFormat4MyanmarFont() {
  const psName = Buffer.from("ABCDEF+NotoSansMyanmar-Regular", "utf16le").swap16();
  const name = Buffer.concat([
    u16(0), u16(1), u16(18),
    u16(3), u16(1), u16(0x0409), u16(6), u16(psName.length), u16(0),
    psName,
  ]);

  const glyphName = Buffer.from("medial_ha_u", "latin1");
  const post = Buffer.concat([
    Buffer.from([0x00, 0x02, 0x00, 0x00]), Buffer.alloc(28),
    u16(2), u16(0), u16(258), Buffer.from([glyphName.length]), glyphName,
  ]);

  // Two format-4 segments: ';' -> glyph 1, followed by the required sentinel.
  const format4 = Buffer.concat([
    u16(4), u16(32), u16(0), u16(4), u16(4), u16(1), u16(0),
    u16(0x003b), u16(0xffff), u16(0),
    u16(0x003b), u16(0xffff),
    u16(0x10000 + 1 - 0x003b), u16(1),
    u16(0), u16(0),
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), format4]);
  const tables = [["cmap", cmap], ["name", name], ["post", post]] as const;
  const headerLength = 12 + tables.length * 16;
  let tableOffset = headerLength;
  const records: Buffer[] = [];
  const payloads: Buffer[] = [];
  for (const [tag, payload] of tables) {
    records.push(Buffer.concat([Buffer.from(tag), u32(0), u32(tableOffset), u32(payload.length)]));
    payloads.push(payload);
    tableOffset += payload.length;
  }
  return Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), u16(tables.length), Buffer.alloc(6), ...records, ...payloads]);
}

function makeIndirectFontPdf(font: Buffer) {
  const compressed = deflateSync(font);
  return Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /XYZABC+NotoSansMyanmar-Regular /FontDescriptor 8 0 R >>\nendobj\n"),
    Buffer.from(`20 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from("\nendstream\nendobj\n"),
    Buffer.from(`7 0 obj\n<< /Producer (${"padding ".repeat(80)}) >>\nendobj\n`),
    Buffer.from("8 0 obj\n<< /Type /FontDescriptor /FontName /XYZABC+NotoSansMyanmar-Regular /FontFile2 20 0 R >>\nendobj\n%%EOF"),
  ]);
}

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

  test("resolves indirect FontDescriptor streams and format-4 cmap data in a real PDF byte fixture", () => {
    const fonts = myanmarFontRepairs(makeIndirectFontPdf(makeFormat4MyanmarFont()));

    expect(fonts.size).toBeGreaterThan(0);
    expect(repairPdfText("လ;ိင်", "NotoSansMyanmar-Regular", fonts)).toBe("လှိုင်");
    expect(repairPdfText("လ;ိင်", "XYZABC+NotoSansMyanmar-Regular", fonts)).toBe("လှိုင်");
  });

  test("does not rewrite valid ToUnicode output when a recovery font is available", () => {
    const fonts = myanmarFontRepairs(makeIndirectFontPdf(makeFormat4MyanmarFont()));
    expect(repairPdfText("လှိုင်", "XYZABC+NotoSansMyanmar-Regular", fonts)).toBe("လှိုင်");
  });
});
