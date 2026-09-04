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
  if (offset < 0 || offset + 2 > data.length) throw new RangeError("Invalid TrueType uint16 offset");
  return data.readUInt16BE(offset);
}

function readU32(data: Buffer, offset: number) {
  if (offset < 0 || offset + 4 > data.length) throw new RangeError("Invalid TrueType uint32 offset");
  return data.readUInt32BE(offset);
}

function ttfTables(data: Buffer) {
  if (data.length < 12) return new Map<string, Buffer>();
  const tableCount = readU16(data, 4);
  const tables = new Map<string, Buffer>();
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    if (offset + 16 > data.length) break;
    const tag = data.subarray(offset, offset + 4).toString("binary");
    const tableOffset = readU32(data, offset + 8);
    const tableLength = readU32(data, offset + 12);
    if (tableOffset <= data.length && tableLength <= data.length - tableOffset) {
      tables.set(tag, data.subarray(tableOffset, tableOffset + tableLength));
    }
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
    if (rec + 12 > name.length) break;
    const platform = readU16(name, rec);
    const nameId = readU16(name, rec + 6);
    const length = readU16(name, rec + 8);
    const offset = stringOffset + readU16(name, rec + 10);
    if (nameId !== 6) continue;
    if (offset > name.length || length > name.length - offset) continue;
    const raw = name.subarray(offset, offset + length);
    const decoded = platform === 3 && raw.length % 2 === 0 ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("latin1");
    return decoded.replace(/\0/g, "");
  }
  return "";
}

