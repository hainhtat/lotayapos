import { inflateSync } from "node:zlib";

const CONSONANT = "[\u1000-\u102A\u103F\u1050-\u1055]";
const MEDIAL = "[\u103B-\u103E]";

const GLYPH_TO_UNICODE: Record<string, string> = {
  ka: "က",
  kha: "ခ",
  ga: "ဂ",
  gha: "ဃ",
  nga: "င",
  ca: "စ",
  cha: "ဆ",
  ja: "ဇ",
  jha: "ဈ",
  nnya: "ည",
  nya: "ဉ",
  tta: "ဋ",
  ttha: "ဌ",
  dda: "ဍ",
  ddha: "ဎ",
  nna: "ဏ",
  ta: "တ",
  tha: "ထ",
  da: "ဒ",
  dha: "ဓ",
  na: "န",
  pa: "ပ",
  pha: "ဖ",
  ba: "ဗ",
  bha: "ဘ",
  ma: "မ",
  ya: "ယ",
  ra: "ရ",
  la: "လ",
  wa: "ဝ",
  sa: "သ",
  ha: "ဟ",
  a: "အ",
  a_m: "အ",
  i: "ဣ",
  ii: "ဤ",
  u: "ဥ",
  u_m: "ဥ",
  uu: "ဦ",
  e: "ဧ",
  _aa: "ာ",
  _tall_aa: "ါ",
  _i: "ိ",
  _ii: "ီ",
  _u: "ု",
  _u_spacing: "ု",
  _uu: "ူ",
  _e: "ေ",
  _ai: "ဲ",
  anusvara: "ံ",
  dot_below: "့",
  dot_below_spacing: "့",
  visarga: "း",
  virama: "္",
  asat: "်",
  medial_ya: "ျ",
  medial_ra: "ြ",
  "medial_ra_tt": "ြ",
  "medial_ra_tt.w2": "ြ",
  medial_wa: "ွ",
  medial_ha: "ှ",
  medial_wa_ha: "ွှ",
  medial_ha_u: "ှု",
  medial_ya_wa: "ျွ",
  _u_dot: "ု့",
  _u_dot_spacing: "ု့",
  "dha.sub": "္ဓ",
  "ma.sub": "္မ",
  "bha.sub": "္ဘ",
  "na.sub": "္န",
  "da.sub": "္ဒ",
  "ka.sub": "္က",
  "kha.sub": "္ခ",
  "ga.sub": "္ဂ",
  "pa.sub": "္ပ",
  "ta.sub": "္တ",
  "la.sub": "္လ",
  "ya.sub": "္ယ",
  "ra.alt": "ရ",
  "ra.alt2": "ရ",
  "na.alt": "န",
  zero_m: "၀",
  one_m: "၁",
  two_m: "၂",
  three_m: "၃",
  four_m: "၄",
  five_m: "၅",
  six_m: "၆",
  seven_m: "၇",
  eight_m: "၈",
  nine_m: "၉",
  little_section: "၊",
  big_section: "။",
};

const MAC_STANDARD_NAMES = [
  ".notdef", ".null", "nonmarkingreturn", "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle",
  "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash", "zero", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "colon", "semicolon", "less", "equal", "greater", "question", "at", "A", "B", "C", "D", "E", "F",
  "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft", "backslash",
  "bracketright", "asciicircum", "underscore", "grave", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
  "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright", "asciitilde",
];

function readU16(data: Buffer, offset: number) {
  return data.readUInt16BE(offset);
}

function readU32(data: Buffer, offset: number) {
  return data.readUInt32BE(offset);
}

function ttfTables(data: Buffer) {
  const tableCount = readU16(data, 4);
  const tables = new Map<string, Buffer>();
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    const tag = data.subarray(offset, offset + 4).toString("binary");
    const tableOffset = readU32(data, offset + 8);
    const tableLength = readU32(data, offset + 12);
    tables.set(tag, data.subarray(tableOffset, tableOffset + tableLength));
  }
  return tables;
}

function ttfPostScriptName(data: Buffer) {
  const name = ttfTables(data).get("name");
  if (!name) return "";
  const count = readU16(name, 2);
  const stringOffset = readU16(name, 4);
  for (let index = 0; index < count; index += 1) {
    const rec = 6 + index * 12;
    const platform = readU16(name, rec);
    const nameId = readU16(name, rec + 6);
    const length = readU16(name, rec + 8);
    const offset = stringOffset + readU16(name, rec + 10);
    if (nameId !== 6) continue;
    const raw = name.subarray(offset, offset + length);
    const decoded = platform === 3 && raw.length % 2 === 0 ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("latin1");
    return decoded.replace(/\0/g, "");
  }
  return "";
}

