export const MAX_MANIFEST_ROWS = 500;
export type ParsedManifestLine = { reference?: string; customerName: string; address: string; phone?: string; codAmount: number; sourcePage: number };
export type PdfTextItem = { str: string; x: number; y: number; page: number };

const MYANMAR_DIGIT_OFFSET = "၀".charCodeAt(0);

export function myanmarDigitsToAscii(value: string) {
  return value.replace(/[\u1040-\u1049]/g, (digit) => String(digit.charCodeAt(0) - MYANMAR_DIGIT_OFFSET));
}

export function extractPhonesFromText(value: string) {
  const ascii = myanmarDigitsToAscii(value).replace(/[‐‑–—]/g, "-");
  const compact = ascii.replace(/(?:ph(?:one)?|ဖုန်း)\s*[:.\-]?\s*/gi, " ");
  const phones: string[] = [];
  for (const match of compact.replace(/\D/g, "").match(/09\d{7,9}/g) ?? []) {
    if (!phones.includes(match)) phones.push(match);
  }
  let rest = value;
  for (const phone of phones) {
    const myanmar = phone.replace(/\d/g, (digit) => String.fromCharCode(MYANMAR_DIGIT_OFFSET + Number(digit)));
    rest = rest.replace(new RegExp(phone.split("").join("[\\s-]*"), "g"), " ");
    rest = rest.replace(new RegExp(myanmar.split("").join("[\\s-]*"), "g"), " ");
  }
  rest = rest.replace(/(?:ph(?:one)?|ဖုန်း)\s*[:.\-]?\s*/gi, " ").replace(/\s+/g, " ").trim();
  return { phones, rest };
}

const amount = (value: string) => Number(myanmarDigitsToAscii(value).replace(/[^0-9]/g, ""));
const looksLikePhone = (value: string) => extractPhonesFromText(value).phones.length > 0;
const isNoise = (line: string) =>
  /delivery\s+manifest|customer\s+address|no\.?\s+customer|^page\s+\d|https?:\/\/|total for |orders\s*·|signature|shop manager/i.test(line);

function parseAmountToken(value: string) {
  const ascii = myanmarDigitsToAscii(value).trim();
  if (!/\d/.test(ascii)) return undefined;
  if (!/mmk|ks/i.test(ascii) && !/^[\s,—\-]*[\d,]+$/.test(ascii)) return undefined;
  const codAmount = amount(ascii);
  return Number.isSafeInteger(codAmount) && codAmount >= 0 ? codAmount : undefined;
}

function parseLegacyLine(line: string, sourcePage: number): ParsedManifestLine | null {
  const numbered = line.match(/^\s*(\d{1,5})\s{1,}(.+)$/);
  if (!numbered) return null;
  const reference = numbered[1];
  const columns = numbered[2].trim().split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
  if (columns.length < 2) return null;
  const last = columns.at(-1)!;
  const codAmount = parseAmountToken(last) ?? (/mmk/i.test(last) ? amount(last) : undefined);
  if (codAmount === undefined) return null;
  columns.pop();
  let phone: string | undefined;
  if (columns.length > 2 && looksLikePhone(columns.at(-1)!)) phone = columns.pop();
  const customerName = columns.shift()?.trim() ?? "";
  const extracted = extractPhonesFromText(columns.join(" "));
  const address = extracted.rest;
  if (!phone && extracted.phones[0]) phone = extracted.phones[0];
  if (!customerName || !address) return null;
  return { reference, customerName, address, ...(phone ? { phone } : {}), codAmount, sourcePage };
}

export function parseDeliveryManifestText(pages: string[]): ParsedManifestLine[] {
  const rows: ParsedManifestLine[] = [];
  pages.forEach((page, pageIndex) => {
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim() || isNoise(line)) continue;
      const parsed = parseLegacyLine(line, pageIndex + 1);
      if (!parsed) {
        const prior = rows.at(-1);
        if (prior && prior.sourcePage === pageIndex + 1 && line.trim().length > 2) {
          const extracted = extractPhonesFromText(`${prior.address} ${line.trim()}`);
          prior.address = extracted.rest;
          if (!prior.phone && extracted.phones[0]) prior.phone = extracted.phones[0];
        }
        continue;
      }
      rows.push(parsed);
    }
  });
  return rows.slice(0, MAX_MANIFEST_ROWS);
}

const COL = { no: 95, customer: 215, address: 400 };

function columnOf(x: number, normalizeX: (value: number) => number = (value) => value) {
  x = normalizeX(x);
  if (x < COL.no) return "no" as const;
  if (x < COL.customer) return "customer" as const;
  if (x < COL.address) return "address" as const;
  return "tail" as const;
}

