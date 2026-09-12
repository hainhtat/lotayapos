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

const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function recurringColumn(items: PdfTextItem[], minimumX: number, maximumX: number) {
  const groups = new Map<number, { count: number; xs: number[] }>();
  for (const item of items) {
    if (item.x <= minimumX || item.x >= maximumX || isNoise(item.str)) continue;
    const key = Math.round(item.x / 2) * 2;
    const group = groups.get(key) ?? { count: 0, xs: [] };
    group.count += 1;
    group.xs.push(item.x);
    groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => b.count - a.count || Math.min(...a.xs) - Math.min(...b.xs))[0];
  return best ? median(best.xs) : undefined;
}

function pageGeometry(items: PdfTextItem[], anchors: PdfTextItem[]) {
  const anchorX = Math.min(...anchors.map((item) => item.x));
  const gaps = anchors.slice(0, -1).map((anchor, index) => anchor.y - anchors[index + 1]!.y).filter((gap) => gap > 0);
  const rowGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 48;
  const headerCustomer = items.find((item) => /^customer$/i.test(item.str.trim()));
  const headerAddress = items.find((item) => /^address$/i.test(item.str.trim()));
  const amountCandidates = anchors.flatMap((anchor) => items
    .filter((item) => Math.abs(item.y - anchor.y) <= Math.min(30, rowGap / 2) && item.x > anchor.x)
    .filter((item) => parseAmountToken(item.str) !== undefined)
    .sort((a, b) => b.x - a.x)
    .slice(0, 1));
  const amountX = median(amountCandidates.map((item) => item.x)) ?? Math.max(...items.map((item) => item.x));
  const customerCandidates = anchors.flatMap((anchor) => items
    .filter((item) => Math.abs(item.y - anchor.y) <= Math.min(30, rowGap / 2) && item.x > anchor.x + 6 && item.x < amountX)
    .sort((a, b) => a.x - b.x)
    .slice(0, 1));
  const customerX = headerCustomer?.x ?? median(customerCandidates.map((item) => item.x)) ?? anchorX + (amountX - anchorX) * 0.1;
  const addressMinimum = customerX + (amountX - customerX) * 0.15;
  const addressX = headerAddress?.x ?? recurringColumn(items, addressMinimum, amountX) ?? customerX + (amountX - customerX) * 0.4;
  return {
    rowGap,
    noEnd: (anchorX + customerX) / 2,
    customerEnd: (customerX + addressX) / 2,
    amountX,
  };
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
    const pageWidth = Math.max(...pageItems.map((item) => item.x)) - Math.min(...pageItems.map((item) => item.x));
    // Row numbers are commonly right-aligned, so 1-, 2-, and 3-digit values
    // do not share an exact x coordinate. Keep a narrow scale-aware left band
    // while excluding numeric address/COD tokens farther across the page.
    const anchorBand = Math.max(8, pageWidth * 0.05);
    const orderAnchors = numericItems
      .filter((item) => item.x <= leftmostX + anchorBand)
      .sort((a, b) => b.y - a.y);
    if (!orderAnchors.length) continue;
    const noiseBaselines = pageItems.filter((item) => isNoise(item.str)).map((item) => item.y);
    const isOnNoiseLine = (item: PdfTextItem) => noiseBaselines.some((y) => Math.abs(item.y - y) <= 10);
    const { rowGap, noEnd, customerEnd, amountX } = pageGeometry(pageItems, orderAnchors);
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
      const upper = Number.isFinite(prevY) ? (anchor.y + prevY) / 2 : anchor.y + Math.max(rowGap / 2, 30);
      const lower = Number.isFinite(nextY) ? (anchor.y + nextY) / 2 : anchor.y - Math.max(rowGap / 2, 80);
      const block = pageItems.filter((item) => item.y <= upper + 0.5 && item.y > lower + 0.5);
      const customer = joinItems(block.filter((item) => item.x >= noEnd && item.x < customerEnd));
      const amountItem = block
        .filter((item) => !isOnNoiseLine(item))
        .filter((item) => item.x >= Math.max(customerEnd, amountX - Math.max(24, (amountX - customerEnd) * 0.2)))
        .filter((item) => parseAmountToken(item.str) !== undefined)
        .sort((a, b) => Math.abs(a.x - amountX) - Math.abs(b.x - amountX))[0];
      const codAmount = amountItem ? parseAmountToken(amountItem.str) : undefined;
      if (codAmount === undefined) continue;
      if (!Number.isSafeInteger(codAmount) || codAmount < 0) continue;
      const addressRaw = joinItems(block.filter((item) =>
        item.x >= customerEnd
        && item !== amountItem
        && !isOnNoiseLine(item)
        && !/^\s*[—–-]\s*$/.test(item.str)
        && !isNoise(item.str),
      ));
      const extracted = extractPhonesFromText(addressRaw);
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