function ttfGlyphNames(data: Buffer) {
  const post = ttfTables(data).get("post");
  if (!post || post.readInt32BE(0) !== 0x00020000) return [];
  const glyphCount = readU16(post, 32);
  const indexes: number[] = [];
  for (let index = 0; index < glyphCount; index += 1) indexes.push(readU16(post, 34 + index * 2));
  const extras: string[] = [];
  let cursor = 34 + glyphCount * 2;
  while (cursor < post.length) {
    const length = post[cursor] ?? 0;
    extras.push(post.subarray(cursor + 1, cursor + 1 + length).toString("latin1"));
    cursor += 1 + length;
  }
  return indexes.map((index) => (index < 258 ? MAC_STANDARD_NAMES[index] ?? "" : extras[index - 258] ?? ""));
}

function ttfFormat6Cmap(data: Buffer) {
  const cmap = ttfTables(data).get("cmap");
  if (!cmap) return new Map<number, number>();
  const subtableCount = readU16(cmap, 2);
  const mapping = new Map<number, number>();
  for (let index = 0; index < subtableCount; index += 1) {
    const offset = readU32(cmap, 8 + index * 8);
    if (readU16(cmap, offset) !== 6) continue;
    const first = readU16(cmap, offset + 6);
    const count = readU16(cmap, offset + 8);
    for (let code = 0; code < count; code += 1) mapping.set(first + code, readU16(cmap, offset + 10 + code * 2));
  }
  return mapping;
}

function asciiIdentityMap(data: Buffer) {
  const names = ttfGlyphNames(data);
  const cmap = ttfFormat6Cmap(data);
  const map = new Map<number, string>();
  for (const [code, glyphId] of cmap) {
    const unicode = GLYPH_TO_UNICODE[names[glyphId] ?? ""];
    if (unicode) map.set(code, unicode);
  }
  return map;
}

export function reorderVisualMyanmar(value: string) {
  let text = value.replace(/\u102F\u102D/g, "\u102D\u102F").replace(/\u1036\u102F/g, "\u102F\u1036");
  text = text.replace(new RegExp(`\u103C(${CONSONANT})`, "g"), "$1\u103C");
  text = text.replace(new RegExp(`\u103B(${CONSONANT})`, "g"), "$1\u103B");
  text = text.replace(new RegExp(`\u1031(${CONSONANT}${MEDIAL}*)`, "g"), "$1\u1031");
  return text.normalize("NFC");
}

export function repairIdentityEncodedMyanmar(value: string, asciiToUnicode: Map<number, string>) {
  if (!asciiToUnicode.size) return value;
  let repaired = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    repaired += code < 128 ? asciiToUnicode.get(code) ?? char : char;
  }
  return reorderVisualMyanmar(repaired);
}

function isSfnt(data: Buffer) {
  const tag = data.subarray(0, 4).toString("binary");
  return tag === "\x00\x01\x00\x00" || tag === "true" || tag === "OTTO";
}

function inflatePdfStreams(pdf: Buffer) {
  const fonts = new Map<string, Map<number, string>>();
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  const fontFileMarker = Buffer.from("/FontFile2");
  let cursor = 0;
  while (cursor < pdf.length) {
    const start = pdf.indexOf(marker, cursor);
    if (start < 0) break;
    const lookbehind = pdf.subarray(Math.max(0, start - 400), start);
    let dataStart = start + marker.length;
    if (pdf[dataStart] === 0x0d) dataStart += 1;
    if (pdf[dataStart] === 0x0a) dataStart += 1;
    const end = pdf.indexOf(endMarker, dataStart);
    if (end < 0) break;
    let raw = pdf.subarray(dataStart, end);
    if (raw[raw.length - 1] === 0x0a) raw = raw.subarray(0, raw.length - 1);
    if (raw[raw.length - 1] === 0x0d) raw = raw.subarray(0, raw.length - 1);
    cursor = end + endMarker.length;
    if (lookbehind.indexOf(fontFileMarker) < 0) continue;
    let decoded: Buffer;
    try {
      decoded = inflateSync(raw, { maxOutputLength: 8 * 1024 * 1024 });
    } catch {
      continue;
    }
    if (!isSfnt(decoded)) continue;
    const name = ttfPostScriptName(decoded);
    if (!/NotoSansMyanmar/i.test(name)) continue;
    const map = asciiIdentityMap(decoded);
    if (map.size) fonts.set(name.replace(/\0/g, ""), map);
  }
  return fonts;
}

export function myanmarFontRepairs(pdf: Buffer) {
  return inflatePdfStreams(pdf);
}

export function repairPdfText(value: string, fontName: string | undefined, fonts: Map<string, Map<number, string>>) {
  if (!fontName) return value;
  const map = fonts.get(fontName) ?? [...fonts.entries()].find(([name]) => fontName.includes(name) || name.includes(fontName))?.[1];
  return map ? repairIdentityEncodedMyanmar(value, map) : value;
}