function ttfGlyphNames(data: Buffer) {
  const post = ttfTables(data).get("post");
  if (!post || post.length < 34 || post.readInt32BE(0) !== 0x00020000) return [];
  const glyphCount = readU16(post, 32);
  if (34 + glyphCount * 2 > post.length) return [];
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

function addFormat4Mapping(cmap: Buffer, offset: number, mapping: Map<number, number>) {
  if (offset + 14 > cmap.length) return;
  const length = readU16(cmap, offset + 2);
  const end = offset + length;
  const segCount = readU16(cmap, offset + 6) / 2;
  if (!Number.isInteger(segCount) || segCount < 1 || end > cmap.length) return;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  if (idRangeOffsets + segCount * 2 > end) return;
  for (let segment = 0; segment < segCount; segment += 1) {
    const start = readU16(cmap, startCodes + segment * 2);
    const finish = readU16(cmap, endCodes + segment * 2);
    const delta = readU16(cmap, idDeltas + segment * 2);
    const rangeOffsetPosition = idRangeOffsets + segment * 2;
    const rangeOffset = readU16(cmap, rangeOffsetPosition);
    if (finish < start || finish - start > 0x1000) continue;
    for (let code = start; code <= finish && code !== 0xffff; code += 1) {
      let glyphId: number;
      if (rangeOffset === 0) {
        glyphId = (code + delta) & 0xffff;
      } else {
        const glyphOffset = rangeOffsetPosition + rangeOffset + (code - start) * 2;
        if (glyphOffset + 2 > end) continue;
        const rawGlyphId = readU16(cmap, glyphOffset);
        glyphId = rawGlyphId === 0 ? 0 : (rawGlyphId + delta) & 0xffff;
      }
      if (glyphId !== 0) mapping.set(code, glyphId);
    }
  }
}

function ttfCmap(data: Buffer) {
  const cmap = ttfTables(data).get("cmap");
  if (!cmap || cmap.length < 4) return new Map<number, number>();
  const subtableCount = readU16(cmap, 2);
  const mapping = new Map<number, number>();
  for (let index = 0; index < subtableCount; index += 1) {
    if (8 + index * 8 + 4 > cmap.length) break;
    const offset = readU32(cmap, 8 + index * 8);
    if (offset + 2 > cmap.length) continue;
    const format = readU16(cmap, offset);
    if (format === 4) {
      addFormat4Mapping(cmap, offset, mapping);
      continue;
    }
    if (format !== 6 || offset + 10 > cmap.length) continue;
    const first = readU16(cmap, offset + 6);
    const count = readU16(cmap, offset + 8);
    for (let code = 0; code < count && offset + 12 + code * 2 <= cmap.length; code += 1) {
      mapping.set(first + code, readU16(cmap, offset + 10 + code * 2));
    }
  }
  return mapping;
}

function asciiIdentityMap(data: Buffer) {
  const names = ttfGlyphNames(data);
  const cmap = ttfCmap(data);
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
  if (data.length < 4) return false;
  const tag = data.subarray(0, 4).toString("binary");
  return tag === "\x00\x01\x00\x00" || tag === "true" || tag === "OTTO";
}

type PdfObject = { number: number; generation: number; bodyStart: number; bodyEnd: number; body: string };

const MAX_PDF_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_PDF_OBJECT_BYTES = 16 * 1024 * 1024;

function pdfObjects(pdf: Buffer) {
  const objects = new Map<string, PdfObject>();
  if (pdf.length > MAX_PDF_SCAN_BYTES) return objects;
  const source = pdf.toString("latin1");
  const header = /(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b/g;
  for (let match = header.exec(source); match; match = header.exec(source)) {
    const bodyStart = match.index + match[0].length;
    let bodyEnd = source.indexOf("endobj", bodyStart);
    const streamMarker = bodyEnd < 0
      ? null
      : /\bstream(?:\r\n|\n|\r)/.exec(source.slice(bodyStart, Math.min(bodyEnd, bodyStart + 4096)));
    if (streamMarker) {
      const dictionary = source.slice(bodyStart, bodyStart + streamMarker.index);
      const directLength = /\/Length\s+(\d+)\b/.exec(dictionary);
      if (directLength) {
        const streamStart = bodyStart + streamMarker.index + streamMarker[0].length;
        const expectedStreamEnd = streamStart + Number(directLength[1]);
        if (expectedStreamEnd <= source.length) bodyEnd = source.indexOf("endobj", expectedStreamEnd);
      }
    }
    if (bodyEnd < 0 || bodyEnd - bodyStart > MAX_PDF_OBJECT_BYTES) continue;
    const number = Number(match[1]);
    const generation = Number(match[2]);
    objects.set(`${number}:${generation}`, { number, generation, bodyStart, bodyEnd, body: source.slice(bodyStart, bodyEnd) });
    header.lastIndex = bodyEnd + "endobj".length;
  }
  return objects;
}

function pdfReference(body: string, key: string) {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`).exec(body);
  return match ? `${Number(match[1])}:${Number(match[2])}` : undefined;
}

function decodePdfName(value: string) {
  return value.replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function pdfName(body: string, key: string) {
  const match = new RegExp(`/${key}\\s+/([^\\s<>\\[\\]()]+)`).exec(body);
  return match ? decodePdfName(match[1]) : "";
}

function streamBytes(pdf: Buffer, object: PdfObject) {
  const marker = /\bstream(?:\r\n|\n|\r)/.exec(object.body);
  if (!marker) return undefined;
  const streamStart = object.bodyStart + marker.index + marker[0].length;
  const relativeEnd = object.body.indexOf("endstream", marker.index + marker[0].length);
  if (relativeEnd < 0) return undefined;
  let streamEnd = object.bodyStart + relativeEnd;
  if (pdf[streamEnd - 1] === 0x0a) streamEnd -= 1;
  if (pdf[streamEnd - 1] === 0x0d) streamEnd -= 1;
  const raw = pdf.subarray(streamStart, streamEnd);
  const filterMatch = /\/Filter\s+(\/\w+|\[[^\]]*\])/.exec(object.body.slice(0, marker.index));
  if (!filterMatch) return raw;
  const filters = [...filterMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((item) => item[1]);
  if (filters.length !== 1 || (filters[0] !== "FlateDecode" && filters[0] !== "Fl")) return undefined;
  try {
    return inflateSync(raw, { maxOutputLength: 8 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

function normalizedFontName(name: string) {
  return decodePdfName(name).replace(/^[A-Z]{1,6}\+/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function inflatePdfStreams(pdf: Buffer) {
  const fonts = new Map<string, Map<number, string>>();
  const objects = pdfObjects(pdf);
  for (const object of objects.values()) {
    if (!/\/Type\s*\/Font\b/.test(object.body) && !/\/Subtype\s*\/TrueType\b/.test(object.body)) continue;
    const descriptorRef = pdfReference(object.body, "FontDescriptor");
    const descriptor = descriptorRef ? objects.get(descriptorRef) : undefined;
    const descriptorBody = descriptor?.body ?? object.body;
    const fontFileRef = pdfReference(descriptorBody, "FontFile2");
    const fontFile = fontFileRef ? objects.get(fontFileRef) : undefined;
    if (!fontFile) continue;
    const decoded = streamBytes(pdf, fontFile);
    if (!decoded || !isSfnt(decoded)) continue;
    try {
      const embeddedName = ttfPostScriptName(decoded).replace(/\0/g, "");
      const aliases = [pdfName(object.body, "BaseFont"), pdfName(descriptorBody, "FontName"), embeddedName].filter(Boolean);
      if (!aliases.some((name) => /myanmar/i.test(name))) continue;
      const map = asciiIdentityMap(decoded);
      if (!map.size) continue;
      for (const alias of aliases) fonts.set(alias, map);
    } catch {
      // Malformed embedded fonts should not make the whole PDF import fail.
    }
  }
  return fonts;
}

export function myanmarFontRepairs(pdf: Buffer) {
  return inflatePdfStreams(pdf);
}

export function repairPdfText(value: string, fontName: string | undefined, fonts: Map<string, Map<number, string>>) {
  if (!fontName) return value;
  const wanted = normalizedFontName(fontName);
  const map = fonts.get(fontName) ?? [...fonts.entries()].find(([name]) => normalizedFontName(name) === wanted)?.[1];
  return map ? repairIdentityEncodedMyanmar(value, map) : value;
}