function pageGeometry(items: PdfTextItem[], anchors: PdfTextItem[]) {
  const anchorX = Math.min(...anchors.map((item) => item.x));
  const rightX = Math.max(...items.map((item) => item.x));
  const width = rightX - anchorX;
  const normalizeX = width > 0
    ? (x: number) => 65 + ((x - anchorX) * (492 - 65)) / width
    : (x: number) => x;
  const gaps = anchors.slice(0, -1).map((anchor, index) => anchor.y - anchors[index + 1]!.y).filter((gap) => gap > 0);
  const rowGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 48;
  return { normalizeX, rowGap };
}

function joinItems(items: PdfTextItem[]) {
  return items
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDeliveryManifestItems(items: PdfTextItem[]): ParsedManifestLine[] {
  const rows: ParsedManifestLine[] = [];
  const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const pageItems = items.filter((item) => item.page === page);
    const numericItems = pageItems.filter((item) => /^\d{1,5}$/.test(myanmarDigitsToAscii(item.str.trim())));
    const leftmostX = Math.min(...numericItems.map((item) => item.x));
    const orderAnchors = numericItems
      .filter((item) => item.x <= leftmostX + 2)
      .sort((a, b) => b.y - a.y);
    if (!orderAnchors.length) continue;
    const { normalizeX, rowGap } = pageGeometry(pageItems, orderAnchors);
    if (rows.length && orderAnchors[0]) {
      const leftover = pageItems.filter((item) => item.y > orderAnchors[0]!.y + rowGap / 2 && !isNoise(item.str));
      const extra = extractPhonesFromText(joinItems(leftover));
      const prior = rows.at(-1)!;
      if (extra.rest && !isNoise(extra.rest)) prior.address = `${prior.address} ${extra.rest}`.trim();
      if (!prior.phone && extra.phones[0]) prior.phone = extra.phones[0];
    }
    for (let index = 0; index < orderAnchors.length; index += 1) {
      const anchor = orderAnchors[index]!;
      const nextY = orderAnchors[index + 1]?.y ?? -Infinity;
      const prevY = orderAnchors[index - 1]?.y ?? Infinity;
      const upper = Math.min(anchor.y + rowGap / 2, (anchor.y + prevY) / 2);
      const lower = Number.isFinite(nextY) ? (anchor.y + nextY) / 2 : anchor.y - Math.max(rowGap / 2, 80);
      const block = pageItems.filter((item) => item.y <= upper + 0.5 && item.y > lower + 0.5);
      const customer = joinItems(block.filter((item) => columnOf(item.x, normalizeX) === "customer"));
      const addressRaw = joinItems(block.filter((item) => columnOf(item.x, normalizeX) === "address"));
      const tail = joinItems(block.filter((item) => columnOf(item.x, normalizeX) === "tail"));
      const codAmount = parseAmountToken(tail);
      if (codAmount === undefined) continue;
      if (!Number.isSafeInteger(codAmount) || codAmount < 0) continue;
      const extracted = extractPhonesFromText(`${addressRaw} ${tail}`);
      const address = extractPhonesFromText(addressRaw).rest.replace(/[—–\-]\s*$/, "").trim();
      const customerName = customer.replace(/\s+tt$/i, "").trim();
      if (!customerName || !address) continue;
      rows.push({
        reference: anchor.str.trim(),
        customerName,
        address,
        ...(extracted.phones[0] ? { phone: extracted.phones[0] } : {}),
        codAmount,
        sourcePage: page,
      });
    }
  }
  const pagesText = pages.map((page) => {
    const grouped = new Map<number, PdfTextItem[]>();
    for (const item of items.filter((entry) => entry.page === page)) {
      const y = Math.round(item.y / 4) * 4;
      grouped.set(y, [...(grouped.get(y) ?? []), item]);
    }
    return [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, lineItems]) => lineItems.slice().sort((a, b) => a.x - b.x).map((item) => item.str).join(" ").trim())
      .join("\n");
  });
  const fallbackRows = parseDeliveryManifestText(pagesText);
  const seen = new Set(rows.map((row) => `${row.sourcePage}:${row.reference ?? ""}`));
  for (const row of fallbackRows) {
    const key = `${row.sourcePage}:${row.reference ?? ""}`;
    if (!seen.has(key)) {
      rows.push(row);
      seen.add(key);
    }
  }
  return rows
    .sort((a, b) => a.sourcePage - b.sourcePage || Number(a.reference ?? 0) - Number(b.reference ?? 0))
    .slice(0, MAX_MANIFEST_ROWS);
}
